'use strict';

/**
 * hermes-plugins.cjs — Hydo's "Connected apps" / Plugins surface, backed
 * entirely by Hermes' MCP RPCs.
 *
 * THE CONTRACT (frozen — the Plugins UI is written against exactly this):
 *   listPlugins()      → { servers: [{ id, name, description, connected,
 *                                      needsAuth, toolCount }],
 *                          catalog: [{ id, name, description, category }] }
 *   addPlugin(id)      → { ok, ... }
 *   removePlugin(id)   → { ok, removed }
 *   testPlugin(id)     → { ok, toolCount, tools, error, needsAuth }
 *   startPluginAuth(id)→ { ok, sessionId, authUrl, flow }
 *   pollPluginAuth(id, sessionId) → { ok, status, authUrl, error }
 *
 * HERMES → CONTRACT MAPPING (every divergence adapted here, never in the UI):
 *
 *   id            ← the server / catalog entry NAME. Hermes has no separate
 *                   id: `mcp_servers` is a name-keyed map in config.yaml and
 *                   the catalog is keyed by `entry.name`. Names are the
 *                   identity in both, so id === name throughout.
 *                   (methods_tools.py:1988, :1916)
 *
 *   description   ← NOT returned by `mcp.servers.list` (mcp_rpc_helpers.py:44
 *                   `summarize_server` has no description field). Recovered by
 *                   joining the configured server back onto its catalog entry
 *                   by name. A hand-added server that is not in the catalog
 *                   has no description anywhere in Hermes, so it falls back to
 *                   a truthful one-liner built from its transport.
 *
 *   connected     ← config presence is not connectivity. A server counts as
 *                   connected when it is configured AND enabled AND, if it
 *                   uses OAuth, Hermes reports tokens on disk
 *                   (`oauth_tokens_present`). A real probe costs a cold `npx`
 *                   spawn per server, so listPlugins() never probes; the last
 *                   `testPlugin()` result for that server upgrades or
 *                   downgrades this flag from the probe cache.
 *
 *   needsAuth     ← true when auth is `oauth` and no token is on disk, or when
 *                   the catalog entry declares required env keys and the
 *                   configured entry references none. Hermes exposes env KEY
 *                   NAMES only (never values), so "declared but unreferenced"
 *                   is as far as this can honestly be resolved.
 *
 *   toolCount     ← the true count only exists after a probe
 *                   (`mcp.servers.test` → tools[]). Cached probes win. Without
 *                   one this is the length of the config's `tools` allow-list
 *                   when the user pinned a subset, else 0 meaning "unknown,
 *                   run testPlugin". It is never invented.
 *
 *   category      ← Hermes has NO category anywhere: `CatalogEntry`
 *                   (hermes_cli/mcp_catalog.py:148) carries name/description/
 *                   source/transport/auth/tools/install and nothing else.
 *                   Derived here from name + description keywords, defaulting
 *                   to "Other". This is the ONE field in the contract that is
 *                   a Hydo derivation rather than Hermes data.
 *
 *   addPlugin     ← `mcp.servers.add` cannot install a catalog entry: its
 *                   `preset` param resolves against `_MCP_PRESETS`
 *                   (hermes_cli/mcp_config.py:36), which contains exactly one
 *                   entry ("codex"), NOT the manifest catalog. The catalog
 *                   installer `mcp_catalog.install_entry` has no RPC of its
 *                   own. So an install runs Hermes' own non-interactive
 *                   installer through `cli.exec ['mcp','install',<id>]`
 *                   (methods_tools.py:371) rather than reimplementing the
 *                   manifest + git-bootstrap logic here.
 *
 * Main-process only. Never hand `request()` to the renderer.
 */

const gateway = require('./hermes-gateway.cjs');

/** name → last `mcp.servers.test` outcome: {ok, toolCount, at}. */
const probeCache = new Map();
const PROBE_TTL_MS = 5 * 60 * 1000;

/** name → the OAuth flow session id handed back by mcp.servers.oauth.start. */
const authFlows = new Map();

const EMPTY = { servers: [], catalog: [] };

// ── Category derivation (Hydo-side; Hermes has no category field) ─────────

