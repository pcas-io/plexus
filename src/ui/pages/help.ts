/**
 * Help page — /help.
 *
 * In-Dashboard documentation covering all plexus features: entities,
 * edges, kinds, contexts, MCP, auth flows, passkeys, share links,
 * token scoping, graph view.
 */

import type { User } from '../../db/repositories/users.js';
import { layout } from '../layout.js';

interface HelpOptions {
  readonly currentUser: User;
  readonly csrfToken: string;
}

export function renderHelpPage({ currentUser, csrfToken }: HelpOptions): string {
  const body = `
<h1>Hilfe</h1>
<p class="subtitle">Alles was du ueber plexus wissen musst — fuer Menschen und Agenten.</p>

<div class="markdown-content">

<h2>Was ist plexus?</h2>
<p>plexus ist ein selbst-gehosteter Knowledge Graph fuer KI-Agenten. Statt bei jeder Frage den Kontext neu aufzubauen, akkumuliert plexus Wissen inkrementell: Fakten, Entscheidungen, Konzepte, Projekte — alles als typisierte Entities mit benannten Verbindungen.</p>
<p>Dein KI-Assistent (Claude Web, Claude Desktop, Claude Code) hat ueber MCP direkten Zugriff auf den gesamten Wissensgraph.</p>

<h2>Entities &amp; Kinds</h2>
<p>Jeder Wissens-Eintrag ist eine <strong>Entity</strong> mit einem <strong>Kind</strong> (Typ). Die verfuegbaren Kinds:</p>
<div class="table-wrapper">
<table>
<thead><tr><th>Kind</th><th>Zweck</th></tr></thead>
<tbody>
<tr><td><code>concept</code></td><td>Abstrakte Idee, Konzept, Pattern</td></tr>
<tr><td><code>decision</code></td><td>Architecture Decision Record (ADR), Entscheidung</td></tr>
<tr><td><code>fact</code></td><td>Atomare Faktenaussage, Risiko, Meilenstein</td></tr>
<tr><td><code>project</code></td><td>Projekt-Container</td></tr>
<tr><td><code>task</code></td><td>Aufgabe, Todo</td></tr>
<tr><td><code>document</code></td><td>Dokument mit strukturiertem Inhalt</td></tr>
<tr><td><code>note</code></td><td>Freie Notiz, Quelle, Provenance-Anker</td></tr>
<tr><td><code>config</code></td><td>Konfigurationswerte, URLs, Deployment-Infos</td></tr>
<tr><td><code>secret</code></td><td>Verschluesseltes Geheimnis (nicht shareable)</td></tr>
<tr><td><code>template</code></td><td>Wiederverwendbares Template, Skill, Pattern</td></tr>
<tr><td><code>tag</code></td><td>Kategorisierungs-Tag</td></tr>
<tr><td><code>inbox_item</code></td><td>GTD-Inbox-Eintrag</td></tr>
<tr><td><code>user</code></td><td>User-Referenz</td></tr>
</tbody>
</table>
</div>
<p>Entities werden <strong>ausschliesslich ueber MCP</strong> angelegt — das Dashboard ist read-only fuer Content.</p>

<h2>Edges &amp; Relations</h2>
<p>Verbindungen zwischen Entities heissen <strong>Edges</strong>. Jede Edge hat eine typisierte <strong>Relation</strong>:</p>
<p><code>contains</code>, <code>part_of</code>, <code>depends_on</code>, <code>blocks</code>, <code>supersedes</code>, <code>documents</code>, <code>implements</code>, <code>relates_to</code>, <code>derived_from</code>, <code>triggered_by</code>, <code>produces</code>, <code>consumes</code>, <code>mentions</code>, <code>owned_by</code>, <code>executed_by</code>, <code>has_version</code>, <code>variant_of</code>, und mehr.</p>
<p>Edges sind <strong>temporal</strong>: sie haben <code>valid_from</code> und <code>valid_to</code>. "Loeschen" setzt <code>valid_to</code> — die Edge bleibt als Historie erhalten.</p>

<h2>Contexts</h2>
<p>Contexts sind <strong>implizite Namespaces</strong>. Ein Context entsteht automatisch wenn ein Agent eine Entity mit einem neuen Context-String anlegt:</p>
<p><code>save_entity({ kind: "concept", title: "Mein Thema", context: "mein-projekt" })</code></p>
<p>Ab sofort taucht der Context in allen Filtern auf. Er verschwindet automatisch wenn keine aktiven Entities mehr drin sind. Es gibt keine Registry, keinen Admin-Schritt.</p>

<h2>MCP-Anbindung</h2>
<p><strong>Claude Web (claude.ai):</strong> Settings → Integrations → Add Custom Integration → <code>https://<your-plexus-host>/mcp</code>. plexus handelt OAuth automatisch — du siehst einen Consent-Screen und klickst "Zulassen".</p>
<p><strong>Claude Code (CLI):</strong></p>
<p><code>claude mcp add plexus --transport http --header "Authorization: Bearer pt_DEIN_TOKEN" https://<your-plexus-host>/mcp</code></p>
<p><strong>Claude Desktop:</strong> In <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>:</p>
<pre><code>{
  "mcpServers": {
    "plexus": {
      "type": "http",
      "url": "https://<your-plexus-host>/mcp",
      "headers": { "Authorization": "Bearer pt_DEIN_TOKEN" }
    }
  }
}</code></pre>
<p>13 MCP-Tools stehen zur Verfuegung: <code>save_entity</code>, <code>get_entity</code>, <code>list_entities</code>, <code>search_entities</code>, <code>update_entity</code>, <code>archive_entity</code>, <code>link_entities</code>, <code>unlink_entity</code>, <code>get_related</code>, <code>list_kinds</code>, <code>list_relations</code>, <code>context_load</code>, <code>lint_graph</code>.</p>

<h2>User-Onboarding</h2>
<ol>
<li>Admin erstellt User unter <a href="/users">/users</a> → initialer <code>pt_</code>-Token wird einmalig angezeigt</li>
<li>Admin uebergibt Token an den neuen User (sicherer Kanal)</li>
<li>User oeffnet <a href="/auth/login">/auth/login</a> und gibt den Token ein</li>
<li>Passkey-Enrollment: Touch ID / Face ID / YubiKey tappen</li>
<li><strong>Token wird automatisch rotiert</strong> — neuer Token wird angezeigt, alter ist tot</li>
<li>User speichert neuen Token im Passwort-Manager</li>
<li>User klickt "Mit neuem Token einloggen" → Login mit neuem Token + Passkey</li>
</ol>
<p>Der initiale Token ist ein Einmal-Einladungs-Code. Wenn er bei der Uebertragung abgefangen wird, ist das irrelevant — er ist nach dem ersten Login entwertet.</p>

<h2>Passkeys</h2>
<p>Jeder Account braucht <strong>mindestens einen Passkey</strong>. Du kannst bis zu 3 registrieren (z.B. Laptop + Handy + YubiKey als Backup).</p>
<p>Verwalte deine Passkeys unter <a href="/passkeys">/passkeys</a>. Der letzte Passkey laesst sich nicht loeschen.</p>
<p>Bei jedem Login und bei sensiblen Aktionen (Share-Link erstellen, Token resetten) wird <strong>Biometrie oder PIN erzwungen</strong> — ein einfacher Tap ohne Verifikation reicht nicht.</p>

<h2>Users vs. Tokens</h2>
<p>In plexus sind <strong>User</strong> und <strong>Tokens</strong> getrennte Konzepte:</p>
<div class="table-wrapper">
<table>
<thead><tr><th>Konzept</th><th>Was es ist</th><th>Wo verwaltet</th></tr></thead>
<tbody>
<tr><td><strong>User</strong></td><td>Account mit Name + Passkey. Wird vom Admin erstellt.</td><td><a href="/users">/users</a> (nur Admin)</td></tr>
<tr><td><strong>Token</strong></td><td>MCP-Zugangsschluessel (<code>pt_...</code>) mit eigenem Scope. Jeder User kann mehrere haben.</td><td><a href="/tokens">/tokens</a> (jeder User)</td></tr>
</tbody>
</table>
</div>

<h3>Warum mehrere Tokens?</h3>
<p>Verschiedene Clients brauchen verschiedene Rechte:</p>
<div class="table-wrapper">
<table>
<thead><tr><th>Token-Label</th><th>Permission</th><th>Contexts</th><th>Zweck</th></tr></thead>
<tbody>
<tr><td>default</td><td>write</td><td>alle</td><td>Normaler MCP-Zugang (Claude Web, Claude Code)</td></tr>
<tr><td>monitoring</td><td>read</td><td>dev</td><td>Nur lesend, nur dev-Context</td></tr>
<tr><td>ci-pipeline</td><td>write</td><td>dev</td><td>CI-Job, laeuft nach 30 Tagen ab</td></tr>
</tbody>
</table>
</div>

<h3>Token erstellen</h3>
<p>Unter <a href="/tokens">/tokens</a> → "Neuen Token erstellen":</p>
<ol>
<li><strong>Label</strong> vergeben (z.B. "Claude Code", "Monitoring")</li>
<li><strong>Permission</strong> waehlen: <code>read</code> (nur lesen), <code>write</code> (lesen + schreiben), <code>admin</code> (alles)</li>
<li><strong>Ablauf</strong> optional setzen (Tage bis der Token automatisch ablaeuft)</li>
<li><strong>Contexts</strong> optional einschraenken (Checkboxen — leer = alle Contexts erlaubt)</li>
<li><strong>Kinds</strong> optional einschraenken (Checkboxen — leer = alle Kinds erlaubt)</li>
<li>"Token erstellen" klicken → der neue <code>pt_</code>-Token wird <strong>einmalig</strong> angezeigt</li>
</ol>
<p><strong>Wichtig:</strong> Den Token sofort im Passwort-Manager speichern — er wird nie wieder angezeigt.</p>

<h3>Token-Scope-Enforcement</h3>
<p>Der Scope wird bei jedem MCP-Call automatisch geprueft:</p>
<ul>
<li>Ein <code>read</code>-Token kann <code>list_entities</code>, <code>search_entities</code>, <code>get_related</code> aufrufen — aber nicht <code>save_entity</code>, <code>update_entity</code>, <code>link_entities</code></li>
<li>Ein Token mit <code>contexts: [dev]</code> sieht nur Entities im <code>dev</code>-Context. Ein <code>save_entity</code> mit <code>context: "privat"</code> wird abgelehnt.</li>
<li>Ein Token mit <code>kinds: [concept, fact]</code> kann nur Concepts und Facts sehen und anlegen.</li>
</ul>

<h3>Token widerrufen</h3>
<p>Unter <a href="/tokens">/tokens</a> → "Revoke" Button pro Token. Der letzte aktive Token kann nicht widerrufen werden (mindestens einer muss bleiben).</p>

<h3>Erster Login: Token-Rotation</h3>
<p>Beim ersten Passkey-Enrollment wird der Token automatisch rotiert. Der initiale Token (den der Admin uebergeben hat) stirbt, ein neuer wird angezeigt. Das schuetzt gegen Abfangen bei der Uebertragung — der alte Token ist nach dem ersten Login wertlos.</p>

<h2>Share-Links</h2>
<p>Du kannst einzelne Entities als <strong>einmalige Read-Only-Links</strong> teilen:</p>
<ol>
<li>Entity-Detail oeffnen → "Teilen (Step-Up Passkey)" klicken</li>
<li>Passkey tappen (Biometrie/PIN)</li>
<li>Share-URLs werden einmalig in <strong>drei Varianten</strong> angezeigt (60 Minuten gueltig), jeweils mit Copy-Button</li>
<li>Empfaenger oeffnet die URL → sieht die Entity read-only, ohne Login</li>
<li>Zweiter Aufruf: 410 Gone (Link ist verbraucht)</li>
</ol>
<p><code>kind=secret</code> Entities koennen nicht geteilt werden. Pro Entity maximal ein aktiver Link. Verwalte offene Links unter <a href="/shares">/shares</a>.</p>

<h3>Drei Output-Formate — ein Token, drei Audiences</h3>
<p>Jeder Share-Token kann in drei Formaten abgerufen werden, ueber URL-Query-Parameter. Alle drei Varianten teilen sich denselben Token und denselben Einmal-Consume — wer den Link im Browser oeffnet, verbraucht denselben Token, den jemand mit <code>?raw</code> abruft. Das Dashboard zeigt dir nach dem Erstellen alle drei Links gleichzeitig mit Copy-Buttons an, damit du dir die richtige Variante fuer den richtigen Empfaenger aussuchen kannst.</p>
<div class="table-wrapper">
<table>
<thead><tr><th>URL</th><th>Content-Type</th><th>Wofuer</th></tr></thead>
<tbody>
<tr><td><code>/share/:token</code></td><td><code>text/html</code></td><td><strong>Mensch im Browser</strong> — voll gerendertes Dashboard-Layout mit Markdown-Body, Attributes, Badges. Der Standard-Link.</td></tr>
<tr><td><code>/share/:token?raw</code></td><td><code>text/markdown</code></td><td><strong>LLM oder Terminal</strong> — verbatim Markdown mit Metadata-Block. Pipe es in <code>glow</code> fuer farbige Terminal-Anzeige oder in einen Agent-Context-Window ohne HTML-Rauschen.</td></tr>
<tr><td><code>/share/:token?raw=json</code></td><td><code>application/json</code></td><td><strong>CLI / Automation</strong> — pretty-printed JSON mit allen Entity-Feldern ausser <code>created_by</code> / <code>updated_by</code>. Pipe es in <code>jq</code> fuer strukturierten Zugriff auf einzelne Felder.</td></tr>
</tbody>
</table>
</div>
<p>Beispiele fuer die drei Varianten:</p>
<pre><code># Browser
open https://<your-plexus-host>/share/st_xxx

# Markdown an Agent/Terminal
curl -s 'https://<your-plexus-host>/share/st_xxx?raw' | glow -

# JSON fuer jq
curl -s 'https://<your-plexus-host>/share/st_xxx?raw=json' | jq '.body'</code></pre>
<p>Alternative Parameter-Namen <code>?format=md</code>, <code>?format=json</code>, <code>?format=html</code> funktionieren identisch. Unknown-Format-Werte fallen sicher auf HTML zurueck. Der JSON-Output strippt bewusst <code>created_by</code> und <code>updated_by</code>, damit anonyme Empfaenger keine internen User-IDs sehen. Das gewaehlte Format wird im Activity-Log mitgeschrieben (<code>metadata.format</code>), damit Browser-Klicks von CLI-Automation trennbar sind.</p>

<h2>Graph-Ansicht</h2>
<p>Unter <a href="/graph">/graph</a> siehst du den gesamten Wissensgraph als interaktives Force-Layout:</p>
<ul>
<li>Knoten = Entities, Farbe = Kind, Buchstabe = Typ-Kuerzel</li>
<li>Kanten = Edges mit Relation-Label</li>
<li><strong>Einfach-Klick</strong> auf Knoten → <strong>Hub-Fokus</strong>: der Knoten und seine direkten Nachbarn werden hervorgehoben, der Rest wird gedimmt. Nochmal klicken hebt den Fokus auf.</li>
<li><strong>Doppelklick</strong> auf Knoten → navigiert zum Entity-Detail</li>
<li>Hover → Tooltip mit Titel + Kind + Context</li>
<li>Scroll = Zoom, Drag = Verschieben</li>
<li>Legende links: Checkboxen zum Ein-/Ausblenden einzelner Kinds</li>
</ul>

<h2>OAuth-Clients</h2>
<p>Unter <a href="/oauth/clients">/oauth/clients</a> siehst du welche externen Anwendungen (z.B. claude.ai) auf deinen Graph zugreifen. Du kannst den Zugriff jederzeit widerrufen.</p>

<h2>lint_graph — Graph-Gesundheit</h2>
<p>Das MCP-Tool <code>lint_graph</code> prueft den Graph auf:</p>
<ul>
<li><strong>Orphans:</strong> Entities ohne jede Verbindung</li>
<li><strong>Stale:</strong> Entities die seit X Tagen nicht aktualisiert wurden</li>
<li><strong>Duplikate:</strong> Entities mit identischem Titel</li>
</ul>
<p>Ruf es regelmaessig auf oder lass einen Agent es als Teil des Weekly Review machen.</p>

<h2>Backup</h2>
<p>plexus bietet einen Admin-Token-geschuetzten Backup-Endpoint der den gesamten Graph als portables JSON exportiert:</p>
<pre><code>curl -H "Authorization: Bearer ADMIN_TOKEN" https://<your-plexus-host>/admin/backup > backup.json</code></pre>
<p>Der Export enthaelt: Entities, Edges, Kinds, Relations, Users (ohne Token-Hashes), Activity-Log (letzte 1000). Er enthaelt NICHT: Sessions, Passkeys, OAuth-Tokens, Share-Tokens (Sicherheit).</p>
<p>Das Format ist DB-agnostisch — die JSON-Datei kann in jede beliebige Graph-DB oder relationale DB importiert werden. Empfehlung: taeglich per Cron-Job sichern.</p>

<h2>Admin-Tools</h2>
<ul>
<li><strong>Store-Reset</strong> (<code>POST /admin/db-reset</code>): Loescht ALLE Daten (Users, Entities, Edges, alles). Benoetigt Admin-Token + Bestaetigungsphrase <code>{"confirm":"RESET ALL USER STATE"}</code>. Kinds und Relations bleiben erhalten.</li>
<li><strong>Auth-Reset</strong> (<code>POST /admin/auth-reset</code>): Loescht NUR Auth-State (Users, Sessions, Passkeys, Tokens). Content (Entities, Edges, Activity) bleibt erhalten. Bestaetigungsphrase: <code>{"confirm":"RESET AUTH STATE"}</code>.</li>
<li><strong>Backup</strong> (<code>GET /admin/backup</code>): Portabler JSON-Export des gesamten Graphen.</li>
</ul>

</div>
`;

  return layout({
    title: 'Hilfe',
    body,
    currentUser,
    activePath: '/help',
    csrfToken,
  });
}
