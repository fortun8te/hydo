import { useCallback, useEffect, useState } from "react";

/**
 * The shared Linux workspace.
 *
 * ONE machine for the whole desk. Fifty bots is one box, and a bot's "Linux
 * workspace" toggle is permission to use it rather than a machine of its own.
 *
 * The screen is a status row and three numbers, not a roster. If it ever lists
 * more than one box, something has gone wrong upstream of it.
 */

/**
 * What a machine of this size costs if it never sleeps.
 *
 * Rates are the vendor's own multipliers: small 0.5x, default 1x, large 2x,
 * against a $20 plan of 2,000,000 VM-seconds and a 2,592,000-second month.
 * Shown as a share of the plan rather than dollars, because the plan is the
 * thing that runs out.
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

export default function Computer() {
  const [st, setSt] = useState({ loading: true });
  const [lim, setLim] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    const s = await window.hydo?.boxStatus?.();
    setSt({ loading: false, ...(s || {}) });
    if (s && s.signedIn) {
      const l = await window.hydo?.boxLimits?.();
      if (l && l.ok) setLim(l);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function wake() {
    setBusy("wake");
    setErr("");
    const res = await window.hydo?.boxEnsure?.({});
    setBusy("");
    if (!res || !res.ok) setErr((res && res.reason) || "Could not start it.");
    refresh();
  }

  async function sleep() {
    setBusy("stop");
    setErr("");
    const res = await window.hydo?.boxStop?.();
    setBusy("");
    // "busy" is a real answer, not a failure: another teammate is mid-job.
    if (res && !res.ok && res.reason === "busy") {
      setErr(`Still working (${res.busy} job${res.busy === 1 ? "" : "s"}). It stops on its own when they finish.`);
    } else if (res && !res.ok) setErr(res.reason || "Could not stop it.");
    refresh();
  }

  const running = st.state === "running";

  return (
    <div className="hy-computer">
      <p className="hy-computer__lede">
        One Ubuntu machine the whole desk shares. Files, installed software and
        browser logins live on its disk, so a teammate that signs into something
        once leaves it signed in for the next one. Making more bots never makes
        more machines.
      </p>

      {st.loading ? (
        <p className="mute">Checking…</p>
      ) : !st.installed ? (
        <div className="hy-computer__step">
          <h3>The box CLI is not installed</h3>
          <pre>curl -fsSL https://ascii.dev/api/box/install | sh</pre>
        </div>
      ) : !st.signedIn ? (
        <div className="hy-computer__step">
          <h3>Not signed in</h3>
          <pre>box onboard</pre>
          <button type="button" className="ghost" onClick={refresh}>Check again</button>
        </div>
      ) : (
        <>
          {lim && lim.trial ? (
            <div className="hy-computer__trial">
              Trial until {lim.trialEndsAt ? new Date(lim.trialEndsAt).toLocaleDateString() : "soon"}.
              Two machines at once, and every machine must stop within two hours
              — so nothing runs overnight until the first payment.
            </div>
          ) : null}

          <div className="hy-computer__card">
            <div className="hy-computer__row">
              <span className={running ? "hy-computer__pip is-on" : "hy-computer__pip"} />
              <span className="hy-computer__state">
                {{ running: "Awake", stopped: "Asleep", missing: "Gone", none: "Not created yet" }[st.state] ||
                  st.state}
              </span>
              {st.id ? <code className="mono">{st.id}</code> : null}
              {st.type ? <span className="hy-computer__tag">{st.type}</span> : null}
              {st.busy ? <span className="hy-computer__tag is-work">{st.busy} working</span> : null}
            </div>
            {/* Said where the decision is, not in a doc. Hydo creates `small`;
                a machine adopted from the dashboard can be any size, and the
                difference is the whole monthly bill. */}
            {st.type && st.type !== "small" && costOf(st.type) ? (
              <p className="hy-computer__size">
                This one is <strong>{st.type}</strong> ({costOf(st.type).rate}x rate). Left awake
                all month it would use about {costOf(st.type).pct}% of the plan, against{" "}
                {costOf("small").pct}% for a small one. Hydo makes small ones; this was already on
                your account, so it kept it.
              </p>
            ) : null}
            <p className="hy-computer__note">
              {running
                ? "Billing runs by the second while it is awake. It stops itself after ten idle minutes, and on quit."
                : st.state === "missing"
                ? "The machine this app remembers no longer exists. Waking makes a new one."
                : "Asleep is free and keeps the disk exactly as it was."}
            </p>
            <div className="hy-computer__actions">
              {running ? (
                <>
                  {st.desktopUrl ? (
                    <button
                      type="button"
                      className="ghost ghost--solid"
                      onClick={() => window.hydo?.openExternal?.(st.desktopUrl)}
                    >
                      Open the desktop
                    </button>
                  ) : null}
                  <button type="button" className="ghost" onClick={sleep} disabled={!!busy}>
                    {busy === "stop" ? "Stopping…" : "Stop now"}
                  </button>
                </>
              ) : (
                <button type="button" className="ghost ghost--solid" onClick={wake} disabled={!!busy}>
                  {busy === "wake" ? "Starting…" : st.id ? "Wake it up" : "Create the workspace"}
                </button>
              )}
            </div>
            {err ? <p className="hy-computer__err">{err}</p> : null}
          </div>

          {lim ? (
            <div className="hy-computer__card">
              <dl className="hy-computer__facts">
                <div><dt>Time left</dt><dd>{hrs(lim.hoursLeft)}</dd></div>
                <div><dt>Machines</dt><dd>{lim.activeBoxes} / {lim.maxActiveBoxes}</dd></div>
                {lim.startsToday ? (
                  <div><dt>Starts today</dt><dd>{lim.startsToday.used} / {lim.startsToday.limit}</dd></div>
                ) : null}
              </dl>
              <p className="hy-computer__note">
                Waking counts as a start, the same as creating. That is why Hydo
                resumes one machine instead of making new ones.
              </p>
            </div>
          ) : null}

          <div className="hy-computer__card hy-computer__card--quiet">
            <h3>What is shared</h3>
            <p>
              Everything on the disk. Every teammate can see it, so treat it as
              team-visible. Chat, memory and routines are not on it — those stay
              on this Mac in each teammate&apos;s own profile.
            </p>
            {/* Said here because it is the question the desktop button invites,
                and the wrong answer to it is the most expensive habit available:
                a teammate looking at a screen pays roughly 1,400 tokens per
                glance, and a click-and-look loop pays it twenty times over. */}
            <h3>How teammates use it</h3>
            <p>
              Over text — commands, files, output. They do not watch the screen:
              looking at a picture of a desktop costs a teammate far more than
              doing the work. When something really needs a browser or a window,
              they hand the job to the box&apos;s own automation and get an answer
              back in words. The desktop above is for you, not for them.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
