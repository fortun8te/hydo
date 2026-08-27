import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Kit from "../kit/ui.jsx";
import { pluginIconUrl, pluginPrettyName } from "../lib/plugin-icons.js";

// ---------------------------------------------------------------------------
// Defensive kit binding.
//
// src/kit/ui.jsx is being rewritten in parallel. A namespace import never
// throws for a missing export — it just yields undefined — so every primitive
// we borrow is checked and falls back to a local equivalent. That way this
// screen keeps rendering no matter which shape the kit lands in.
// ---------------------------------------------------------------------------

function FallbackDialog({ label, onClose, children }) {
  return (
    <div className="hy-dialog" role="dialog" aria-modal="true" aria-label={label}>
      <div className="hy-dialog__scrim" onClick={onClose} />
      <div className="hy-dialog__card">{children}</div>
    </div>
  );
}

function FallbackButton({ children, onClick, variant = "ghost", disabled }) {
  return (
    <button
      type="button"
      className={`hy-btn hy-btn--${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

const Dialog = typeof Kit.Dialog === "function" ? Kit.Dialog : FallbackDialog;
const Button = typeof Kit.Button === "function" ? Kit.Button : FallbackButton;

// ---------------------------------------------------------------------------
// Icons.
//
// Only marks that genuinely ship in src/kit/images are referenced, via the
// new URL(..., import.meta.url) pattern from src/lib/blobs.js. There is no
// gmail/slack/notion/linear/figma/github asset in the kit, so the four Featured
// marks are drawn inline and everything else falls back to a letter tile —
// which is what most MCP servers will get anyway.
// ---------------------------------------------------------------------------

export function LetterTile({ name, id }) {
  const letter = String(name || id || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="hy-plugins__mark hy-plugins__mark--letter" aria-hidden="true">
      {letter}
    </span>
  );
}

function Mark({ id, name, iconUrl }) {
  const src = iconUrl || pluginIconUrl({ id, name, iconUrl });
  if (src) {
    return (
      <span className="hy-plugins__mark hy-plugins__mark--img">
        <img src={src} alt="" aria-hidden="true" />
      </span>
    );
  }
  return <LetterTile name={name} id={id} />;
}

// ---------------------------------------------------------------------------
// Categories.
//
// Driven by whatever the catalog actually returns; this list is the fallback
// (and the ordering) when the backend has nothing to say.
// ---------------------------------------------------------------------------

const CANONICAL_CATEGORIES = [
  "Featured",
  "Team plugins",
  "Agent Orchestration",
  "Canvas",
  "Customer Support",
  "Data Analytics",
  "Design",
  "Finance And Legal",
  "Inbox And Collaboration",
  "Infrastructure",
  "MCP",
  "Payments",
  "Productivity",
  "Research",
  "Sales",
  "Scheduling",
];

const TEAM_CATEGORY = "Team plugins";

function orderCategories(list) {
  const known = CANONICAL_CATEGORIES.filter((c) => list.includes(c));
  const rest = list.filter((c) => !CANONICAL_CATEGORIES.includes(c)).sort((a, b) => a.localeCompare(b));
  return known.concat(rest);
}

// ---------------------------------------------------------------------------
// Browse-only catalog.
//
// Used only when window.hydo.listPlugins is missing or throws. Nothing here
// claims to be installed — every action is disabled and a notice says why.
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Backend result readers. The shapes are still landing, so read them loosely
// and never assume a field exists.
// ---------------------------------------------------------------------------

const POLL_MS = 1500;
const MAX_POLLS = 60; // ~90s, then we stop rather than poll forever.
const TEST_CLEAR_MS = 8000;

function authStateOf(res) {
  if (res === true) return "connected";
  if (!res || typeof res !== "object") return "pending";
  if (res.connected === true || res.ok === true || res.done === true) return "connected";
  const s = String(res.status ?? res.state ?? "").toLowerCase();
  if (["connected", "authorized", "authorised", "complete", "completed", "done", "success", "ok"].includes(s)) {
    return "connected";
  }
  if (["failed", "error", "denied", "cancelled", "canceled", "expired", "rejected"].includes(s)) {
    return "failed";
  }
  if (res.error) return "failed";
  return "pending";
}

function testResultOf(res) {
  if (res === false) return { ok: false, label: "Test failed" };
  if (res && typeof res === "object") {
    const bad =
      res.ok === false ||
      res.success === false ||
      Boolean(res.error) ||
      ["failed", "error"].includes(String(res.status ?? "").toLowerCase());
    if (bad) return { ok: false, label: res.error ? String(res.error) : "Test failed" };
    const n = res.toolCount ?? (Array.isArray(res.tools) ? res.tools.length : null);
    return { ok: true, label: n == null ? "Responded" : `Responded · ${toolLabel(n)}` };
  }
  return { ok: true, label: "Responded" };
}

function toolLabel(n) {
  return `${n} ${n === 1 ? "tool" : "tools"}`;
}

function errText(e) {
  const m = e && e.message ? String(e.message) : String(e || "");
  return m.slice(0, 140) || "Something went wrong";
}

// A plugin is "private" (and gets the Team badge) when it is not a public
// catalog entry — either the catalog says so, or it is a running server with no
// catalog entry at all.
function isTeamEntry(c) {
  if (!c) return true;
  if (c.team === true || c.private === true) return true;
  if (c.public === false) return true;
  const v = String(c.visibility ?? c.scope ?? "").toLowerCase();
  if (["private", "team", "org", "workspace", "internal"].includes(v)) return true;
  return c.category === TEAM_CATEGORY;
}

function buildRows(servers, catalog) {
  const byId = new Map();
  for (const s of servers) {
    if (s && s.id != null) byId.set(String(s.id), s);
  }
  const rows = [];
  const seen = new Set();

  for (const c of catalog) {
    if (!c || c.id == null) continue;
    const id = String(c.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const s = byId.get(id);
    const team = isTeamEntry(c);
    rows.push({
      id,
      name: c.name || s?.name || id,
      description: c.description || s?.description || "",
      category: c.category || (team ? TEAM_CATEGORY : "Other"),
      team,
      installed: Boolean(s),
      connected: Boolean(s?.connected),
      needsAuth: Boolean(s?.needsAuth),
      toolCount: typeof s?.toolCount === "number" ? s.toolCount : null,
    });
  }

  // Servers with no catalog entry are the private ones — they still belong on
  // screen, under Team plugins, badged.
  for (const s of servers) {
    if (!s || s.id == null) continue;
    const id = String(s.id);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      name: s.name || id,
      description: s.description || "",
      category: TEAM_CATEGORY,
      team: true,
      installed: true,
      connected: Boolean(s.connected),
      needsAuth: Boolean(s.needsAuth),
      toolCount: typeof s.toolCount === "number" ? s.toolCount : null,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------

export default function Plugins({ onClose }) {
  const [status, setStatus] = useState("loading"); // loading | ready | unavailable | error
  const [hermes, setHermes] = useState(false);
  const [servers, setServers] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loadError, setLoadError] = useState("");

  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("All");
  const [installedOnly, setInstalledOnly] = useState(false);

  const [busy, setBusy] = useState({}); // id -> "add" | "remove" | "test" | "connect"
  const [tests, setTests] = useState({}); // id -> { ok, label }
  const [rowError, setRowError] = useState({}); // id -> string
  const [authing, setAuthing] = useState({}); // id -> { phase, tries }

  const mountedRef = useRef(false);
  const pollsRef = useRef(new Map()); // id -> { timer, cancelled }
  const timersRef = useRef(new Set()); // stray setTimeouts (test-result clearing)
  const searchRef = useRef(null);

  const live = hermes && status === "ready";

  // -- loading -------------------------------------------------------------

  const refresh = useCallback(async () => {
    if (typeof window.hydo?.listPlugins !== "function") {
      if (!mountedRef.current) return;
      setServers([]);
      setCatalog([]);
      setHermes(false);
      setStatus("unavailable");
      return;
    }
    try {
      const res = await window.hydo.listPlugins();
      if (!mountedRef.current) return;
      setServers(Array.isArray(res?.servers) ? res.servers : []);
      setCatalog(Array.isArray(res?.catalog) ? res.catalog : []);
      const on = res && res.hermes !== false && res.ok !== false;
      setHermes(!!on);
      setLoadError(on ? "" : "Hermes isn't running. Local MCP servers are listed; Add needs Hermes.");
      setStatus("ready");
    } catch {
      if (!mountedRef.current) return;
      setServers([]);
      setCatalog([]);
      setHermes(false);
      setLoadError("Couldn't list plugins.");
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // -- teardown: no interval, timeout or poll chain outlives the modal ------

  const stopPoll = useCallback((id) => {
    const entry = pollsRef.current.get(id);
    if (!entry) return;
    entry.cancelled = true;
    if (entry.timer) clearTimeout(entry.timer);
    pollsRef.current.delete(id);
  }, []);

  useEffect(() => {
    const polls = pollsRef.current;
    const timers = timersRef.current;
    return () => {
      for (const entry of polls.values()) {
        entry.cancelled = true;
        if (entry.timer) clearTimeout(entry.timer);
      }
      polls.clear();
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Escape closes. The kit Dialog does this too; calling onClose twice is a
  // no-op for the caller, and this keeps the guarantee if the kit changes.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // -- small state helpers -------------------------------------------------

  const setKey = useCallback((setter, id, value) => {
    setter((prev) => {
      if (value === undefined) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: value };
    });
  }, []);

  const later = useCallback((fn, ms) => {
    const t = setTimeout(() => {
      timersRef.current.delete(t);
      if (mountedRef.current) fn();
    }, ms);
    timersRef.current.add(t);
    return t;
  }, []);

  // -- actions -------------------------------------------------------------

  const runSimple = useCallback(
    async (id, method, phase) => {
      const fn = window.hydo?.[method];
      if (typeof fn !== "function") {
        setKey(setRowError, id, "Not wired up yet");
        return;
      }
      setKey(setRowError, id, undefined);
      setKey(setBusy, id, phase);
      try {
        await fn.call(window.hydo, id);
        if (!mountedRef.current) return;
        await refresh();
      } catch (e) {
        if (!mountedRef.current) return;
        setKey(setRowError, id, errText(e));
      } finally {
        if (mountedRef.current) setKey(setBusy, id, undefined);
      }
    },
    [refresh, setKey]
  );

  const onAdd = useCallback((id) => runSimple(id, "addPlugin", "add"), [runSimple]);

  const onRemove = useCallback(
    (id) => {
      stopPoll(id);
      setKey(setAuthing, id, undefined);
      setKey(setTests, id, undefined);
      return runSimple(id, "removePlugin", "remove");
    },
    [runSimple, stopPoll, setKey]
  );

  const onTest = useCallback(
    async (id) => {
      const fn = window.hydo?.testPlugin;
      if (typeof fn !== "function") {
        setKey(setRowError, id, "Testing is not wired up yet");
        return;
      }
      setKey(setRowError, id, undefined);
      setKey(setTests, id, undefined);
      setKey(setBusy, id, "test");
      try {
        const res = await fn.call(window.hydo, id);
        if (!mountedRef.current) return;
        setKey(setTests, id, testResultOf(res));
      } catch (e) {
        if (!mountedRef.current) return;
        setKey(setTests, id, { ok: false, label: errText(e) });
      } finally {
        if (mountedRef.current) {
          setKey(setBusy, id, undefined);
          later(() => setKey(setTests, id, undefined), TEST_CLEAR_MS);
        }
      }
    },
    [later, setKey]
  );

  const finishAuth = useCallback(
    (id, ok, message) => {
      stopPoll(id);
      if (!mountedRef.current) return;
      setKey(setAuthing, id, undefined);
      setKey(setBusy, id, undefined);
      if (ok) refresh();
      else setKey(setRowError, id, message || "Authorization failed");
    },
    [refresh, stopPoll, setKey]
  );

  const schedulePoll = useCallback(
    (id, tries) => {
      const entry = { timer: null, cancelled: false };
      pollsRef.current.set(id, entry);
      entry.timer = setTimeout(async () => {
        if (entry.cancelled || !mountedRef.current) return;
        let res;
        try {
          res = await window.hydo.pollPluginAuth?.(id);
        } catch (e) {
          if (entry.cancelled) return;
          finishAuth(id, false, errText(e));
          return;
        }
        if (entry.cancelled || !mountedRef.current) return;
        const state = authStateOf(res);
        if (state === "connected") {
          finishAuth(id, true);
        } else if (state === "failed") {
          finishAuth(id, false, res?.error ? String(res.error) : "Authorization failed");
        } else if (tries + 1 >= MAX_POLLS) {
          finishAuth(id, false, "Timed out waiting for authorization");
        } else {
          setKey(setAuthing, id, { phase: "waiting", tries: tries + 1 });
          schedulePoll(id, tries + 1);
        }
      }, POLL_MS);
    },
    [finishAuth, setKey]
  );

  const onConnect = useCallback(
    async (id) => {
      const start = window.hydo?.startPluginAuth;
      if (typeof start !== "function") {
        setKey(setRowError, id, "Authorization is not wired up yet");
        return;
      }
      stopPoll(id);
      setKey(setRowError, id, undefined);
      setKey(setBusy, id, "connect");
      setKey(setAuthing, id, { phase: "starting", tries: 0 });
      try {
        await start.call(window.hydo, id);
      } catch (e) {
        if (!mountedRef.current) return;
        finishAuth(id, false, errText(e));
        return;
      }
      if (!mountedRef.current) return;
      if (typeof window.hydo?.pollPluginAuth !== "function") {
        // Nothing to poll — take the start call at its word and re-read.
        finishAuth(id, true);
        return;
      }
      setKey(setAuthing, id, { phase: "waiting", tries: 0 });
      schedulePoll(id, 0);
    },
    [finishAuth, schedulePoll, stopPoll, setKey]
  );

  // -- derived -------------------------------------------------------------

  const rows = useMemo(() => {
    if (status === "loading") return [];
    return buildRows(servers, catalog);
  }, [status, servers, catalog]);

  const present = useMemo(() => {
    const out = [];
    for (const r of rows) if (!out.includes(r.category)) out.push(r.category);
    return orderCategories(out);
  }, [rows]);

  const chips = useMemo(() => ["All"].concat(present), [present]);

  // A chip can vanish when the data reloads; fall back to All rather than
  // stranding the user on an empty filter.
  useEffect(() => {
    if (chip !== "All" && present.length > 0 && !present.includes(chip)) setChip("All");
  }, [chip, present]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (installedOnly && !r.installed) return false;
      if (chip !== "All" && r.category !== chip) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
      );
    });
  }, [rows, chip, query, installedOnly]);

  const sections = useMemo(() => {
    const names = [];
    for (const r of visible) if (!names.includes(r.category)) names.push(r.category);
    return orderCategories(names)
      .map((name) => ({ name, items: visible.filter((r) => r.category === name) }))
      .filter((s) => s.items.length > 0);
  }, [visible]);

  const filtered = installedOnly || chip !== "All" || query.trim().length > 0;

  const notice = !hermes && status === "ready" ? loadError : status === "unavailable" ? loadError : "";

  function resetFilters() {
    setQuery("");
    setChip("All");
    setInstalledOnly(false);
  }

  return (
    <Dialog label="Plugins" onClose={onClose}>
      <div className="hy-plugins">
        <div className="hy-plugins__head">
          <div className="hy-plugins__titlebar">
            <h2 className="hy-plugins__title">Plugins</h2>
            <button
              type="button"
              className="hy-plugins__close"
              onClick={onClose}
              aria-label="Close plugins"
            >
              <i className="gb-icon gb-icon-remove-close" aria-hidden="true" />
            </button>
          </div>

          <div className="hy-plugins__search">
            <i className="gb-icon gb-icon-magnifying-glass" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              className="hy-plugins__search-input"
              placeholder="Search plugins"
              aria-label="Search plugins"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* The category chips are gone on purpose. Thirteen taxonomy pills
              ("Analytics & monitoring", "Sales & support") wrapped onto three
              rows and pushed the actual plugins below the fold, to filter a
              list that is short enough to read and already has a search box.
              `chip` stays wired at "All" so the filter and the empty state
              keep working; nothing renders the pills. */}

          {notice && (
            <p className="hy-plugins__notice" role="status">
              <i className="gb-icon gb-icon-plug-slash" aria-hidden="true" />
              <span>{notice}</span>
            </p>
          )}
        </div>

        <div className="hy-plugins__scroll">
          {status === "loading" ? (
            <Skeleton />
          ) : sections.length === 0 ? (
            <Empty
              query={query}
              chip={chip}
              installedOnly={installedOnly}
              filtered={filtered}
              onReset={resetFilters}
            />
          ) : (
            sections.map((section) => (
              <section className="hy-plugins__section" key={section.name}>
                <div className="hy-plugins__section-head">
                  <h3 className="hy-plugins__section-title">{section.name}</h3>
                </div>
                <div className="hy-plugins__grid">
                  {section.items.map((row) => (
                    <PluginRow
                      key={row.id}
                      row={row}
                      live={live}
                      busy={busy[row.id]}
                      test={tests[row.id]}
                      error={rowError[row.id]}
                      auth={authing[row.id]}
                      onAdd={onAdd}
                      onRemove={onRemove}
                      onTest={onTest}
                      onConnect={onConnect}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Spinner() {
  return <span className="hy-plugins__spinner" aria-hidden="true" />;
}

function TeamBadge() {
  return (
    <span className="hy-plugins__badge hy-plugins__badge--team">
      <i className="gb-icon gb-icon-people-3" aria-hidden="true" />
      Team
    </span>
  );
}

function PluginRow({ row, live, busy, test, error, auth, onAdd, onRemove, onTest, onConnect }) {
  const disabled = !live || Boolean(busy);

  let stateBadge = null;
  if (row.connected) {
    stateBadge = (
      <span className="hy-plugins__badge hy-plugins__badge--ok">
        <span className="hy-plugins__dot" aria-hidden="true" />
        Connected
        {/* Only a real count. `0 tools` on eight connected rows reads as
            eight broken plugins, and it usually just means nobody has run
            Test yet — the server is connected, the schema is not fetched. */}
        {row.toolCount ? (
          <span className="hy-plugins__tools">· {toolLabel(row.toolCount)}</span>
        ) : null}
      </span>
    );
  } else if (row.needsAuth) {
    stateBadge = <span className="hy-plugins__badge hy-plugins__badge--warn">needs auth</span>;
  } else if (row.installed) {
    stateBadge = <span className="hy-plugins__badge">Installed</span>;
  }

  let statusLine = null;
  if (busy === "connect" || auth) {
    statusLine = (
      <span className="hy-plugins__status">
        <Spinner />
        {auth?.phase === "waiting"
          ? "Waiting for authorization in your browser…"
          : "Opening authorization…"}
      </span>
    );
  } else if (error) {
    statusLine = <span className="hy-plugins__status hy-plugins__status--bad">{error}</span>;
  } else if (test) {
    statusLine = (
      <span
        className={
          test.ok
            ? "hy-plugins__status hy-plugins__status--good"
            : "hy-plugins__status hy-plugins__status--bad"
        }
      >
        <i
          className={`gb-icon gb-icon-${test.ok ? "check-circle" : "exclamation-circle"}`}
          aria-hidden="true"
        />
        {test.label}
      </span>
    );
  }

  return (
    <div className="hy-plugins__row">
      <Mark id={row.id} name={row.name} iconUrl={row.iconUrl} />
      <div className="hy-plugins__copy">
        <p className="hy-plugins__name">
          <span className="hy-plugins__name-text">{pluginPrettyName(row)}</span>
          {row.team && <TeamBadge />}
          {stateBadge}
        </p>
        {row.description && <p className="hy-plugins__desc">{row.description}</p>}
        {statusLine}
      </div>
      <div className="hy-plugins__actions">
        {!row.installed && (
          <Button variant="ghost" disabled={disabled} onClick={() => onAdd(row.id)}>
            {busy === "add" ? <Spinner /> : null}
            {busy === "add" ? "Adding" : "Add"}
          </Button>
        )}

        {row.installed && row.needsAuth && !row.connected && (
          <Button variant="primary" disabled={disabled} onClick={() => onConnect(row.id)}>
            {busy === "connect" ? <Spinner /> : null}
            {busy === "connect" ? "Connecting" : "Connect"}
          </Button>
        )}

        {row.installed && !row.needsAuth && (
          <Button variant="ghost" disabled={disabled} onClick={() => onTest(row.id)}>
            {busy === "test" ? <Spinner /> : null}
            {busy === "test" ? "Testing" : "Test"}
          </Button>
        )}

        {row.installed && (
          <button
            type="button"
            className="hy-plugins__remove"
            disabled={disabled}
            aria-label={`Remove ${row.name}`}
            title={`Remove ${row.name}`}
            onClick={() => onRemove(row.id)}
          >
            {busy === "remove" ? (
              <Spinner />
            ) : (
              <i className="gb-icon gb-icon-remove-close" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="hy-plugins__section" aria-hidden="true">
      <div className="hy-plugins__grid">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div className="hy-plugins__row hy-plugins__row--skeleton" key={i}>
            <span className="hy-plugins__mark hy-plugins__skel-mark" />
            <div className="hy-plugins__copy">
              <span className="hy-plugins__skel-line" style={{ width: "38%" }} />
              <span className="hy-plugins__skel-line" style={{ width: "76%" }} />
            </div>
            <span className="hy-plugins__skel-btn" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ query, chip, installedOnly, filtered, onReset }) {
  const q = query.trim();
  const what = q
    ? `No plugins match “${q}”`
    : installedOnly
      ? "Nothing installed yet"
      : chip !== "All"
        ? `Nothing in ${chip} yet`
        : "No plugins yet";
  return (
    <div className="hy-plugins__empty">
      <i className="gb-icon gb-icon-magnifying-glass-slash-circle" aria-hidden="true" />
      <p className="hy-plugins__empty-title">{what}</p>
      <p className="hy-plugins__empty-sub">
        A plugin is an MCP server Hermes connects to. Adding one gives every teammate its tools.
      </p>
      {filtered && (
        <Button variant="ghost" onClick={onReset}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
