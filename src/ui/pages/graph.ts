/**
 * Graph view — D3 force-layout over /api/graph data.
 * Mirrors buddy's graph.tsx. Loads a pinned d3@7.9.0 from jsdelivr CDN
 * with a sha384 SRI integrity attribute so the browser refuses to run
 * any bytes that do not match the known-good hash. The CSP allowlists
 * cdn.jsdelivr.net for script-src ONLY for this one file.
 *
 * When updating d3:
 *   1. Bump the version in the script src
 *   2. curl | openssl dgst -sha384 -binary | openssl base64 -A
 *   3. Paste the new hash into the integrity attribute
 *   4. Update CSP script-src if the origin changes
 */

import type { User } from '../../db/repositories/users.js';
import { layout } from '../layout.js';

interface GraphPageOptions {
  readonly currentUser: User;
  readonly csrfToken: string;
}

const GRAPH_SCRIPT = `
(function(){
  var TYPE_COLORS = {
    concept: '#4a7a9b', fact: '#7a4a9b', decision: '#9b7a4a',
    template: '#4a9b7a', secret: '#9b4a4a', config: '#6b7a9b',
    project: '#4a7a4a', task: '#9b9b4a', document: '#5a6a8a',
    note: '#8a8a5a', inbox_item: '#7a8a9a', user: '#9a7a7a',
    tag: '#7a9a8a', skill: '#c97a3a'
  };
  var TYPE_INITIALS = {
    concept: 'C', fact: 'F', decision: 'D', template: 'T', secret: 'S',
    config: 'G', project: 'P', task: 'K', document: 'M', note: 'N',
    inbox_item: 'I', user: 'U', tag: '#', skill: 'L'
  };
  var NODE_RADIUS = 14;
  var ORPHAN_RADIUS = 9;
  var sim = null;
  var graphData = null;
  var currentContext = '';

  function loadGraph() {
    var container = document.getElementById('graph-container');
    var svgEl = document.getElementById('graph-svg');
    var tooltip = document.getElementById('graph-tooltip');
    if (!container || !svgEl || !tooltip) return;

    var url = '/api/graph';
    if (currentContext) url += '?context=' + encodeURIComponent(currentContext);

    fetch(url, { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        graphData = data;
        updateMetaDisplay();
        populateContextFilter();
        renderGraph(container, svgEl, tooltip);
      })
      .catch(function(e) {
        var msg = document.createElement('p');
        msg.style.cssText = 'padding:2rem;color:var(--color-subtle);text-align:center;';
        msg.textContent = 'Graph konnte nicht geladen werden: ' + (e.message || e);
        container.appendChild(msg);
      });
  }

  function updateMetaDisplay() {
    var metaEl = document.getElementById('graph-meta');
    if (!metaEl || !graphData || !graphData.meta) return;
    var m = graphData.meta;
    while (metaEl.firstChild) metaEl.removeChild(metaEl.firstChild);
    function row(label, value) {
      var r = document.createElement('div');
      r.style.cssText = 'display:flex;justify-content:space-between;font-size:0.62rem;color:var(--color-muted);line-height:1.4';
      var l = document.createElement('span'); l.textContent = label;
      var v = document.createElement('span');
      v.textContent = String(value);
      v.style.fontFamily = 'var(--font-mono)';
      r.appendChild(l); r.appendChild(v);
      return r;
    }
    metaEl.appendChild(row('entities', m.total_entities));
    metaEl.appendChild(row('edges', m.total_edges));
    if (m.orphan_count > 0) {
      var r = row('orphans', m.orphan_count);
      r.style.color = '#c08080';
      metaEl.appendChild(r);
    }
    if (m.dropped_edges > 0) {
      var d = row('cut edges', m.dropped_edges);
      d.style.color = 'var(--color-subtle)';
      metaEl.appendChild(d);
    }
  }

  function populateContextFilter() {
    var select = document.getElementById('graph-context-filter');
    if (!select || !graphData || select.dataset.populated === '1') return;
    // Collect distinct contexts from the nodes of the initial (unfiltered)
    // load so the dropdown offers everything the user can see. Once we
    // have populated it, never re-populate — otherwise a context-filtered
    // reload would remove options.
    var contexts = {};
    graphData.nodes.forEach(function(n) { if (n.context) contexts[n.context] = true; });
    var keys = Object.keys(contexts).sort();
    keys.forEach(function(k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      select.appendChild(opt);
    });
    select.dataset.populated = '1';
    select.addEventListener('change', function() {
      currentContext = select.value;
      loadGraph();
    });
  }

  function setTooltip(tip, parts) {
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    parts.forEach(function(p) {
      var el = document.createElement('div');
      el.style.cssText = p.style || '';
      el.textContent = p.text;
      tip.appendChild(el);
    });
  }

  function positionTooltip(evt, tip, container) {
    var rect = container.getBoundingClientRect();
    var x = evt.clientX - rect.left + 14;
    var y = evt.clientY - rect.top + 14;
    var tipW = tip.offsetWidth, tipH = tip.offsetHeight;
    if (x + tipW > rect.width) x = evt.clientX - rect.left - tipW - 14;
    if (y + tipH > rect.height) y = evt.clientY - rect.top - tipH - 14;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function renderGraph(container, svgEl, tooltip) {
    if (sim) { sim.stop(); sim = null; }
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

    var W = container.clientWidth || 800;
    var H = container.clientHeight || 600;
    svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    var nodes = graphData.nodes.map(function(n) { return Object.assign({}, n); });
    var links = graphData.edges.map(function(e) { return Object.assign({}, e); });

    if (nodes.length === 0) {
      var msg = document.createElement('p');
      msg.style.cssText = 'padding:2rem;color:var(--color-subtle);text-align:center;position:absolute;inset:0;display:flex;align-items:center;justify-content:center';
      msg.textContent = 'No entities in the graph.';
      container.appendChild(msg);
      return;
    }

    var NS = 'http://www.w3.org/2000/svg';
    var r = NODE_RADIUS;

    var defs = document.createElementNS(NS, 'defs');
    var marker = document.createElementNS(NS, 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('viewBox', '0 0 10 7');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto');
    var arrow = document.createElementNS(NS, 'path');
    arrow.setAttribute('d', 'M 0 0 L 10 3.5 L 0 7 z');
    arrow.setAttribute('fill', 'var(--color-subtle)');
    marker.appendChild(arrow);
    defs.appendChild(marker);
    svgEl.appendChild(defs);

    var rootG = document.createElementNS(NS, 'g');
    rootG.setAttribute('id', 'graph-root');
    svgEl.appendChild(rootG);

    var area = W * H;
    var linkDist = Math.max(80, Math.min(180, Math.sqrt(area / nodes.length) * 0.7));
    var chargeStr = Math.max(-600, Math.min(-200, -area / (nodes.length * 2.5)));

    sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(function(d) { return d.id; }).distance(linkDist))
      .force('charge', d3.forceManyBody().strength(chargeStr))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide().radius(r + 8))
      .force('x', d3.forceX(W / 2).strength(0.04))
      .force('y', d3.forceY(H / 2).strength(0.04));

    var edgeGroup = document.createElementNS(NS, 'g');
    var lineEls = links.map(function(e) {
      var line = document.createElementNS(NS, 'line');
      line.setAttribute('stroke', 'var(--color-subtle)');
      line.setAttribute('stroke-width', '1.2');
      line.setAttribute('stroke-opacity', '0.4');
      line.setAttribute('marker-end', 'url(#arrowhead)');
      line.addEventListener('mouseenter', function(evt) {
        line.setAttribute('stroke-opacity', '1');
        line.setAttribute('stroke-width', '2.5');
        setTooltip(tooltip, [{ text: e.relation.replace(/_/g, ' '), style: 'font-weight:600;margin-bottom:2px' }]);
        tooltip.style.display = 'block';
        positionTooltip(evt, tooltip, container);
      });
      line.addEventListener('mousemove', function(evt) { positionTooltip(evt, tooltip, container); });
      line.addEventListener('mouseleave', function() {
        line.setAttribute('stroke-opacity', '0.4');
        line.setAttribute('stroke-width', '1.2');
        tooltip.style.display = 'none';
      });
      edgeGroup.appendChild(line);
      return line;
    });
    rootG.appendChild(edgeGroup);

    var edgeLabelGroup = document.createElementNS(NS, 'g');
    var edgeLabelEls = links.map(function(e) {
      var label = document.createElementNS(NS, 'text');
      label.setAttribute('font-size', '7');
      label.setAttribute('fill', 'var(--color-light)');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('pointer-events', 'none');
      label.setAttribute('opacity', '0.5');
      label.textContent = e.relation.replace(/_/g, ' ');
      edgeLabelGroup.appendChild(label);
      return label;
    });
    rootG.appendChild(edgeLabelGroup);

    var nodeGroup = document.createElementNS(NS, 'g');
    var drag = d3.drag()
      .on('start', function(event, d) { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', function(event, d) { d.fx = event.x; d.fy = event.y; })
      .on('end', function(event, d) { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; });

    var nodeEls = nodes.map(function(n) {
      var g = document.createElementNS(NS, 'g');
      g.style.cursor = 'pointer';
      var color = TYPE_COLORS[n.kind] || '#888';
      var isOrphan = n.is_orphan === true;
      var nodeRadius = isOrphan ? ORPHAN_RADIUS : r;

      var circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('r', String(nodeRadius));
      // Orphan nodes render with a dashed border, a muted fill, and a
      // lower overall opacity so they are visually distinguishable from
      // the main connected cluster. Real-orphan-by-design (no edges at
      // all) is what the user cares about when they scan the graph.
      circle.setAttribute('fill', isOrphan ? 'transparent' : color + '22');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', isOrphan ? '1.5' : '2');
      if (isOrphan) {
        circle.setAttribute('stroke-dasharray', '3 3');
        g.style.opacity = '0.55';
      }
      g.appendChild(circle);

      var initial = document.createElementNS(NS, 'text');
      initial.setAttribute('text-anchor', 'middle');
      initial.setAttribute('dominant-baseline', 'central');
      initial.setAttribute('font-size', '11');
      initial.setAttribute('font-weight', '700');
      initial.setAttribute('fill', color);
      initial.setAttribute('pointer-events', 'none');
      initial.textContent = TYPE_INITIALS[n.kind] || '?';
      g.appendChild(initial);

      var label = document.createElementNS(NS, 'text');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('y', String(r + 12));
      label.setAttribute('font-size', '9');
      label.setAttribute('fill', 'var(--color-muted)');
      label.setAttribute('pointer-events', 'none');
      label.textContent = n.title.length > 30 ? n.title.slice(0, 30) + '...' : n.title;
      g.appendChild(label);

      // Single click: highlight hub (neighbours bright, rest dim).
      // Double click: navigate to entity detail.
      var clickTimer = null;
      g.addEventListener('click', function(evt) {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
        clickTimer = setTimeout(function() {
          clickTimer = null;
          // Find neighbour IDs from the links array.
          var neighborIds = new Set();
          neighborIds.add(n.id);
          links.forEach(function(e) {
            var src = e.source.id || e.source;
            var tgt = e.target.id || e.target;
            if (src === n.id) neighborIds.add(tgt);
            if (tgt === n.id) neighborIds.add(src);
          });
          // Dim everything, then highlight neighbours.
          var isAlreadyFocused = g.getAttribute('data-focused') === '1';
          nodeEls.forEach(function(el) { el.style.opacity = isAlreadyFocused ? '1' : '0.15'; el.removeAttribute('data-focused'); });
          lineEls.forEach(function(el) { el.setAttribute('stroke-opacity', isAlreadyFocused ? '0.4' : '0.05'); });
          edgeLabelEls.forEach(function(el) { el.setAttribute('opacity', isAlreadyFocused ? '0.5' : '0.05'); });
          if (!isAlreadyFocused) {
            g.setAttribute('data-focused', '1');
            nodeEls.forEach(function(el, i) {
              if (neighborIds.has(nodes[i].id)) { el.style.opacity = '1'; }
            });
            lineEls.forEach(function(el, i) {
              var src = links[i].source.id || links[i].source;
              var tgt = links[i].target.id || links[i].target;
              if (neighborIds.has(src) && neighborIds.has(tgt)) {
                el.setAttribute('stroke-opacity', '0.8');
              }
            });
            edgeLabelEls.forEach(function(el, i) {
              var src = links[i].source.id || links[i].source;
              var tgt = links[i].target.id || links[i].target;
              if (neighborIds.has(src) && neighborIds.has(tgt)) {
                el.setAttribute('opacity', '0.9');
              }
            });
          }
        }, 250);
      });
      g.addEventListener('dblclick', function() {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        window.location.href = '/entities/' + encodeURIComponent(n.id);
      });
      g.addEventListener('mouseenter', function(evt) {
        circle.setAttribute('stroke-width', isOrphan ? '2.5' : '3');
        var edgeCountLine = (typeof n.edge_count === 'number')
          ? (n.edge_count + (n.edge_count === 1 ? ' Kante' : ' Kanten'))
          : '';
        var parts = [
          { text: n.title, style: 'font-weight:600;margin-bottom:2px' },
          { text: n.kind + ' · ' + n.context, style: 'font-size:0.69rem;color:var(--color-subtle)' },
        ];
        if (edgeCountLine) {
          parts.push({ text: edgeCountLine + (isOrphan ? ' (orphan)' : ''), style: 'font-size:0.69rem;color:var(--color-subtle);margin-top:2px' });
        }
        setTooltip(tooltip, parts);
        tooltip.style.display = 'block';
        positionTooltip(evt, tooltip, container);
      });
      g.addEventListener('mousemove', function(evt) { positionTooltip(evt, tooltip, container); });
      g.addEventListener('mouseleave', function() {
        circle.setAttribute('stroke-width', isOrphan ? '1.5' : '2');
        tooltip.style.display = 'none';
      });

      d3.select(g).call(drag);
      nodeGroup.appendChild(g);
      return g;
    });
    rootG.appendChild(nodeGroup);

    // Zoom & pan
    var zoom = d3.zoom().scaleExtent([0.3, 3]).on('zoom', function(event) {
      rootG.setAttribute('transform', event.transform.toString());
    });
    d3.select(svgEl).call(zoom);

    // Shorten edge endpoints so lines start at the source circle border
    // and the arrowhead sits just outside the target circle border
    // instead of disappearing inside it.
    var START_OFFSET = r + 1;              // leave the source circle
    var END_OFFSET = r + 6;                // leave room for arrowhead (marker is 6 high)
    var MIN_DIST = START_OFFSET + END_OFFSET + 2;

    sim.on('tick', function() {
      lineEls.forEach(function(line, i) {
        var d = links[i];
        var dx = d.target.x - d.source.x;
        var dy = d.target.y - d.source.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_DIST) {
          // Nodes are basically on top of each other — hide the line
          // for this tick rather than flipping it backwards.
          line.setAttribute('x1', d.source.x);
          line.setAttribute('y1', d.source.y);
          line.setAttribute('x2', d.source.x);
          line.setAttribute('y2', d.source.y);
          return;
        }
        var ux = dx / dist;
        var uy = dy / dist;
        line.setAttribute('x1', d.source.x + ux * START_OFFSET);
        line.setAttribute('y1', d.source.y + uy * START_OFFSET);
        line.setAttribute('x2', d.target.x - ux * END_OFFSET);
        line.setAttribute('y2', d.target.y - uy * END_OFFSET);
      });
      edgeLabelEls.forEach(function(label, i) {
        var d = links[i];
        label.setAttribute('x', (d.source.x + d.target.x) / 2);
        label.setAttribute('y', (d.source.y + d.target.y) / 2);
      });
      nodeEls.forEach(function(g, i) {
        g.setAttribute('transform', 'translate(' + nodes[i].x + ',' + nodes[i].y + ')');
      });
    });
  }

  // Kind-filter checkboxes in the legend panel: toggle visibility of
  // nodes (and their edges) when a checkbox is unchecked.
  function setupFilters() {
    var checks = document.querySelectorAll('[data-kind-filter]');
    checks.forEach(function(cb) {
      cb.addEventListener('change', applyFilters);
    });
  }
  function applyFilters() {
    if (!graphData || !sim) return;
    var checks = document.querySelectorAll('[data-kind-filter]');
    var hidden = new Set();
    checks.forEach(function(cb) {
      if (!cb.checked) hidden.add(cb.getAttribute('data-kind-filter'));
    });
    var container = document.getElementById('graph-container');
    var svgEl = document.getElementById('graph-svg');
    var tooltip = document.getElementById('graph-tooltip');
    // Re-render with filtered data.
    var filtered = {
      nodes: graphData.nodes.filter(function(n) { return !hidden.has(n.kind); }),
      edges: graphData.edges
    };
    var visIds = new Set(filtered.nodes.map(function(n) { return n.id; }));
    filtered.edges = graphData.edges.filter(function(e) {
      return visIds.has(e.source.id || e.source) && visIds.has(e.target.id || e.target);
    });
    // Swap graphData temporarily and re-render.
    var orig = graphData;
    graphData = filtered;
    renderGraph(container, svgEl, tooltip);
    graphData = orig;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { loadGraph(); setupFilters(); });
  } else {
    loadGraph();
    setupFilters();
  }
})();
`;

