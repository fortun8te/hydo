import { useCallback, useEffect, useState } from "react";

/**
 * The team computer.
 *
 * One cloud Linux machine every teammate shares — files, installs, browser
 * logins. Not one per bot: shared state is the point (a login done once stays
 * done), Box bills per running machine, and the trial allows two concurrent
 * boxes in total.
 *
 * This screen exists mostly to tell the truth about three things people get
 * wrong about agent computers: whether it is running, what it costs while it
 * is, and that the per-bot folders on it are a convention rather than a jail.
 */

function fmtHours(seconds) {
  const n = Number(seconds) || 0;
  if (!n) return "";
  return `${Math.round(n / 3600)}h`;
}

export default function Computer() {
  const [state, setState] = useState({ loading: true });
  const [limits, setLimits] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const st = await window.hydo?.boxStatus?.();
    setState({ loading: false, ...(st || {}) });
    if (st && st.signedIn) {
      const [l, list] = await Promise.all([
        window.hydo?.boxLimits?.(),
        window.hydo?.boxList?.(),
      ]);
      if (l && l.ok) setLimits(l.limits);
      if (list && list.ok) {
        setState((s) => ({
          ...s,
          team: (list.boxes || []).find(
            (b) => String(b.name || b.alias || "").toLowerCase() === "hydo-team"
          ),
        }));
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function start() {
    setBusy("start");
    setError("");
    const res = await window.hydo?.boxEnsure?.();
    setBusy("");
    // Say what actually went wrong. "Couldn't start" sends someone to a forum.
    if (!res || !res.ok) setError((res && res.reason) || "Could not start the computer.");
    refresh();
  }

  async function sleep(id) {
    setBusy("stop");
    await window.hydo?.boxStop?.(id);
    setBusy("");
    refresh();
  }

  async function watch(id) {
    setBusy("watch");
    const res = await window.hydo?.boxDesktop?.(id);
    setBusy("");
    if (res && res.ok && res.url) window.hydo?.openExternal?.(res.url);
    else setError((res && res.reason) || "No desktop URL came back.");
  }

  const team = state.team;
  const running = team && !/stopped|archiv|paused/i.test(String(team.state || team.status || ""));

  return (
    <div className="hy-computer">
      <p className="hy-computer__lede">
        One Linux machine your whole team shares. Files, installed software and
        browser logins stay on it, so a teammate that logs into something once
        does not have to do it again, and the next teammate finds it already
        signed in.
      </p>

      {state.loading ? (
        <p className="mute">Checking…</p>
      ) : !state.installed ? (
        <div className="hy-computer__step">
          <h3>The box CLI is not installed</h3>
          <pre>curl -fsSL https://ascii.dev/api/box/install | sh</pre>
        </div>
      ) : !state.signedIn ? (
        <div className="hy-computer__step">
          <h3>Not signed in yet</h3>
          <p>
            Signing in creates an ASCII account and starts the plan, so it is
            yours to do rather than Hydo&apos;s. It runs in a terminal:
          </p>
          <pre>box onboard</pre>
          <p className="mute">
            The trial is 7 days and 25 hours of machine time, two machines at
            once, and every machine must auto-stop within two hours. After that
            it is $20 a month for about 555 hours. There is no free tier.
          </p>
          <button type="button" className="ghost" onClick={refresh}>
            Check again
          </button>
        </div>
      ) : (
        <>
          <div className="hy-computer__card">
            <div className="hy-computer__row">
              <span className={running ? "hy-computer__pip is-on" : "hy-computer__pip"} />
              <span className="hy-computer__state">
                {team ? (running ? "Running" : "Asleep") : "Not created yet"}
              </span>
              {team ? <code className="mono">{team.id}</code> : null}
            </div>
            <p className="hy-computer__note">
              {running
                ? "Billing runs by the second while it is awake. Asleep is free and keeps the disk."
                : "Asleep costs nothing. Waking it restores the disk exactly as it was."}
            </p>
            <div className="hy-computer__actions">
              {running ? (
                <>
                  <button type="button" className="ghost ghost--solid" onClick={() => watch(team.id)} disabled={!!busy}>
                    {busy === "watch" ? "Opening…" : "Watch the screen"}
                  </button>
                  <button type="button" className="ghost" onClick={() => sleep(team.id)} disabled={!!busy}>
                    {busy === "stop" ? "Sleeping…" : "Put to sleep"}
                  </button>
                </>
              ) : (
                <button type="button" className="ghost ghost--solid" onClick={start} disabled={!!busy}>
                  {busy === "start" ? "Waking…" : team ? "Wake it up" : "Create the computer"}
                </button>
              )}
            </div>
            {error ? <p className="hy-computer__err">{error}</p> : null}
          </div>

          {limits ? (
            <div className="hy-computer__card">
              <h3>Your plan</h3>
              <dl className="hy-computer__facts">
                <div>
                  <dt>Plan</dt>
                  <dd>{state.plan || limits.plan || "trial"}</dd>
                </div>
                {limits.concurrentBoxes != null ? (
                  <div>
                    <dt>Machines at once</dt>
                    <dd>{limits.concurrentBoxes}</dd>
                  </div>
                ) : null}
                {limits.remainingSeconds != null ? (
                  <div>
                    <dt>Time left</dt>
                    <dd>{fmtHours(limits.remainingSeconds)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}

          {/* The one question that decides the bill, answered where it is
              asked rather than in a doc nobody opens. */}
          <div className="hy-computer__card">
            <h3>Routines while your Mac is off</h3>
            <p>
              A stopped machine runs nothing. It is a frozen snapshot, there
              are no wake timers, and auto-stop counts from when it started
              rather than from when you last used it. So a routine that has to
              fire at 8am whether or not your laptop is open needs a machine
              that never stops.
            </p>
            <p>
              That fits, but only at the small size. A month is 2,592,000
              seconds; the $20 plan buys 2,000,000 VM-seconds. A small machine
              spends them at half rate, so running it continuously uses about{" "}
              <strong>65% of the plan</strong>. The default size would want 130%
              and the large one 259%.
            </p>
            <p className="mute">
              The trade is real: two vCPUs and 4GB is thin for a desktop. A
              machine that is always there, or a faster one that is only there
              when you are. Always-on also needs a payment method . the trial
              refuses it and caps auto-stop at two hours.
            </p>
          </div>

          {/* Said out loud, because the opposite is the natural assumption and
              getting it wrong is how somebody puts a secret in the wrong
              place. */}
          <div className="hy-computer__card hy-computer__card--quiet">
            <h3>What is shared, and what is not</h3>
            <p>
              Every teammate works on this one machine and can see everything on
              its disk. Each gets a folder of its own under{" "}
              <code className="mono">/home/box/hydo/&lt;bot&gt;</code>, but that is a
              convention they follow, not a wall. Treat anything on here as
              visible to the whole team.
            </p>
            <p>
              Chat, memory and routines are not on it. Those stay on this Mac, in
              each teammate&apos;s own profile.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
