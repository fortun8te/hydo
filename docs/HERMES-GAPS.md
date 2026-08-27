# Hermes surface Hydo does not use, and why

Hermes exposes 168 `@method` handlers; Hydo calls about 51. Most of the rest
are genuinely irrelevant to a teammate app. This file records the ones that
are NOT — either because they are worth wiring, or because they look worth
wiring and are not, which is the more expensive mistake.

Verified against the installed Hermes at `~/.hermes/hermes-agent` and against
the live account, not against documentation.

---

## Fixed (was dead, now wired)

These were all the same shape: a capability that looked finished. None of them
produced an error; they made the app quietly worse than its parts.

| What | The bug |
|---|---|
| `session.events.since` | `rt.lastSeq` was written and never created, so the first frame carrying a `seq` threw inside a readline handler and **ended the event stream**. The watermark was also never read, so any blip swallowed mid-stream output. |
| `mcp_servers` | Hermes resolves MCP servers against the config of the `HERMES_HOME` a session started in. Hydo starts every bot in its own profile home and added servers to the *launch* home, so every pin was silently filtered as unknown and the Plugins screen changed nothing for any teammate. |
| `delegation.model` | Resolved at every dispatch; empty means *inherit the parent*. A profile had no `delegation` block, so a teammate on an expensive model spent it on every piece of grunt work it fanned out. |
| `session.steer` | In preload with a comment explaining why it mattered, called from nowhere. A message to a busy teammate that had not delegated became a note for the next turn. |

---

## Do NOT wire: `learning.frames` / `.detail` / `.edit` / `.delete`

All four are already in `preload.cjs` and called from nowhere, which makes them
look like the cheapest win available. They are not.

`agent/learning_graph.py:199` builds from `get_hermes_home() / "memories"`, a
**process-level** lookup. Hydo's gateway child is never given `HERMES_HOME` —
the per-bot profile is passed as `profile` on `session.create`, which binds the
home for that session's *agent*, not for the gateway process. So the RPC reads
the launch home regardless of which bot is asking.

Measured:

```
~/.hermes/memories/MEMORY.md                       1150 bytes   <- what it returns
~/.hermes/profiles/hydo<id>/memories/MEMORY.md        0 bytes   <- the bot's own
```

A "what this teammate has learned about you" panel built on this would show the
user's personal Hermes memories under **every** bot. Worse than useless: it
leaks the launch home into per-bot UI and looks authoritative doing it.

Wiring it needs a `profile` param on the RPC, which is a Hermes-side change.
`mcp.servers.*` and `plugins.manage` already take one, so the precedent exists.

---

## Worth wiring, in rough order of value

- **`process.list` / `process.stop` / `process.kill`** — session-scoped
  background processes. `terminal` is in the `builder` profile, so a teammate
  can leave a dev server running and there is currently no way to see or stop
  it short of Activity Monitor.
- **`session.undo`** — drops the last exchange from Hermes' history. The cheap,
  non-destructive sibling of the file-level rollback Hydo already ships, and a
  real answer to a bad prompt.
- **`tools.list` / `tools.show`** — the actual tool inventory for a session.
  Would let the rail say what a teammate can *do* rather than naming a profile
  and a token cost.
- **`skills.manage`** — `list | search | install | browse | inspect` against the
  hub, and it **takes a `profile` param explicitly** for capability UIs managing
  a bot's skills. Hydo's own skill writing (`SKILL:`) is local-only.
- **`session.branch`** — fork a conversation. "Try it another way" without
  losing the thread.
- **`image.generate`** — teammates that produce pictures rather than describing
  them. Pairs with the `image_gen` toolset, which no profile includes.
- **`pet.*` (15 methods)** — a complete avatar system: gallery, generate from a
  prompt or a reference photo, hatch, name, scale, export. Sitting next to an
  app whose defining visual is an avatar.

## Known coherence gap

`vision` is in no profile, so a user can attach an image and the teammate
cannot look at it. The gateway comments call this a deliberate deferral pending
a VLM. It is still the most surprising thing in the app.