export function renderGraphPage({ currentUser, csrfToken }: GraphPageOptions): string {
  // Keep in sync with TYPE_COLORS + TYPE_INITIALS in GRAPH_SCRIPT above —
  // the client-side and server-side copies are two halves of the same
  // palette. kind=skill was added in v0.0.5 Step 9.5; the amber tone
  // separates it from concept (blue) and template (green) which are
  // visually adjacent in the existing set.
  const kindColors: Array<[string, string, string]> = [
    ['concept', 'C', '#4a7a9b'], ['fact', 'F', '#7a4a9b'], ['decision', 'D', '#9b7a4a'],
    ['template', 'T', '#4a9b7a'], ['secret', 'S', '#9b4a4a'], ['config', 'G', '#6b7a9b'],
    ['project', 'P', '#4a7a4a'], ['task', 'K', '#9b9b4a'], ['document', 'M', '#5a6a8a'],
    ['note', 'N', '#8a8a5a'], ['inbox_item', 'I', '#7a8a9a'], ['user', 'U', '#9a7a7a'],
    ['tag', '#', '#7a9a8a'], ['skill', 'L', '#c97a3a'],
  ];
  const legendItems = kindColors.map(([kind, initial, color]) =>
    `<label style="display:flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap">
      <input type="checkbox" checked data-kind-filter="${kind}" style="accent-color:${color};margin:0">
      <svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="${color}22" stroke="${color}" stroke-width="1.5"/><text x="7" y="10" text-anchor="middle" font-size="7" font-weight="700" fill="${color}">${initial}</text></svg>
      <span style="font-size:0.69rem;color:var(--color-muted)">${kind}</span>
    </label>`
  ).join('');

  const body = `
<div style="display:flex;gap:0;flex:1;min-height:0">
  <div id="graph-legend" style="width:150px;flex-shrink:0;padding:0.62rem 0.77rem;background:var(--color-surface);border-right:1px solid var(--color-border);overflow-y:auto;display:flex;flex-direction:column;gap:4px">
    <div style="font-size:0.77rem;font-weight:700;color:var(--color-ink);margin-bottom:6px">Graph</div>

    <div style="margin-bottom:8px">
      <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-subtle);margin-bottom:2px">Context</div>
      <select id="graph-context-filter" style="width:100%;padding:3px 6px;font-size:0.77rem;background:var(--color-page);border:1px solid var(--color-border);border-radius:0.31rem;color:var(--color-body);cursor:pointer">
        <option value="">alle</option>
      </select>
    </div>

    <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-subtle);margin-bottom:2px">Kinds</div>
    ${legendItems}

    <div style="margin-top:10px;padding-top:6px;border-top:1px solid var(--color-border)">
      <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-subtle);margin-bottom:4px">Meta</div>
      <div id="graph-meta" style="display:flex;flex-direction:column;gap:2px"></div>
    </div>
  </div>
  <div id="graph-container" class="ecosystem-graph" style="position:relative;flex:1;background:var(--color-surface);overflow:hidden">
    <svg id="graph-svg" width="100%" height="100%"></svg>
    <div id="graph-tooltip" class="graph-tooltip" style="position:absolute;background:var(--color-page);border:1px solid var(--color-border);border-radius:0.46rem;padding:8px 12px;font-size:0.77rem;color:var(--color-body);box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:50;pointer-events:none;max-width:240px;display:none"></div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js" integrity="sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i" crossorigin="anonymous"></script>
<script>${GRAPH_SCRIPT}</script>
`;

  return layout({
    title: 'Graph',
    body,
    currentUser,
    activePath: '/graph',
    csrfToken,
    headExtra: `<style>
html{height:100%}
body{height:100%;margin:0;display:flex;flex-direction:column;overflow:hidden}
nav{flex-shrink:0}
.container{flex:1;overflow:hidden;padding:0 !important;min-height:0 !important;max-width:none !important;margin:0 !important;border-radius:0 !important;display:flex !important;flex-direction:column !important;background:transparent !important}
</style>`,
  });
}
