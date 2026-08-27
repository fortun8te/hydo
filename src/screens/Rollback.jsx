import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog.jsx";

/**
 * Undo a teammate's file changes.
 *
 * Hermes takes a checkpoint before a teammate writes to disk, and the whole
 * `rollback.list` / `.diff` / `.restore` path was already wired all the way
 * through `hermes-gateway.cjs`, `store.cjs`, `main.cjs` and the preload
 * bridge. Nothing in the app ever called it, so a bot with `terminal` and
 * `file` could edit anything you owned and the only undo was git — if the
 * directory happened to be a repo.
 *
 * Two restores, and the difference is the reason for the confirm text:
 *   - one file  — disk only, safe mid-turn
 *   - everything — also rewinds the session history, and Hermes refuses it
 *                  while a turn is running
 */
function when(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `rollback.diff` shapes vary by Hermes build; take the first thing that reads as a diff. */
function diffText(res) {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (res.error) return `Could not read this checkpoint: ${res.error}`;
  for (const key of ["diff", "patch", "text", "content", "output"]) {
    if (typeof res[key] === "string" && res[key].trim()) return res[key];
  }
  if (Array.isArray(res.files)) {
    return res.files.map((f) => (typeof f === "string" ? f : f.path || f.file || "")).join("\n");
  }
  return JSON.stringify(res, null, 2);
}

/** Files a checkpoint touched, when Hermes names them. */
function filesOf(res) {
  if (!res || typeof res !== "object") return [];
  const raw = Array.isArray(res.files) ? res.files : [];
  return raw
    .map((f) => (typeof f === "string" ? f : f.path || f.file || f.filename || ""))
    .filter(Boolean);
}

export default function Rollback({ agent, onClose }) {
  const [state, setState] = useState({ status: "loading", enabled: false, checkpoints: [] });
  const [openHash, setOpenHash] = useState(null);
  const [diff, setDiff] = useState({ hash: null, loading: false, text: "", files: [] });
  const [confirm, setConfirm] = useState(null);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    if (!agent?.id || !window.hydo?.rollbackList) {
      setState({ status: "ready", enabled: false, checkpoints: [] });
      return;
    }
    setState((s) => ({ ...s, status: "loading" }));
    Promise.resolve(window.hydo.rollbackList(agent.id))
      .then((res) =>
        setState({
          status: "ready",
          enabled: !!res?.enabled,
          checkpoints: Array.isArray(res?.checkpoints) ? res.checkpoints : [],
        })
      )
      .catch(() => setState({ status: "ready", enabled: false, checkpoints: [] }));
  }, [agent?.id]);

  useEffect(load, [load]);

  function openDiff(hash) {
    if (openHash === hash) {
      setOpenHash(null);
      return;
    }
    setOpenHash(hash);
    setDiff({ hash, loading: true, text: "", files: [] });
    Promise.resolve(window.hydo.rollbackDiff?.(agent.id, hash))
      .then((res) => setDiff({ hash, loading: false, text: diffText(res), files: filesOf(res) }))
      .catch((err) =>
        setDiff({ hash, loading: false, text: `Could not read this checkpoint: ${err.message}`, files: [] })
      );
  }

  async function restore(hash, filePath) {
    setConfirm(null);
    setNote(filePath ? `Restoring ${filePath}…` : "Rolling back…");
    try {
      await window.hydo.rollbackRestore?.(agent.id, hash, filePath || undefined);
      setNote(filePath ? `Restored ${filePath}.` : "Rolled back.");
      load();
    } catch (err) {
      setNote(`Failed: ${err.message}`);
    }
  }

  const { status, enabled, checkpoints } = state;

  return (
    <aside className="bot-rail rollback" aria-label="Undo file changes">
      <header className="bot-rail__head">
        <button type="button" className="icon-btn" onClick={onClose} title="Back">
          <i className="gb-icon gb-icon-chevron-left" />
        </button>
        <span className="bot-rail__title">Undo</span>
        <button type="button" className="icon-btn" onClick={load} title="Refresh">
          <i className="gb-icon gb-icon-arrow-u-up-left" />
        </button>
      </header>

      {status === "loading" ? (
        <p className="bot-rail__hint mute">Reading checkpoints…</p>
      ) : !enabled ? (
        <p className="bot-rail__hint mute">
          {agent?.name || "This bot"} has no checkpoints. Hermes takes one before a teammate
          writes to disk, so they appear once it has actually changed a file in this session.
        </p>
      ) : checkpoints.length === 0 ? (
        <p className="bot-rail__hint mute">Nothing changed on disk this session.</p>
      ) : (
        <>
          <p className="bot-rail__hint mute">
            Every point where {agent?.name || "this bot"} was about to change a file. Restoring
            one file touches disk only. Rolling everything back also rewinds the conversation,
            and Hermes will refuse it while a turn is running.
          </p>
          <ul className="rollback__list">
            {checkpoints.map((c) => {
              const open = openHash === c.hash;
              return (
                <li key={c.hash} className={open ? "rollback__row is-open" : "rollback__row"}>
                  <button type="button" className="rollback__head" onClick={() => openDiff(c.hash)}>
                    <span className="rollback__msg">{c.message || "Checkpoint"}</span>
                    <span className="rollback__when">{when(c.timestamp)}</span>
                    <i className={`gb-icon gb-icon-chevron-${open ? "down" : "right"}`} />
                  </button>
                  {open ? (
                    <div className="rollback__body">
                      {diff.loading ? (
                        <p className="mute">Reading…</p>
                      ) : (
                        <>
                          {diff.files.length > 0 ? (
                            <div className="rollback__files">
                              {diff.files.map((f) => (
                                <button
                                  key={f}
                                  type="button"
                                  className="rollback__file"
                                  onClick={() =>
                                    setConfirm({ hash: c.hash, filePath: f, message: c.message })
                                  }
                                >
                                  <i className="gb-icon gb-icon-arrow-u-up-left" />
                                  <span>{f}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {diff.text ? <pre className="rollback__diff">{diff.text}</pre> : null}
                        </>
                      )}
                      <button
                        type="button"
                        className="ghost ghost--solid rollback__all"
                        onClick={() => setConfirm({ hash: c.hash, message: c.message })}
                      >
                        Roll everything back to here
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {note ? <p className="bot-rail__hint">{note}</p> : null}

      {confirm ? (
        <ConfirmDialog
          title={confirm.filePath ? "Restore this file" : "Roll everything back"}
          body={
            confirm.filePath
              ? `${confirm.filePath} goes back to how it was before "${
                  confirm.message || "this checkpoint"
                }". Other files are left alone.`
              : `Every file changed since "${
                  confirm.message || "this checkpoint"
                }" goes back, and the conversation rewinds to that point. Hermes will refuse this while ${
                  agent?.name || "the bot"
                } is working.`
          }
          confirmLabel={confirm.filePath ? "Restore" : "Roll back"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => restore(confirm.hash, confirm.filePath)}
        />
      ) : null}
    </aside>
  );
}
