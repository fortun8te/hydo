import { useCallback, useEffect, useState } from "react";

/**
 * The shared Linux workspace, as a rail panel instead of a modal.
 *
 * Used to be `Computer.jsx` inside a centred `Sheet` dialog — the user's own
 * verdict was "this is a weird menu, i don't want this". Machines are not a
 * page you navigate to, they are a status you glance at, so this lives where
 * every other per-bot fact lives: the right rail. ONE box for the whole desk
 * still — see electron/box-runtime.cjs's header comment for the cost law —
 * this panel just shows it in context of whichever bot is selected.
 *
 * No screenshot loop drives the thumbnail. The runtime has no on-demand
 * single-frame call, only `desktopUrl` for the live stream itself (box-
 * runtime.cjs's own comment: "watching a screen costs no extra call" is true
 * for the stream, not for a still). Polling that stream into a frame would
 * mean an interval on a per-second-billed machine — the exact cost this
 * rework exists to avoid. So the card is always a state placeholder — awake /
 * asleep / gone — never a picture that could go stale without saying so.
 */

const RATE = { small: 0.5, default: 1, large: 2 };
const MONTH = 2_592_000;
const PLAN = 2_000_000;
function costOf(type) {
  const r = RATE[type];
  if (!r) return null;
  return { pct: Math.round(((MONTH * r) / PLAN) * 100), rate: r };
}