const CATEGORY_RULES = [
  [/slack|discord|teams|telegram|matrix|chat|mail|gmail|inbox/i, 'Communication'],
  [/linear|jira|atlassian|asana|clickup|monday|notion|todo|task|kanban|shortcut/i, 'Project management'],
  [/figma|canva|design|image|video|render|gamma|craft/i, 'Design & media'],
  [/github|gitlab|buildkite|circleci|sentry|vercel|netlify|cloudflare|deploy|docker|kubernetes/i, 'Developer tools'],
  [/postgres|mysql|sqlite|mongo|redis|supabase|airtable|database|warehouse|snowflake|bigquery/i, 'Data & storage'],
  [/stripe|paypal|quickbooks|xero|invoice|billing|payment/i, 'Finance'],
  [/amplitude|mixpanel|posthog|analytics|datadog|grafana|betterstack|metric|monitor/i, 'Analytics & monitoring'],
  [/hubspot|salesforce|attio|close|intercom|crm|zendesk/i, 'Sales & support'],
  [/drive|dropbox|box|s3|storage|file/i, 'Files'],
  [/search|algolia|context7|deepwiki|docs|wiki|knowledge|browse|web/i, 'Search & docs'],
  [/calendar|calendly|schedul|meeting|fireflies/i, 'Calendar & meetings'],
];

/**
 * Bucket a catalog entry. Derived from its own name + description — the only
 * signal Hermes gives us — and honest about it: anything unmatched is "Other"
 * rather than guessed into a plausible-looking bucket.
 */
function categoryFor(name, description) {
  const hay = `${name || ''} ${description || ''}`;
  for (const [re, label] of CATEGORY_RULES) if (re.test(hay)) return label;
  return 'Other';
}

// ── Shape adapters ───────────────────────────────────────────────────────

/**
 * Normalise the `transport` a catalog row carries.
 *
 * `mcp.catalog` tries `getattr(entry.transport, "kind", "")` (methods_tools.py
 * :1957) but `TransportSpec` names that field `type`, not `kind` — so the
 * getattr misses and the handler falls through to `str(transport)`, shipping a
 * raw Python repr:
 *   "TransportSpec(type='http', command=None, args=[], url='https://…', …)"
 * Verified live against this machine's catalog on 2026-08-26. Pull the real
 * kind back out rather than putting a dataclass repr in front of a user.
 */
