import UmbraFace from "../umbra/UmbraFace.jsx";
import { botWorks } from "../lib/working.js";
import { pipOf } from "../lib/presence.js";
import ActivityMark from "./ActivityMark.jsx";

/**
 * Home.
 *
 * A real destination, not the shrug you get when nothing is selected. It is
 * where you land with no teammates, and it is one click away forever after.
 *
 * The thing it exists to prevent is the blank composer: an app that opens onto
 * an empty box tells you nothing about what it can do, and the cost is not
 * confusion, it is paralysis. So Home answers three questions in order . what
 * is happening right now, who works here, and what is scheduled . and every
 * row on it is a way in rather than a status readout.
 *
 * Sized for a small team on purpose. Real usage of this kind of app clusters
 * under five bots, so the roster is generous cards rather than a dense table:
 * at five, cards read faster and look like people; at fifty they would not,
 * and that is a problem worth having later.
 *
 * The glow is the app's one piece of ambient character and it stays, under
 * everything, following the pointer.
 */

function greeting(hour) {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return diff > 0 ? "any moment" : "just now";
  if (mins < 60) return diff > 0 ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return diff > 0 ? `in ${hrs}h` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}

function sizeLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The one line under the greeting. It says what is true, or it says nothing. */
function stateLine(working, routines, agents) {
  if (working.length === 1) return `${working[0].name} is working.`;
  if (working.length > 1) return `${working.length} teammates are working.`;
  const next = routines.find((r) => r.active !== false && r.at);
  if (next) {
    const when = relTime(next.at);
    if (when && !when.endsWith("ago")) return `Next up: ${next.name || "a routine"} ${when}.`;
  }
  if (agents.length) return "All quiet.";
  return "";
}