function hrs(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(1)}h` : "";
}

const STATE_LABEL = { running: "Awake", stopped: "Asleep", missing: "Gone", none: "Not created yet" };

export default function ComputerRail({ agent, onClose, onOpenRoutines, onCreateRoutine }) {
  const [st, setSt] = useState({ loading: true });
  const [lim, setLim] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // One status read per open, and the runtime caches it for eight seconds on
  // top of that (box-runtime.cjs STATUS_TTL_MS). The user's complaint was
  // literal: "if I keep clicking/exiting then obviously don't count that as
  // separate fucking starts." Opening this panel must never resume anything —
  // it only ever reads. Waking is the button below, and nothing else.
  const refresh = useCallback(async () => {
    // Every one of these is an IPC round-trip to a CLI that can be missing,
    // hung, or answering from a dead gateway — and a REJECTED promise is not
    // the same as `{ok:false}`. Unguarded, a throw here escaped as an
    // unhandled rejection and `loading` was never cleared, so the whole panel
    // sat on "Checking…" forever and looked like it was still working.
    let s = null;
    try {
      s = await window.hydo?.boxStatus?.();
    } catch {
      s = null;
    }
    setSt({ loading: false, ...(s || {}) });
    if (s && s.signedIn) {
      try {
        const l = await window.hydo?.boxLimits?.();
        if (l && l.ok) setLim(l);
      } catch {
        // Limits are decoration behind the gear. Losing them must not take
        // the machine controls down with them.
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function wake() {
    setBusy("wake");
    setErr("");
    // A throw is a real outcome here (gateway down, CLI gone). It used to
    // escape the handler, which meant `setBusy("")` never ran: the button
    // stayed disabled on "Starting…" with no error under it, forever.
    let res = null;
    try {
      res = await window.hydo?.boxEnsure?.({});
    } catch (e) {
      res = { ok: false, reason: (e && e.message) || "Could not start it." };
    }
    setBusy("");
    // The trial's start budget, refused locally before the wire. Create,
    // resume and fork each spend one of 5/min, 25/hour, 75/day, so a doomed
    // call is worse than no call: it costs a round-trip and still fails.
    if (res && !res.ok && res.reason === "start-budget") {
      setErr(`That is enough starts for one ${res.window || "minute"}. Waking it again costs one of the trial's starts, so give it a moment.`);
    } else if (!res || !res.ok) setErr((res && res.reason) || "Could not start it.");
    refresh();
  }

  async function sleep() {
    setBusy("stop");
    setErr("");
    // Same as wake(): a rejection left the button stuck on "Stopping…".
    let res = null;
    try {
      res = await window.hydo?.boxStop?.();
    } catch (e) {
      res = { ok: false, reason: (e && e.message) || "Could not stop it." };
    }
    setBusy("");
    // "busy" is a real answer, not a failure: another teammate is mid-job.
    if (res && !res.ok && res.reason === "busy") {
      setErr(`Still working (${res.busy} job${res.busy === 1 ? "" : "s"}). It stops on its own when they finish.`);
    } else if (res && !res.ok) setErr(res.reason || "Could not stop it.");
    refresh();
  }

  const running = st.state === "running";
  const botName = (agent?.name || "").trim() || "This Bot";
  const size = st.type && st.type !== "small" ? costOf(st.type) : null;

  return (
    <aside className="bot-rail computer-rail" aria-label="Computer">
      <header className="bot-rail__head">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setSettingsOpen((v) => !v)}
          title="Machine details"
          aria-label="Machine details"
          aria-pressed={settingsOpen}
        >
          <i className="gb-icon gb-icon-settings-gear" />
        </button>
        <span className="bot-rail__title">Computer</span>
        <button type="button" className="icon-btn" onClick={onClose} title="Close">
          <i className="gb-icon gb-icon-chevrons-right" />
        </button>
      </header>

      {st.loading ? (
        <p className="mute computer-rail__pad">Checking…</p>
      ) : !st.installed ? (
        <div className="computer-rail__body computer-rail__pad">
          <h3>The box CLI is not installed</h3>
          <pre>curl -fsSL https://ascii.dev/api/box/install | sh</pre>
        </div>
      ) : !st.signedIn ? (
        <div className="computer-rail__body computer-rail__pad">
          <h3>Not signed in</h3>
          <pre>box onboard</pre>
          <button type="button" className="ghost" onClick={refresh}>Check again</button>
        </div>
      ) : (
        <>
          <div className="computer-rail__body">
            {/* The card itself. `is-live` only paints a wash; the "Open" pill
                is a real button rendered only while running, not a disabled
                one hidden by CSS — a disabled element does not reliably take
                :hover in every engine, and this pill has to. */}
            <div className={running ? "computer-rail__thumb is-live" : "computer-rail__thumb"}>
              <div className="computer-rail__thumb-face">
                <i
                  className={`gb-icon ${
                    running
                      ? "gb-icon-device-desktop"
                      : st.state === "missing"
                      ? "gb-icon-exclamation-triangle"
                      : "gb-icon-moon-z"
                  }`}
                />
                <span>{STATE_LABEL[st.state] || st.state || "Asleep"}</span>
              </div>
              {running && st.desktopUrl ? (
                <button
                  type="button"
                  className="computer-rail__open"
                  onClick={() => window.hydo?.openExternal?.(st.desktopUrl)}
                >
                  <span aria-hidden="true">⤢</span> Open
                </button>
              ) : null}
            </div>
            {/* NOT "<Bot>'s screen", which is what this said and what it could
                not deliver. Verified against the CLI and docs on 2026-08-27: a
                Box has exactly ONE desktop. `box info --json` returns a single
                `desktopUrl` with one Moonlight hostId/appId, `box desktop <ID>`
                takes no display or session flag, and the streaming docs say
                outright that "Lux controls the Box's single shared desktop, so
                run only one Lux session at a time". Per-bot screens would mean
                one box per bot — the exact bill box-runtime.cjs's header exists
                to prevent. So the caption names the shared thing, and the line
                under it says the consequence out loud rather than letting the
                user discover it by watching another bot move their mouse. */}
            <p className="computer-rail__caption">Shared screen — one desktop, all bots</p>
            <p className="computer-rail__sub">
              {botName} shares this desktop with every other bot you switch on — they see the same windows
              and take turns.
            </p>

            <div className="computer-rail__actions">
              {running ? (
                <button type="button" className="ghost" onClick={sleep} disabled={!!busy}>
                  {busy === "stop" ? "Stopping…" : "Stop now"}
                </button>
              ) : (
                <button type="button" className="ghost ghost--solid" onClick={wake} disabled={!!busy}>
                  {busy === "wake" ? "Starting…" : st.id ? "Wake it up" : "Create the workspace"}
                </button>
              )}
            </div>
            {err ? <p className="hy-computer__err">{err}</p> : null}
          </div>

          {/* Everything from the old modal that isn't the screen itself —
              trial deadline, machine size and its cost, the idle-stop note,
              time left / machines / starts today — condensed behind the
              gear instead of always on screen. */}
          {settingsOpen ? (
            <div className="computer-rail__settings">
              {lim && lim.trial ? (
                <p className="computer-rail__note">
                  Trial until {lim.trialEndsAt ? new Date(lim.trialEndsAt).toLocaleDateString() : "soon"}. Two
                  machines at once, and every machine must stop within two hours — so nothing runs overnight
                  until the first payment.
                </p>
              ) : null}
              {size ? (
                <p className="computer-rail__note">
                  This one is <strong>{st.type}</strong> ({size.rate}x rate) — about {size.pct}% of the plan
                  left awake all month, against {costOf("small").pct}% for a small one. Hydo makes small ones;
                  this was already on your account, so it kept it.
                </p>
              ) : null}
              <p className="computer-rail__note">
                {running
                  ? "Billing runs by the second while it is awake. It stops itself after ten idle minutes, and on quit."
                  : st.state === "missing"
                  ? "The machine this app remembers no longer exists. Waking makes a new one."
                  : "Asleep is free and keeps the disk exactly as it was."}
              </p>
              {lim ? (
                <dl className="computer-rail__facts">
                  <div><dt>Time left</dt><dd>{hrs(lim.hoursLeft)}</dd></div>
                  <div><dt>Machines</dt><dd>{lim.activeBoxes} / {lim.maxActiveBoxes}</dd></div>
                  {lim.startsToday ? (
                    <div><dt>Starts today</dt><dd>{lim.startsToday.used} / {lim.startsToday.limit}</dd></div>
                  ) : null}
                </dl>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {/* Same row, same copy, same destination as BotRail's own Routines
          section — this panel replaces the modal, not the rail's existing
          Routines entry point. */}
      {agent ? (
        <div className="bot-rail__routines">
          <button type="button" className="bot-rail__routines-open" onClick={onOpenRoutines}>
            <span className="bot-rail__notify-title">Routines</span>
            <i className="gb-icon gb-icon-chevron-right" />
          </button>
          <p>Routines are recurring tasks this Bot runs on a schedule.</p>
          <button type="button" className="ghost ghost--solid" onClick={onCreateRoutine}>
            Create Routine
          </button>
        </div>
      ) : null}
    </aside>
  );
}