function transportKind(raw) {
  const v = String(raw == null ? '' : raw);
  if (!v) return 'stdio';
  const m = v.match(/type=['"]([a-z]+)['"]/i);
  if (m) return m[1].toLowerCase();
  if (/^[a-z]+$/i.test(v)) return v.toLowerCase();
  return 'stdio';
}

function fallbackDescription(server) {
  if (server.url) return `Remote MCP server at ${server.url}`;
  if (server.command) {
    const args = Array.isArray(server.args) && server.args.length ? ` ${server.args.join(' ')}` : '';
    return `Local MCP server (${server.command}${args})`;
  }
  return 'MCP server';
}

function freshProbe(name) {
  const hit = probeCache.get(name);
  if (!hit) return null;
  if (Date.now() - hit.at > PROBE_TTL_MS) {
    probeCache.delete(name);
    return null;
  }
  return hit;
}

/** Map one `mcp.servers.list` row + its catalog twin onto the contract shape. */
function toServer(row, catalogEntry) {
  const name = String(row.name || '');
  const enabled = row.enabled !== false;
  const isOauth = row.auth === 'oauth';
  const tokens = row.oauth_tokens_present === true;

  // Declared-but-unreferenced credentials. `requires` is the catalog's env key
  // list; `row.env` is the KEY NAMES the config actually references (values are
  // never exposed). No overlap ⇒ nothing is wired up yet.
  const requires = Array.isArray(catalogEntry && catalogEntry.requires) ? catalogEntry.requires : [];
  const referenced = new Set(Array.isArray(row.env) ? row.env : []);
  const missingKeys =
    requires.length > 0 &&
    !requires.some((k) => referenced.has(k)) &&
    row.auth !== 'header' &&
    !isOauth;

  const needsAuth = (isOauth && !tokens) || missingKeys;

  const probe = freshProbe(name);
  const pinned = Array.isArray(row.tools) ? row.tools.length : 0;

  return {
    id: name,
    name,
    description: (catalogEntry && catalogEntry.description) || fallbackDescription(row),
    connected: probe ? probe.ok : enabled && !needsAuth,
    needsAuth,
    toolCount: probe ? probe.toolCount : pinned,
    // Beyond the contract, additive only — the UI may ignore these.
    enabled,
    transport: transportKind(row.transport) || 'unknown',
    auth: row.auth || null,
    probed: !!probe,
  };
}

function toCatalogItem(entry) {
  const name = String(entry.name || '');
  const description = String(entry.description || '');
  return {
    id: name,
    name,
    description,
    category: categoryFor(name, description),
    // Additive: lets the UI grey out what is already added without a join.
    installed: !!entry.installed,
    enabled: !!entry.enabled,
    requires: Array.isArray(entry.requires) ? entry.requires : [],
    transport: transportKind(entry.transport),
  };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Everything the Plugins pane needs, in one call.
 *
 * Fail-soft by design: no Hermes on this machine, or a gateway that will not
 * boot, yields `{servers: [], catalog: []}` so the pane renders empty instead
 * of erroring. Both halves are fetched concurrently.
 *
 * @returns {Promise<{servers:Array, catalog:Array}>}
 */
function harvestedRows() {
  try {
    return require('./mcp-import.cjs').harvest();
  } catch {
    return [];
  }
}

function mergeHarvest(catalog, servers) {
  const byName = new Map(catalog.map((e) => [String(e.name || ''), e]));
  const installed = new Set(servers.map((row) => String(row.name || '')));
  for (const row of harvestedRows()) {
    if (installed.has(row.name) || byName.has(row.name)) continue;
    catalog.push({
      name: row.name,
      description: `Imported from ${row.source}`,
      transport: row.url ? 'http' : 'stdio',
      installed: false,
      enabled: false,
      requires: [],
    });
    byName.set(row.name, catalog[catalog.length - 1]);
  }
  return byName;
}

async function listPlugins() {
  const extraOnly = () => {
    const catalog = [];
    mergeHarvest(catalog, []);
    return {
      ok: false,
      hermes: false,
      servers: [],
      catalog: catalog.map(toCatalogItem),
    };
  };
  if (!gateway.available()) return extraOnly();
  let servers = [];
  let catalog = [];
  try {
    const [s, c] = await Promise.all([
      gateway.request('mcp.servers.list', {}).catch(() => ({ servers: [] })),
      gateway.request('mcp.catalog', {}).catch(() => ({ servers: [] })),
    ]);
    servers = Array.isArray(s && s.servers) ? s.servers : [];
    catalog = Array.isArray(c && c.servers) ? c.servers : [];
  } catch {
    return extraOnly();
  }

  const byName = mergeHarvest(catalog, servers);
  return {
    ok: true,
    hermes: true,
    servers: servers.map((row) => toServer(row, byName.get(String(row.name || '')))),
    catalog: catalog.map(toCatalogItem),
  };
}

/**
 * Add a plugin by catalog id.
 *
 * Runs Hermes' own installer (`hermes mcp install <id>`) through `cli.exec`
 * rather than reimplementing manifest parsing, git bootstrap and env-key
 * wiring. Its stdin is /dev/null server-side, so an entry that insists on
 * prompting for a credential exits non-zero — that is surfaced verbatim as
 * `output` with `ok:false`, never swallowed.
 *
 * @param {string} id  catalog entry name
 */
async function addPlugin(id) {
  const name = String(id || '').trim();
  if (!name) return { ok: false, error: 'plugin id required' };
  if (!gateway.available()) return { ok: false, error: 'Hermes is not installed' };

  const listed = await gateway.request('mcp.servers.list', {}).catch(() => ({ servers: [] }));
  const already = (listed.servers || []).some((s) => String(s.name) === name);
  if (already) return { ok: true, already: true, id: name };

  const local = harvestedRows().find((r) => r.name === name);
  if (local) {
    try {
      const cfg = require('./mcp-import.cjs').toHermesConfig(local);
      await gateway.addMcpServer(name, cfg);
      return { ok: true, id: name, imported: true };
    } catch (err) {
      return { ok: false, id: name, error: err.message };
    }
  }

  const res = await gateway
    .request('cli.exec', { argv: ['mcp', 'install', name], timeout: 300 }, 320_000)
    .catch((err) => ({ blocked: false, code: -1, output: err.message }));

  if (res.blocked) return { ok: false, error: res.hint || 'install blocked', id: name };

  const after = await gateway.request('mcp.servers.list', {}).catch(() => ({ servers: [] }));
  const installed = (after.servers || []).some((s) => String(s.name) === name);
  return {
    ok: installed,
    id: name,
    code: res.code,
    output: String(res.output || '').slice(0, 4000),
    error: installed ? undefined : 'Hermes did not add the server — see output',
  };
}

/**
 * Remove a configured plugin (`mcp.servers.remove`, methods_tools.py:2250).
 * @param {string} id
 */
async function removePlugin(id) {
  const name = String(id || '').trim();
  if (!name) return { ok: false, error: 'plugin id required' };
  if (!gateway.available()) return { ok: false, error: 'Hermes is not installed' };
  probeCache.delete(name);
  authFlows.delete(name);
  try {
    const res = await gateway.request('mcp.servers.remove', { name });
    return { ok: true, id: name, removed: res.removed !== false };
  } catch (err) {
    return { ok: false, id: name, removed: false, error: err.message };
  }
}

/**
 * Probe one plugin for real: connect, list tools, disconnect
 * (`mcp.servers.test`, methods_tools.py:2171). Slow by nature — a cold stdio
 * server has to spawn — so it runs on Hermes' long-handler pool and gets the
 * full RPC ceiling here. The outcome is cached and feeds `listPlugins()`'s
 * `connected` / `toolCount`.
 *
 * @param {string} id
 */
async function testPlugin(id) {
  const name = String(id || '').trim();
  if (!name) return { ok: false, error: 'plugin id required' };
  if (!gateway.available()) return { ok: false, error: 'Hermes is not installed' };
  try {
    const res = await gateway.request('mcp.servers.test', { name });
    const tools = Array.isArray(res.tools) ? res.tools : [];
    probeCache.set(name, { ok: !!res.ok, toolCount: tools.length, at: Date.now() });
    return {
      ok: !!res.ok,
      id: name,
      toolCount: tools.length,
      tools,
      needsAuth: !!res.oauth_needed && res.oauth_tokens_present !== true,
      error: res.ok ? undefined : res.error || 'probe failed',
    };
  } catch (err) {
    probeCache.set(name, { ok: false, toolCount: 0, at: Date.now() });
    return { ok: false, id: name, toolCount: 0, tools: [], error: err.message };
  }
}

/**
 * Begin an OAuth flow (`mcp.servers.oauth.start`, methods_tools.py:2276).
 *
 * Hermes drives the same machinery `hermes mcp login` uses and captures the
 * redirect on a loopback listener; the caller opens `authUrl` in the system
 * browser and then polls. The flow's session id is remembered per plugin so
 * `pollPluginAuth(id)` works without the caller having to carry it.
 *
 * @param {string} id
 */
async function startPluginAuth(id) {
  const name = String(id || '').trim();
  if (!name) return { ok: false, error: 'plugin id required' };
  if (!gateway.available()) return { ok: false, error: 'Hermes is not installed' };
  try {
    const res = await gateway.request('mcp.servers.oauth.start', { name });
    if (res.session_id) authFlows.set(name, res.session_id);
    return {
      ok: true,
      id: name,
      sessionId: res.session_id || '',
      authUrl: res.auth_url || '',
      flow: res.flow || 'pkce',
    };
  } catch (err) {
    return { ok: false, id: name, error: err.message };
  }
}

/**
 * Poll a running OAuth flow (`mcp.servers.oauth.poll`, methods_tools.py:2337).
 * `status` is 'pending' | 'approved' | 'error'. On 'approved' the tokens are
 * already persisted for that server, so the probe cache is dropped and the
 * next `listPlugins()` reports it connected.
 *
 * @param {string} id
 * @param {string} [sessionId]  defaults to the id remembered by startPluginAuth
 */
async function pollPluginAuth(id, sessionId) {
  const name = String(id || '').trim();
  if (!name) return { ok: false, error: 'plugin id required' };
  const flow = String(sessionId || authFlows.get(name) || '').trim();
  if (!flow) return { ok: false, id: name, status: 'error', error: 'no auth flow started' };
  if (!gateway.available()) return { ok: false, error: 'Hermes is not installed' };
  try {
    const res = await gateway.request('mcp.servers.oauth.poll', { name, session_id: flow });
    if (res.status === 'approved') {
      authFlows.delete(name);
      probeCache.delete(name);
    }
    return {
      ok: true,
      id: name,
      status: res.status || 'pending',
      authUrl: res.auth_url || '',
      error: res.error_message || undefined,
    };
  } catch (err) {
    return { ok: false, id: name, status: 'error', error: err.message };
  }
}

/**
 * Store a required API key for a plugin (`mcp.servers.set_api_key`,
 * methods_tools.py:2091). The secret is written to Hermes' own .env and only
 * a `${ENV}` reference is persisted in config.yaml — the value never comes
 * back through any read path, here or in Hermes.
 *
 * @param {string} id
 * @param {string} value
 * @param {string} [envVar]  defaults to Hermes' canonical MCP_<NAME>_API_KEY
 */
async function setPluginKey(id, value, envVar) {
  const name = String(id || '').trim();
  if (!name) return { ok: false, error: 'plugin id required' };
  if (!value) return { ok: false, error: 'value required' };
  if (!gateway.available()) return { ok: false, error: 'Hermes is not installed' };
  try {
    const params = { name, value: String(value) };
    if (envVar) params.env_var = String(envVar);
    const res = await gateway.request('mcp.servers.set_api_key', params);
    probeCache.delete(name);
    return { ok: true, id: name, envVar: res.env_var || '' };
  } catch (err) {
    return { ok: false, id: name, error: err.message };
  }
}

module.exports = {
  listPlugins,
  addPlugin,
  removePlugin,
  testPlugin,
  startPluginAuth,
  pollPluginAuth,
  setPluginKey,
  // exported for tests / docs, not for the renderer
  categoryFor,
  transportKind,
};