export default function Home({
  agents = [],
  channels = [],
  routines = {},
  artifacts = [],
  userName,
  onOpen,
  onNewBot,
  onNewChannel,
  onOpenRoutine,
  onOpenArtifact,
}) {
  const roster = agents.filter((a) => a && !a.hidden);
  const working = roster.filter((a) => botWorks(a, a.id));
  const allRoutines = roster
    .flatMap((a) => (routines[a.id] || []).map((r) => ({ ...r, bot: a })))
    .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  const files = [...artifacts]
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 6);

  // Pointer-following glow. Written straight to CSS vars so moving the mouse
  // across Home never triggers a React render.
  const glow = {
    onPointerMove: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      const y = (e.clientY - r.top) / r.height;
      e.currentTarget.style.setProperty("--glow-x", `${x * 46}px`);
      e.currentTarget.style.setProperty("--glow-lift", `${(1 - y) * 26}px`);
      e.currentTarget.style.setProperty("--glow-boost", String(1 + (1 - y) * 0.5));
    },
    onPointerLeave: (e) => {
      e.currentTarget.style.setProperty("--glow-x", "0px");
      e.currentTarget.style.setProperty("--glow-lift", "0px");
      e.currentTarget.style.setProperty("--glow-boost", "1");
    },
  };

  // ---- nobody here yet -----------------------------------------------------
  // Unchanged on purpose: an empty app should show you the thing it makes, not
  // a sentence pointing at a button in the corner.
  if (!roster.length) {
    return (
      <div className="sand-home" {...glow}>
        {/* Decorative marks for the empty state — not a real teammate, so
            there is no agent.glow to read. Left plain. */}
        <div className="sand-home__marks" aria-hidden="true">
          {["cyan", "purple", "orange"].map((tint, i) => (
            <UmbraFace
              key={tint}
              className={`sand-home__mark sand-home__mark--${i}`}
              tint={tint}
              shape={["squircle", "blob", "hex"][i]}
              size={i === 0 ? 92 : 62}
              live
              mood="fidget"
              poke
            />
          ))}
        </div>
        <h1 className="sand-home__title">No teammates yet</h1>
        <p className="sand-home__sub">
          A teammate is a person-shaped thing with its own memory, its own
          workspace and its own tools. Make one and tell it what it is for.
        </p>
        <div className="sand-home__actions">
          <button type="button" className="ghost ghost--solid" onClick={onNewBot}>
            New teammate
          </button>
          <button type="button" className="ghost" onClick={onNewChannel}>
            New channel
          </button>
        </div>
      </div>
    );
  }

  const line = stateLine(working, allRoutines, roster);

  return (
    <div className="sand-home sand-home--full" {...glow}>
      <div className="hy-home">
        <header className="hy-home__head">
          <h1 className="hy-home__greet">
            {greeting(new Date().getHours())}
            {userName ? `, ${userName}` : ""}
          </h1>
          {line ? <p className="hy-home__state">{line}</p> : null}
        </header>

        {/* Working first, and only when it is true. A section that says
            "nothing is running" every day trains you to stop looking. */}
        {working.length ? (
          <section className="hy-home__sec">
            <h2 className="hy-home__label">Working now</h2>
            <div className="hy-home__live">
              {working.map((a) => {
                const step = (a.todos || []).find((t) =>
                  /^(in[_-]?progress|active|running|doing)$/i.test(t.status || "")
                );
                return (
                  <button
                    key={a.id}
                    type="button"
                    className="hy-live"
                    onClick={() => onOpen?.(a.id)}
                  >
                    <UmbraFace tint={a.blob} shape={a.shape} size={34} glow={!!a.glow} live mood="spin" poke={false} />
                    <span className="hy-live__copy">
                      <span className="hy-live__name">{a.name}</span>
                      {/* The plan step wins when there is one — it is what
                          the teammate SAID it is doing. Failing that, the
                          real tool line, which now names the product, and its
                          brand mark beside it. */}
                      <span className="hy-live__what hy-act">
                        {step ? null : <ActivityMark plugin={a.activityIcon} size={14} />}
                        <span className="hy-act__text">
                          {step ? step.text : a.activityDetail || a.activity || "Working"}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="hy-home__sec">
          <h2 className="hy-home__label">
            Your team
            <span className="hy-home__count">{roster.length}</span>
          </h2>
          <div className="hy-home__grid">
            {roster.map((a) => {
              const pip = botWorks(a, a.id) ? "work" : pipOf(a);
              return (
                <button key={a.id} type="button" className="hy-card" onClick={() => onOpen?.(a.id)}>
                  <span className="hy-card__face">
                    <UmbraFace
                      tint={a.blob}
                      shape={a.shape}
                      size={40}
                      glow={!!a.glow}
                      live
                      mood={pip === "work" ? "spin" : "fidget"}
                      poke={false}
                    />
                    {pip ? <span className={`sand-row__dot is-${pip}`} aria-hidden="true" /> : null}
                  </span>
                  {/* Name and role on ONE row. The role used to take a row of
                      its own, which was the last thing making the card tall
                      for a word that is usually shorter than the name it sits
                      under. */}
                  <span className="hy-card__top">
                    <span className="hy-card__name">{a.name}</span>
                    {a.label ? <span className="hy-card__label">{a.label}</span> : null}
                  </span>
                  {/* The description if it has written one, else the last thing
                      said. A card with only a name tells you nothing about
                      which teammate this is. */}
                  <span className="hy-card__sub">{a.description || a.last || ""}</span>
                </button>
              );
            })}
            <button type="button" className="hy-card hy-card--new" onClick={onNewBot}>
              <span className="hy-card__plus" aria-hidden="true">
                +
              </span>
              <span className="hy-card__name">New teammate</span>
            </button>
          </div>
        </section>

        {channels.length ? (
          <section className="hy-home__sec">
            <h2 className="hy-home__label">
              Channels
              <span className="hy-home__count">{channels.length}</span>
            </h2>
            <div className="hy-home__rows">
              {channels.map((c) => (
                <button key={c.id} type="button" className="hy-row" onClick={() => onOpen?.(c.id)}>
                  <span className="hy-row__icon" aria-hidden="true">
                    <i className="gb-icon gb-icon-people-3" />
                  </span>
                  <span className="hy-row__copy">
                    <span className="hy-row__name">{c.name}</span>
                    <span className="hy-row__sub">
                      {(c.members || []).length} member{(c.members || []).length === 1 ? "" : "s"}
                      {c.last ? ` · ${c.last}` : ""}
                    </span>
                  </span>
                  <i className="gb-icon gb-icon-chevron-right" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="hy-home__sec">
          <h2 className="hy-home__label">
            Routines
            {allRoutines.length ? <span className="hy-home__count">{allRoutines.length}</span> : null}
          </h2>
          {allRoutines.length ? (
            <div className="hy-home__rows">
              {allRoutines.slice(0, 6).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={r.active === false ? "hy-row is-off" : "hy-row"}
                  onClick={() => onOpenRoutine?.(r.agentId, r.id)}
                >
                  <span className="hy-row__icon" aria-hidden="true">
                    <UmbraFace tint={r.bot.blob} shape={r.bot.shape} size={22} glow={!!r.bot.glow} poke={false} />
                  </span>
                  <span className="hy-row__copy">
                    <span className="hy-row__name">{r.name || r.instruction || "Routine"}</span>
                    <span className="hy-row__sub">
                      {r.bot.name}
                      {r.active === false ? " · paused" : r.at ? ` · ${relTime(r.at)}` : ""}
                    </span>
                  </span>
                  <i className="gb-icon gb-icon-chevron-right" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <p className="hy-home__empty">
              Nothing scheduled. Ask a teammate to check something every morning and
              it will make one.
            </p>
          )}
        </section>

        {files.length ? (
          <section className="hy-home__sec">
            <h2 className="hy-home__label">Recent files</h2>
            <div className="hy-home__rows">
              {files.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="hy-row"
                  onClick={() => onOpenArtifact?.(f.id)}
                >
                  <span className="hy-row__icon" aria-hidden="true">
                    <i className="gb-icon gb-icon-file-text" />
                  </span>
                  <span className="hy-row__copy">
                    <span className="hy-row__name">{f.title}</span>
                    <span className="hy-row__sub">
                      {[
                        (f.ext || "").toUpperCase(),
                        sizeLabel(f.bytes),
                        relTime(f.updatedAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <i className="gb-icon gb-icon-chevron-right" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
