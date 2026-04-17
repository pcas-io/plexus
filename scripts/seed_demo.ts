/**
 * Demo seed script — populates an empty plexus instance with a neutral
 * Apollo-program-themed knowledge graph for screenshots, demos, and smoke
 * testing a fresh deployment.
 *
 * Usage:
 *   export PLEXUS_URL=http://localhost:8787
 *   export PLEXUS_TOKEN=pt_...         # personal token with write scope
 *   npx tsx scripts/seed_demo.ts
 *
 * All entities land in context `demo` so they can be listed / filtered / wiped
 * separately from real content. The script is idempotent-ish: re-running it
 * creates duplicates. Use `archive_entity` or reset the database to rerun
 * cleanly.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CONTEXT = 'demo';

const baseUrl = process.env.PLEXUS_URL ?? 'http://localhost:8787';
const token = process.env.PLEXUS_TOKEN;
if (!token) {
  console.error(
    'PLEXUS_TOKEN is required. Create a write-scoped personal token in the\n' +
      'dashboard under /tokens, then: export PLEXUS_TOKEN=pt_...'
  );
  process.exit(1);
}

interface EntitySpec {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly attributes?: Record<string, unknown>;
}

interface EdgeSpec {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
  readonly source?: 'manual' | 'llm-inferred' | 'computed' | 'imported';
}

const entities: EntitySpec[] = [
  {
    key: 'project.apollo',
    kind: 'project',
    title: 'Apollo Program',
    body: 'NASA human-spaceflight programme, 1961–1972. Goal set by President Kennedy: land a man on the Moon and return him safely to Earth before the decade is out. Six successful crewed lunar landings between 1969 and 1972.',
    attributes: { owner: 'NASA', start_year: 1961, end_year: 1972 },
  },
  {
    key: 'concept.lor',
    kind: 'concept',
    title: 'Lunar Orbit Rendezvous (LOR)',
    body: 'Mission mode in which the mothership stays in lunar orbit while a smaller lander descends to the surface and returns. Requires less fuel than Direct Ascent because only the lightweight lander has to decelerate and re-launch from the Moon.',
  },
  {
    key: 'concept.all-up',
    kind: 'concept',
    title: 'All-Up Testing',
    body: 'Test strategy in which the full vehicle stack is flown on every test rather than qualifying each stage in isolation. Higher per-flight risk but compresses the schedule — George Mueller\'s decision enabled the 1969 deadline.',
  },
  {
    key: 'decision.lor',
    kind: 'decision',
    title: 'ADR: Lunar Orbit Rendezvous over Direct Ascent',
    body: '## Context\n\nThree candidate mission modes: Direct Ascent (single huge rocket lands on the Moon), Earth Orbit Rendezvous (assemble in LEO), and Lunar Orbit Rendezvous (rendezvous around the Moon).\n\n## Decision\n\nAdopt Lunar Orbit Rendezvous.\n\n## Consequences\n\nTwo separately-designed spacecraft (Command/Service Module + Lunar Module). Saves propellant mass. Introduces the Apollo-specific risk of failed lunar rendezvous — mitigated by multiple redundant systems.',
    attributes: { status: 'accepted', adr_year: 1962 },
  },
  {
    key: 'decision.f1',
    kind: 'decision',
    title: 'ADR: F-1 engine for the Saturn V first stage',
    body: '## Context\n\nThe S-IC first stage needs roughly 34 MN of sea-level thrust. Options: clustered smaller engines (H-1 scaled up) vs. the single-nozzle F-1 under development at Rocketdyne.\n\n## Decision\n\nFive F-1 engines.\n\n## Consequences\n\nSingle-engine qualification instead of 40+. F-1 combustion stability problems require a years-long test campaign — absorbed into the schedule rather than scope-cut.',
    attributes: { status: 'accepted', adr_year: 1961 },
  },
  {
    key: 'decision.post-apollo1',
    kind: 'decision',
    title: 'ADR: Redesigned Apollo Command Module after Apollo 1 fire',
    body: '## Context\n\nThe Apollo 1 cabin fire on 1967-01-27 killed the prime crew during a plugs-out test. Root cause: pure-oxygen atmosphere at 16.7 psi + flammable materials + an inward-opening hatch that could not be opened against internal pressure.\n\n## Decision\n\nRedesign hatch (outward-opening, quick-release), replace flammable materials with self-extinguishing alternatives, change pre-launch atmosphere to 60% O₂ / 40% N₂, tighten electrical-wiring standards.\n\n## Consequences\n\n18-month hiatus of crewed flights. Block II Command Module is materially different from Block I — rebased qualification campaign.',
    attributes: { status: 'accepted', adr_year: 1967 },
  },
  {
    key: 'task.lm-design',
    kind: 'task',
    title: 'Design Lunar Module',
    body: 'Grumman-led design of the two-stage Lunar Module: descent stage (landing) + ascent stage (return to CSM).',
    attributes: { status: 'done', completed_year: 1968, is_milestone: true },
  },
  {
    key: 'task.saturn-v-test',
    kind: 'task',
    title: 'Ground-test Saturn V',
    body: 'Full-stack static-fire and vibration-test campaign at Marshall and Stennis. First flight article burns achieved late 1967.',
    attributes: { status: 'done', completed_year: 1967 },
  },
  {
    key: 'task.apollo11',
    kind: 'task',
    title: 'Apollo 11 — first crewed lunar landing',
    body: 'Armstrong, Aldrin, Collins. Launch 1969-07-16, lunar landing 1969-07-20 at Mare Tranquillitatis, splashdown 1969-07-24.',
    attributes: { status: 'done', completed_date: '1969-07-24', is_milestone: true },
  },
  {
    key: 'task.apollo13',
    kind: 'task',
    title: 'Apollo 13 — successful failure',
    body: 'Lovell, Swigert, Haise. SM oxygen-tank rupture 56 hours into flight. Moon landing aborted. Crew survived via LM-as-lifeboat improvisation. Splashdown 1970-04-17.',
    attributes: { status: 'done', completed_date: '1970-04-17', is_milestone: true },
  },
  {
    key: 'task.apollo17',
    kind: 'task',
    title: 'Apollo 17 — final Apollo lunar landing',
    body: 'Cernan, Evans, Schmitt. First and only Apollo crew to include a scientist (geologist Schmitt). Longest lunar-surface stay: 75 hours. Splashdown 1972-12-19.',
    attributes: { status: 'done', completed_date: '1972-12-19', is_milestone: true },
  },
  {
    key: 'fact.apollo1-fire',
    kind: 'fact',
    title: 'Apollo 1 cabin fire — three fatalities',
    body: 'During a plugs-out launch-pad test on 1967-01-27, a cabin fire killed astronauts Grissom, White, and Chaffee in 17 seconds. Direct trigger of the Command Module redesign.',
    attributes: { severity: 'critical', incident_date: '1967-01-27', category: 'incident' },
  },
  {
    key: 'fact.apollo13-abort',
    kind: 'fact',
    title: 'Apollo 13 oxygen-tank rupture',
    body: 'On 1970-04-13T03:07Z, roughly 56 hours into the flight, oxygen tank #2 in the Service Module ruptured after a stir of stratified contents ignited damaged Teflon insulation. Moon landing aborted; crew used the Lunar Module as a lifeboat for the return trajectory.',
    attributes: { severity: 'high', incident_date: '1970-04-13', category: 'incident' },
  },
  {
    key: 'fact.first-landing',
    kind: 'fact',
    title: 'First crewed lunar landing',
    body: 'Eagle landed at Mare Tranquillitatis on 1970-07-20T20:17Z. First human step on another world: Neil Armstrong, 1970-07-21T02:56Z.',
    attributes: { severity: 'info', milestone_date: '1969-07-20', category: 'milestone' },
  },
  {
    key: 'fact.program-end',
    kind: 'fact',
    title: 'Apollo programme concludes with Apollo 17',
    body: 'Apollo 18–20 were cancelled in 1970 due to budget pressure and shifting priorities toward Skylab and the Space Shuttle. The programme delivered six lunar landings and returned 382 kg of lunar samples.',
    attributes: { severity: 'info', milestone_date: '1972-12-19', category: 'milestone' },
  },
  {
    key: 'doc.apollo13-postmortem',
    kind: 'document',
    title: 'Apollo 13 Review Board Report',
    body: '## Summary\n\nCortright Commission findings, released 1970-06. Root cause traced to two manufacturing anomalies: tank #2 had been dropped during pre-flight handling, damaging an internal fill-line; then a 28-volt vs. 65-volt thermostat-switch mismatch allowed the tank\'s heaters to burn their Teflon insulation during a ground test, exposing wiring to the LOX.\n\n## Corrective actions\n\n- Add a third oxygen tank, isolatable from the main plumbing.\n- Redesign the tank heater assembly to tolerate 65 V.\n- Stainless-steel-sheathed heater wiring.\n- Add an emergency battery to the CSM.\n\n## Lessons\n\nA fault tolerated at one voltage became catastrophic after the spec changed — no single document carried the assumption across both teams.',
    attributes: { document_type: 'post-mortem', author: 'Cortright Commission', year: 1970 },
  },
  {
    key: 'doc.lm-activation',
    kind: 'document',
    title: 'Runbook: Lunar Module activation checklist',
    body: '## Pre-activation\n\n- [ ] Docking probe retracted, tunnel clear.\n- [ ] LM environment verified: 5.0 psi O₂, 21 °C.\n- [ ] Power-up sequence on LM Pilot station, descent stage batteries.\n\n## Activation\n\n1. Transfer to LM. Commander + LM Pilot only; CSM Pilot remains in Command Module.\n2. Close hatch; vent connecting tunnel to space.\n3. Verify Abort Guidance System (AGS) alignment against Primary Guidance (PGNCS) — maximum drift 0.5°.\n4. Undock — soft separation using PRA thrusters, no RCS firing until 10 m clearance.\n\n## Abort criteria\n\n- If AGS/PGNCS drift exceeds 1° → abort-to-orbit using AGS.\n- If descent-engine throttle hangs at max → jettison descent stage and abort-to-orbit on ascent stage.',
    attributes: { document_type: 'runbook' },
  },
  {
    key: 'note.nasa-chronology',
    kind: 'note',
    title: 'Source: NASA SP-4009 — The Apollo Spacecraft Chronology',
    body: 'Four-volume chronology of the Apollo spacecraft programme edited by Ivan D. Ertel et al., published 1969–1978. Primary source for decisions, milestones and dates used in this demo graph.',
    attributes: { source_type: 'primary', year: 1969 },
  },
];

const edges: EdgeSpec[] = [
  { from: 'task.lm-design', to: 'project.apollo', relation: 'part_of' },
  { from: 'task.saturn-v-test', to: 'project.apollo', relation: 'part_of' },
  { from: 'task.apollo11', to: 'project.apollo', relation: 'part_of' },
  { from: 'task.apollo13', to: 'project.apollo', relation: 'part_of' },
  { from: 'task.apollo17', to: 'project.apollo', relation: 'part_of' },

  { from: 'decision.lor', to: 'concept.lor', relation: 'derived_from' },
  { from: 'decision.f1', to: 'concept.all-up', relation: 'derived_from' },

  { from: 'decision.post-apollo1', to: 'fact.apollo1-fire', relation: 'triggered_by' },
  { from: 'doc.apollo13-postmortem', to: 'fact.apollo13-abort', relation: 'triggered_by' },

  { from: 'doc.apollo13-postmortem', to: 'task.apollo13', relation: 'documents' },
  { from: 'doc.lm-activation', to: 'task.lm-design', relation: 'documents' },

  { from: 'task.lm-design', to: 'decision.lor', relation: 'implements' },
  { from: 'task.saturn-v-test', to: 'decision.f1', relation: 'implements' },

  { from: 'fact.apollo1-fire', to: 'project.apollo', relation: 'mentions' },
  { from: 'fact.first-landing', to: 'task.apollo11', relation: 'mentions' },
  { from: 'fact.apollo13-abort', to: 'task.apollo13', relation: 'mentions' },
  { from: 'fact.program-end', to: 'task.apollo17', relation: 'mentions' },

  { from: 'note.nasa-chronology', to: 'project.apollo', relation: 'mentions' },
  { from: 'note.nasa-chronology', to: 'decision.lor', relation: 'mentions' },
  { from: 'note.nasa-chronology', to: 'fact.apollo1-fire', relation: 'mentions' },

  { from: 'task.apollo13', to: 'task.apollo11', relation: 'depends_on' },
  { from: 'task.apollo17', to: 'task.apollo13', relation: 'depends_on' },
  { from: 'task.apollo11', to: 'task.saturn-v-test', relation: 'depends_on' },
  { from: 'task.apollo11', to: 'task.lm-design', relation: 'depends_on' },
];

function textContent(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }> } | undefined;
  const block = r?.content?.find((c) => c.type === 'text');
  return block?.text ?? '';
}

function extractId(result: unknown): string {
  const text = textContent(result);
  const parsed = JSON.parse(text) as {
    id?: string;
    entity?: { id?: string };
    error?: unknown;
  };
  if (parsed.error) {
    throw new Error(`plexus returned error: ${JSON.stringify(parsed.error)}`);
  }
  const id = parsed.entity?.id ?? parsed.id;
  if (!id) {
    throw new Error(`plexus response missing id: ${text}`);
  }
  return id;
}

async function main(): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl.replace(/\/$/, '')}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'plexus-seed-demo', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);

  const ids = new Map<string, string>();

  console.log(`Seeding ${entities.length} entities into context "${CONTEXT}" at ${baseUrl}...`);
  for (const spec of entities) {
    const result = await client.callTool({
      name: 'save_entity',
      arguments: {
        kind: spec.kind,
        title: spec.title,
        body: spec.body,
        context: CONTEXT,
        ...(spec.attributes ? { attributes: spec.attributes } : {}),
      },
    });
    const id = extractId(result);
    ids.set(spec.key, id);
    console.log(`  + ${spec.kind.padEnd(8)} ${id}  ${spec.title}`);
  }

  console.log(`\nLinking ${edges.length} edges...`);
  let linked = 0;
  for (const edge of edges) {
    const fromId = ids.get(edge.from);
    const toId = ids.get(edge.to);
    if (!fromId || !toId) {
      console.warn(`  ! skipping ${edge.from} --${edge.relation}--> ${edge.to} (missing id)`);
      continue;
    }
    await client.callTool({
      name: 'link_entities',
      arguments: {
        from_id: fromId,
        to_id: toId,
        relation: edge.relation,
        source: edge.source ?? 'manual',
      },
    });
    linked += 1;
    console.log(`  + ${edge.from} --${edge.relation}--> ${edge.to}`);
  }

  await client.close();
  console.log(`\nDone. Seeded ${entities.length} entities and ${linked} edges in context "${CONTEXT}".`);
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
