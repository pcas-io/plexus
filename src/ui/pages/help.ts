/**
 * Help page — /help.
 *
 * In-dashboard documentation covering the first-run bootstrap,
 * entities, edges, kinds, contexts, MCP, auth flows, passkeys, share
 * links, token scoping, graph view, admin tools.
 */

import type { User } from '../../db/repositories/users.js';
import { layout } from '../layout.js';

interface HelpOptions {
  readonly currentUser: User;
  readonly csrfToken: string;
}

export function renderHelpPage({ currentUser, csrfToken }: HelpOptions): string {
  const body = `
<h1>Help</h1>
<p class="subtitle">Everything you need to know about plexus — for humans and agents.</p>

<div class="markdown-content">

<h2>What is plexus?</h2>
<p>plexus is a self-hosted knowledge graph for AI agents. Instead of rebuilding context for every question, plexus accumulates knowledge incrementally: facts, decisions, concepts, projects — all as typed entities with named connections between them.</p>
<p>Your AI assistant (Claude web, Claude Desktop, Claude Code) reaches the whole graph through the Model Context Protocol (MCP). The dashboard is read-only for humans; only agents write.</p>

<h2>First run: the bootstrap</h2>
<p>When plexus boots for the very first time on a fresh database, no user exists yet. The admin token from <code>PLEXUS_ADMIN_TOKEN</code> is used once to create the first admin account, then becomes irrelevant for day-to-day use.</p>
<ol>
<li>Open the dashboard URL (<code>http://localhost:8787</code> by default). Plexus detects that no user exists and redirects to <code>/bootstrap</code>.</li>
<li>Enter an admin name (letters, digits, <code>_</code>, <code>-</code>, <code>.</code>). Submit. This uses the <code>PLEXUS_ADMIN_TOKEN</code> via a cookie set by the login flow — you never paste the admin token in the browser.</li>
<li>Plexus creates the admin user and shows a personal token (<code>pt_...</code>) <strong>exactly once</strong>. Copy it into your password manager <em>right now</em>.</li>
<li>Click <strong>Continue to login</strong>. You land on <code>/auth/login</code>.</li>
<li>Paste the <code>pt_</code> token. Plexus sees you have no passkey yet and shows the enrollment screen.</li>
<li>Click <strong>Register passkey now</strong>. Your browser prompts for Touch&nbsp;ID / Face&nbsp;ID / Windows&nbsp;Hello / a hardware key.</li>
<li>Plexus <strong>automatically rotates your token</strong> after enrollment and shows the new one. The initial token is now dead. Save the new token (overwrite the old entry in your password manager).</li>
<li>Click <strong>Sign in with new token</strong>. Paste the rotated token, confirm with the passkey — you land on <code>/home</code>.</li>
</ol>
<p><strong>Why the rotation?</strong> The initial token is a one-shot invitation code. If anything intercepted it during transfer (mail, chat, screen share), rotation makes that capture worthless the moment you sign in. After rotation, only the new token + passkey combination signs you in.</p>
<p>From now on the <code>PLEXUS_ADMIN_TOKEN</code> environment variable is only used for admin-plane endpoints (e.g. <code>POST /admin/backup</code> and the low-level reset endpoints). It is <strong>rejected on the MCP endpoint</strong> and on the dashboard login after bootstrap.</p>

<h2>Entities &amp; kinds</h2>
<p>Every piece of knowledge is an <strong>entity</strong> with a typed <strong>kind</strong>. The built-in kinds:</p>
<div class="table-wrapper">
<table>
<thead><tr><th>Kind</th><th>Purpose</th></tr></thead>
<tbody>
<tr><td><code>concept</code></td><td>Abstract idea, concept, pattern</td></tr>
<tr><td><code>decision</code></td><td>Architecture Decision Record (ADR), decision</td></tr>
<tr><td><code>fact</code></td><td>Atomic fact, risk, milestone, incident</td></tr>
<tr><td><code>project</code></td><td>Project container</td></tr>
<tr><td><code>task</code></td><td>Task, todo</td></tr>
<tr><td><code>document</code></td><td>Document with structured content</td></tr>
<tr><td><code>note</code></td><td>Free-form note, source, provenance anchor</td></tr>
<tr><td><code>config</code></td><td>Configuration values, URLs, deployment info</td></tr>
<tr><td><code>secret</code></td><td>Encrypted secret — not shareable, not MCP-readable</td></tr>
<tr><td><code>template</code></td><td>Reusable template, skill, pattern</td></tr>
<tr><td><code>skill</code></td><td>Plexus skill (markdown body + trigger phrases)</td></tr>
<tr><td><code>tag</code></td><td>Categorisation tag</td></tr>
<tr><td><code>inbox_item</code></td><td>GTD inbox entry</td></tr>
<tr><td><code>user</code></td><td>User reference</td></tr>
</tbody>
</table>
</div>
<p>Entities are created <strong>only through MCP</strong> — the dashboard is read-only for content.</p>

<h2>Edges &amp; relations</h2>
<p>Connections between entities are called <strong>edges</strong>. Each edge carries a typed <strong>relation</strong>:</p>
<p><code>contains</code>, <code>part_of</code>, <code>depends_on</code>, <code>blocks</code>, <code>supersedes</code>, <code>documents</code>, <code>implements</code>, <code>relates_to</code>, <code>derived_from</code>, <code>triggered_by</code>, <code>produces</code>, <code>consumes</code>, <code>mentions</code>, <code>owned_by</code>, <code>executed_by</code>, <code>has_version</code>, <code>variant_of</code>, and more.</p>
<p>Edges are <strong>temporal</strong>: they carry <code>valid_from</code> and <code>valid_to</code>. "Deleting" sets <code>valid_to</code> — the edge stays as history. <code>get_related(as_of: …)</code> returns the graph at any point in the past.</p>

<h2>Contexts</h2>
<p>Contexts are <strong>implicit namespaces</strong>. A context is created automatically when an agent saves an entity with a new context string:</p>
<p><code>save_entity({ kind: "concept", title: "My topic", context: "my-project" })</code></p>
<p>From that moment on the context appears in every filter. It disappears automatically once no active entities reference it. No registry, no admin step.</p>

<h2>Connecting an agent (MCP)</h2>
<p><strong>Claude web (claude.ai):</strong> Settings → Integrations → Add Custom Integration → <code>https://&lt;your-plexus-host&gt;/mcp</code>. Plexus handles OAuth automatically — you'll see a consent screen and click <em>Allow</em>.</p>
<p><strong>Claude Code (CLI):</strong></p>
<pre><code>claude mcp add plexus --transport http \\
  --header "Authorization: Bearer pt_YOUR_TOKEN" \\
  https://&lt;your-plexus-host&gt;/mcp</code></pre>
<p><strong>Claude Desktop:</strong> edit <code>~/Library/Application&nbsp;Support/Claude/claude_desktop_config.json</code>:</p>
<pre><code>{
  "mcpServers": {
    "plexus": {
      "type": "http",
      "url": "https://&lt;your-plexus-host&gt;/mcp",
      "headers": { "Authorization": "Bearer pt_YOUR_TOKEN" }
    }
  }
}</code></pre>
<p>Plexus exposes 15 MCP tools: <code>save_entity</code>, <code>get_entity</code>, <code>list_entities</code>, <code>search_entities</code>, <code>update_entity</code>, <code>archive_entity</code>, <code>link_entities</code>, <code>unlink_entity</code>, <code>get_related</code>, <code>list_kinds</code>, <code>list_relations</code>, <code>context_load</code>, <code>lint_graph</code>, <code>list_skills</code>, <code>load_skill</code>.</p>

<h2>Inviting additional users</h2>
<p>After the bootstrap, add users from <a href="/users">/users</a> (admin only):</p>
<ol>
<li>Admin creates a user on <a href="/users">/users</a>. An initial <code>pt_</code> token is shown <em>once</em>.</li>
<li>Admin hands the token to the new user through a secure channel.</li>
<li>New user opens <a href="/auth/login">/auth/login</a>, enters the token.</li>
<li>Passkey enrollment: Touch&nbsp;ID / Face&nbsp;ID / YubiKey / Windows&nbsp;Hello.</li>
<li><strong>Token is automatically rotated</strong> — the new token is shown, the old one is dead.</li>
<li>User saves the new token in a password manager.</li>
<li>User clicks <em>Sign in with new token</em> → final sign-in with the new token + passkey.</li>
</ol>
<p>Same reasoning as the bootstrap rotation: the initial token is a one-shot invitation. If it leaks in transit, it is worthless after the first successful enrollment.</p>

<h2>Passkeys</h2>
<p>Every account needs <strong>at least one passkey</strong>. You can register up to 3 (e.g. laptop + phone + hardware key as backup).</p>
<p>Manage passkeys on <a href="/passkeys">/passkeys</a>. The last passkey cannot be deleted.</p>
<p>For every sign-in and for sensitive actions (creating a share link, resetting a token) plexus enforces <strong>biometric or PIN verification</strong> — a simple tap without verification is not accepted.</p>

<h2>Users vs. tokens</h2>
<p>In plexus, <strong>users</strong> and <strong>tokens</strong> are separate concepts:</p>
<div class="table-wrapper">
<table>
<thead><tr><th>Concept</th><th>What it is</th><th>Where to manage it</th></tr></thead>
<tbody>
<tr><td><strong>User</strong></td><td>Account with name + passkey. Created by an admin.</td><td><a href="/users">/users</a> (admin only)</td></tr>
<tr><td><strong>Token</strong></td><td>MCP credential (<code>pt_…</code>) with its own scope. Each user can have many.</td><td><a href="/tokens">/tokens</a> (every user)</td></tr>
</tbody>
</table>
</div>

<h3>Why multiple tokens?</h3>
<p>Different clients need different rights:</p>
<div class="table-wrapper">
<table>
<thead><tr><th>Token label</th><th>Permission</th><th>Contexts</th><th>Purpose</th></tr></thead>
<tbody>
<tr><td>default</td><td>write</td><td>all</td><td>Normal MCP access (Claude web, Claude Code)</td></tr>
<tr><td>monitoring</td><td>read</td><td>dev</td><td>Read-only, dev context only</td></tr>
<tr><td>ci-pipeline</td><td>write</td><td>dev</td><td>CI job, expires after 30 days</td></tr>
</tbody>
</table>
</div>

<h3>Create a token</h3>
<p>On <a href="/tokens">/tokens</a> → <em>Create new token</em>:</p>
<ol>
<li>Pick a <strong>label</strong> (e.g. "Claude Code", "Monitoring")</li>
<li>Select a <strong>permission</strong>: <code>read</code> (read-only), <code>write</code> (read + write), <code>admin</code> (everything)</li>
<li>Optional <strong>expiry</strong> in days (token expires automatically after this many days)</li>
<li>Optional <strong>contexts</strong> (checkboxes — empty = all contexts allowed)</li>
<li>Optional <strong>kinds</strong> (checkboxes — empty = all kinds allowed)</li>
<li>Click <em>Create token</em> → the new <code>pt_</code> token is shown <strong>exactly once</strong>.</li>
</ol>
<p><strong>Save the token in your password manager immediately</strong> — it will never be shown again.</p>

<h3>Token scope enforcement</h3>
<p>Scope is checked on every MCP call:</p>
<ul>
<li>A <code>read</code> token can call <code>list_entities</code>, <code>search_entities</code>, <code>get_related</code> — but not <code>save_entity</code>, <code>update_entity</code>, <code>link_entities</code>.</li>
<li>A token with <code>contexts: [dev]</code> only sees entities in the <code>dev</code> context. A <code>save_entity</code> with <code>context: "private"</code> is rejected.</li>
<li>A token with <code>kinds: [concept, fact]</code> can only see and create concepts and facts.</li>
</ul>

<h3>Revoke a token</h3>
<p>On <a href="/tokens">/tokens</a> → <em>Revoke</em> per row. The last active token cannot be revoked (at least one must remain so you can still sign in).</p>

<h3>First sign-in: token rotation</h3>
<p>On first passkey enrollment, plexus rotates the token automatically. The initial token (the invitation the admin handed you) dies, a new one is shown. This protects against interception during transfer — the old token is worthless after the first sign-in.</p>

<h2>Share links</h2>
<p>You can share individual entities as <strong>one-time read-only links</strong>:</p>
<ol>
<li>Open an entity page → click <em>Share</em>.</li>
<li>Tap your passkey (biometric/PIN).</li>
<li>Share URLs are shown once in <strong>three variants</strong> (valid 60 minutes by default), each with a copy button.</li>
<li>The recipient opens the URL → sees the entity read-only, without signing in.</li>
<li>Second visit: <code>410 Gone</code> (the link is consumed).</li>
</ol>
<p><code>kind=secret</code> entities cannot be shared. At most one active link per entity. Manage open links on <a href="/shares">/shares</a>.</p>

<h3>Three output formats — one token, three audiences</h3>
<p>Every share token can be fetched in three formats via URL query parameters. All three share the same token and the same one-time consumption — whoever opens the browser link consumes the same token as someone pulling <code>?raw</code>. The dashboard shows you all three links at once after creation so you can pick the right one per recipient.</p>
<div class="table-wrapper">
<table>
<thead><tr><th>URL</th><th>Content-Type</th><th>Use</th></tr></thead>
<tbody>
<tr><td><code>/share/:token</code></td><td><code>text/html</code></td><td><strong>Human in browser</strong> — full dashboard layout with rendered markdown, attributes, badges. The default.</td></tr>
<tr><td><code>/share/:token?raw</code></td><td><code>text/markdown</code></td><td><strong>LLM or terminal</strong> — verbatim markdown with metadata block. Pipe into <code>glow</code> for colour in the terminal, or into an agent context window without HTML noise.</td></tr>
<tr><td><code>/share/:token?raw=json</code></td><td><code>application/json</code></td><td><strong>CLI / automation</strong> — pretty JSON with every entity field except <code>created_by</code> / <code>updated_by</code>. Pipe into <code>jq</code>.</td></tr>
</tbody>
</table>
</div>
<p>Examples:</p>
<pre><code># Browser
open https://&lt;your-plexus-host&gt;/share/st_xxx

# Markdown to agent / terminal
curl -s 'https://&lt;your-plexus-host&gt;/share/st_xxx?raw' | glow -

# JSON for jq
curl -s 'https://&lt;your-plexus-host&gt;/share/st_xxx?raw=json' | jq '.body'</code></pre>
<p>Alternative parameter names <code>?format=md</code>, <code>?format=json</code>, <code>?format=html</code> work identically. Unknown format values fall back to HTML safely. The JSON output deliberately strips <code>created_by</code> / <code>updated_by</code> so anonymous recipients cannot see internal user IDs. The chosen format is logged (<code>activity_log.metadata.format</code>) so browser clicks can be distinguished from CLI automation.</p>

<h2>Graph view</h2>
<p>On <a href="/graph">/graph</a> the full knowledge graph is rendered as an interactive force layout:</p>
<ul>
<li>Nodes = entities. Colour and letter indicate the kind.</li>
<li>Edges = relations between entities, labelled.</li>
<li><strong>Single click</strong> on a node → <strong>hub focus</strong>: the node and its direct neighbours are highlighted, the rest is dimmed. Click again to release focus.</li>
<li><strong>Double click</strong> on a node → navigates to the entity detail.</li>
<li>Hover → tooltip with title + kind + context.</li>
<li>Scroll = zoom, drag = pan.</li>
<li>Left-hand legend: checkboxes toggle individual kinds on/off.</li>
</ul>

<h2>OAuth clients</h2>
<p>On <a href="/oauth/clients">/oauth/clients</a> you see which external applications (e.g. claude.ai) have access to your graph. You can revoke access at any time.</p>

<h2>lint_graph — graph health</h2>
<p>The <code>lint_graph</code> MCP tool checks the graph for:</p>
<ul>
<li><strong>Orphans:</strong> entities with no incoming or outgoing edges.</li>
<li><strong>Stale:</strong> entities untouched for N days.</li>
<li><strong>Duplicates:</strong> entities with identical titles.</li>
</ul>
<p>Call it regularly or have an agent run it as part of a weekly review.</p>

<h2>Backup</h2>
<p>Plexus exposes an admin-token-protected backup endpoint that exports the whole graph as portable JSON:</p>
<pre><code>curl -H "Authorization: Bearer \$PLEXUS_ADMIN_TOKEN" \\
  https://&lt;your-plexus-host&gt;/admin/backup \\
  &gt; backup.json</code></pre>
<p>The export contains: entities, edges, kinds, relations, users (without token hashes). It does <strong>not</strong> contain sessions, passkeys, OAuth tokens, personal tokens, or share tokens — credentials and session state are never backed up. Pass <code>?include_audit=1</code> to add the last 1000 activity-log rows under a separate filename (opt-in because those rows contain personal data).</p>
<p>The format is DB-agnostic — the JSON file can be re-imported into any graph or relational database. Recommended: daily backup via cron.</p>

<h2>Admin tools</h2>
<ul>
<li><strong>Store reset</strong> (<code>POST /admin/db-reset</code>): deletes ALL data (users, entities, edges, everything). Requires the admin token plus the confirmation phrase <code>{"confirm":"RESET ALL USER STATE"}</code>. Kinds and relations survive.</li>
<li><strong>Auth reset</strong> (<code>POST /admin/auth-reset</code>): deletes ONLY auth state (users, sessions, passkeys, tokens). Content (entities, edges, activity) survives. Confirmation phrase: <code>{"confirm":"RESET AUTH STATE"}</code>.</li>
<li><strong>Backup</strong> (<code>GET /admin/backup</code>): portable JSON export of the whole graph.</li>
</ul>

</div>
`;

  return layout({
    title: 'Help',
    body,
    currentUser,
    activePath: '/help',
    csrfToken,
  });
}
