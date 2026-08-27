# Hermes parity — what Hydo reimplemented, and what should actually move

Audited 2026-08-26 against Hydo (`electron/*.cjs`) and `~/.hermes/hermes-agent`.
Gateway method catalogue is already in `docs/HERMES-GATEWAY.md` (166 `@method`
handlers). This file does not re-list them. It answers: for each Hydo
reimplementation, what Hermes already does, whether Hydo should hand the job
over, and what would be lost.

Verdicts: **REPLACE** (stop doing it in Hydo; call Hermes), **KEEP** (Hydo's
version is the right product, or Hermes' equivalent does not fit), **HYBRID**
(Hermes owns the durable work; Hydo still owns presentation or isolation).

Anything not read from source is marked **unverified**.

Hermes home on this machine: Hydo never sets `HERMES_HOME`
(`electron/hermes-gateway.cjs` `startChild`, env at 461-475). Default is
`~/.hermes` (`hermes_constants.py:114-139`).

---

## 1. Per-bot MEMORY.md / SOUL.md / USER.md (`electron/soul.cjs`)

### What Hydo does now

Per teammate files under `<hydo-data>/bots/<id>/`:

| File | Role | Lines |
|---|---|---|
| `SOUL.md` | standing personality; default text tells the model to emit `MEMORY:` / `PING:` / `ROUTINE:` prose | `soul.cjs:4-16, 55-58` |
| `MEMORY.md` | bullet list; `memoryAdd` appends `- text` | `soul.cjs:24-26, 60-72` |
| `USER.md` | same shape, 2000-char bound | `soul.cjs:18, 28-29, 74-76, 134-142` |

`speak()` snapshots soul + memory into the system prompt every turn
(`store.cjs:910-922`) and writes `AGENTS.md` in the bot workspace so Hermes
picks it up (`store.cjs:713-717`). Mid-turn durable writes from the model go
through `extractDirectives` → `memoryAdd` (`store.cjs:939-942`), not through
Hermes' `memory` tool.

`memoryReplace` / `memoryRemove` / `user*` exist in `soul.cjs:160-174` and are
**unverified** as called from the renderer (no grep in this pass of
`electron/main.cjs`).

### What Hermes provides

**`memory` tool** (`tools/memory_tool.py`).

- Two stores: `MEMORY.md` (agent notes) and `USER.md` (user profile)
  (`memory_tool.py:5-10, 247-248`).
- Actions: `add` / `replace` / `remove`, plus atomic `operations` batches
  (`memory_tool.py:1286-1328`). Same substring-match replace/remove idea as
  Hydo (`memory_tool.py:21-22` vs `soul.cjs:119-131`).
- Frozen snapshot into the system prompt at session start; mid-session writes
  hit disk immediately but do **not** rewrite the prompt until the next session
  (`memory_tool.py:11-14`).
- Injection scan, char budget, drift guard (`memory_tool.py:82-129`).

**Where the files live — this is the isolation question.**

`get_memory_dir()` is `get_hermes_home() / "memories"` (`memory_tool.py:64-66`).
`get_hermes_home()` is: context override → `HERMES_HOME` env → `~/.hermes`
(`hermes_constants.py:114-139`). It is **not** the session `cwd`.

So memory is **profile-home scoped**, not per-session and not per-workspace.
Two Hermes sessions on the same `HERMES_HOME` share one `memories/MEMORY.md`.
Hydo's `sessionFor` comment (`hermes-gateway.cjs:725-727`) that teammates
"never share … memory" is false for Hermes' `memory` tool. They only isolate
**workspace files** and **session history** (per-bot `cwd` + per-bot
`session.create`).

The previous audit's "install-global" claim is **correct for Hydo's current
launch**: Hydo does not set `HERMES_HOME` and does not pass
`session.create`'s `profile` (`createParams` at `hermes-gateway.cjs:706-718`
forwards cwd/title/model/effort/fast only). Every teammate's Hermes `memory`
tool would write the same `~/.hermes/memories/MEMORY.md`.

It is **not** "install-global with no escape." Hermes profiles each have their
own home (`cron/jobs.py:69-79` is explicit: per-profile `HERMES_HOME`;
`methods_session.py:38-43` rebinds `HERMES_HOME` for a session's `profile`).
`profiles.create` writes that profile's `SOUL.md` (`methods_profiles.py:407-411`).
That is the isolation unit Hermes actually designed.

**`learning.*` RPCs** (`methods_tools.py:1775-1829`) are the `/journey` graph
(skills + memory **chunks** as nodes). They are not a substitute for the
`memory` tool. Hydo already wires them (`main.cjs` learning IPC). Do not
confuse the two.

**Hermes `SOUL.md`** is profile-home (`methods_profiles.py:345, 684, 754, 867`),
not session cwd. Hydo's `SOUL.md` is a teammate voice file plus a **protocol
cheat sheet** (`soul.cjs:10-13`). Hermes' soul is identity, not Hydo's
directive grammar.

Hydo's default `writer` tool profile already includes the `memory` and
`clarify` toolsets (`hermes-gateway.cjs:641-643`). The model already has the
real tool. Hydo still also regexes `MEMORY:` lines.

### Verdict: **HYBRID**

- **Stop** teaching `MEMORY:` prose (`soul.cjs:10`, `store.cjs:295`) and
  applying `extractDirectives` memory side effects (`store.cjs:940-942`).
  Let the `memory` tool write.
- **Do not** delete Hydo's per-bot files until each teammate has its own
  Hermes **profile** (or a dedicated `HERMES_HOME`). Dropping Hydo's
  `bots/<id>/MEMORY.md` onto the shared `~/.hermes/memories/` would merge
  every teammate's notes. That is the real loss.
- Hydo's `SOUL.md` stays as Hydo voice **or** becomes `profiles.create`
  `soul=` plus `session.create` `profile=`. Mixing both without a profile
  means two souls (Hydo `AGENTS.md` + Hermes profile `SOUL.md`) and one
  shared memory.

Migration risk: high if done without profiles. Medium if each bot is a Hermes
profile first, then Hydo stops snapshotting MEMORY.md into `standing()`.
OpenRouter fallback (`defaultComplete`) has no `memory` tool — those turns
would stop persisting facts unless Hydo keeps `MEMORY:` as a fallback-only
path.

Tests: none of `npm test`'s channel fan-out / SKIP / member cap / rename /
ping-DM cases assert memory files. Memory migration does **not** invalidate
those tests. **Unverified** whether any other script asserts `MEMORY.md`.

---

## 2. Routines vs Hermes cron

### What Hydo does now

`state.routines[agentId]` in `state.json` (`store.cjs:49, 120-121`). Shape:
`{id, agentId, name, instruction, active, at, createdAt, runs[]}`
(`store.cjs:989-998`). Created from `ROUTINE: create {…}`
(`store.cjs:984-1012`) or UI (`setRoutine` / `deleteRoutine` /
`runRoutine` at `store.cjs:1245-1290`).

Firing: `main.cjs:345-352` `setInterval` every 15s, `dueRoutines()`
(`store.cjs:1292-1305`) then `runRoutine` which `speak()`s the instruction
into the bot's **1:1 thread**. One-shot by `at` vs last `runs[0].at`. No
cron expressions. App must be open.

Hydo **already** exposes Hermes `cron.manage` as `hydo:cron`
(`main.cjs:295-303`, gateway `cron()`). Parallel to the homemade loop
(comment at `main.cjs:295`).

### What Hermes provides

- Tool: `cronjob` in toolset `cronjob` (`tools/cronjob_tools.py:1985`,
  `toolsets.py:72, 194-196`).
- RPC: `cron.manage` list/add/remove/pause/resume, optional `profile` scope
  (`methods_tools.py:1688-1762`). Add takes `schedule`, `prompt`, `repeat`,
  `continuity`, `deliver` (`methods_tools.py:1727-1758`).
- Store: `<HERMES_HOME>/cron/jobs.json` — **per profile**, not per session
  (`cron/jobs.py:4, 69-80`).
- Ticker: **not** inside `tui_gateway`. `hermes_cli/cron.py:91-93`: "The cron
  ticker only runs inside the gateway (`_start_cron_ticker` in
  `gateway/run.py`); there is no standalone cron daemon." Hydo spawns
  `python -m tui_gateway.entry` (`hermes-gateway.cjs:477`), not
  `gateway/run.py`. `tui_gateway` watches `cron.changed` mtime
  (`server.py:4390-4507`); it does not fire jobs.
- Cron-spawned agents disable `clarify` and `messaging` toolsets
  (`cron/scheduler.py:468-486`). Delivery can target `bot-chat[:name]`
  (`methods_tools.py:1752-1756`).

Hydo's `writer` profile does **not** include `cronjob`
(`hermes-gateway.cjs:643`). The model cannot call `cronjob` unless the bot is
on `full` or the pin is widened.

### Verdict: **HYBRID** (do not REPLACE the 15s loop yet)

Hermes cron is a real scheduler with pause/resume, cron expressions, and
run logs. It is the right long-term owner **if** something actually ticks
it. Under Hydo's current process model, `cron.manage` add would create jobs
that sit in `~/.hermes/cron/jobs.json` until a Hermes messaging gateway is
also running. Hydo's 15s loop is crude and one-shot, but it fires while the
Electron app is open, into the teammate's visible thread.

What would be lost if routines simply became Hermes cron jobs:

- Delivery into Hydo's `state.messages` (cron writes its own output dir /
  Bot Chat, not Hydo bubbles).
- Per-bot isolation (jobs share one `jobs.json` unless each bot is a
  profile).
- Firing without `hermes gateway`.
- `ROUTINE:` creating a job from a `writer` bot (toolset absent).
- Hydo UI that lists `state.routines` (would need to render `cron.manage`
  list).

What Hydo is worse at: recurring schedules, pause, profile-scoped secrets,
not depending on the Electron window.

Practical path: keep the 15s loop as the Hydo-visible "routine"; optionally
**mirror** create/pause into `cron.manage` only after Hydo either embeds the
ticker or documents that the Hermes gateway must be installed. Adding
`cronjob` to a tool profile without a ticker is a trap.

Tests: `scripts/test.cjs` creates a routine-shaped object in one ping-adjacent
block (~206) but the named suite is ping/DM, not due-firing. Replacing
`runRoutine` would not break channel fan-out, SKIP, member cap, or rename.
A test that asserts `state.routines` after a `ROUTINE:` line **would** break
if directives go away — **unverified** that such a test exists beyond the
inline create in `test.cjs`.

---

## 3. Bot-to-bot messaging (`runPing` / `state.dms` / `pairKey`)

### What Hydo does now

- `pairKey(a,b)` = sorted `"id:id"` (`store.cjs:70-72`).
- `state.dms[pairKey]` is the bot-bot transcript (`store.cjs:48, 611-620`).
- User-thread mention regex (`mentionTarget`, `store.cjs:171-187`) or
  `PING: {"name","text"}` (`store.cjs:1367-1375`) calls `runPing`
  (`store.cjs:651-701`): specialist `speak()`s, bubbles go to the DM, user
  thread gets "Pinging …" + "Messaged" tally, **not** the specialist's 1:1
  (`store.cjs:191-194` in `scripts/test.cjs` asserts this).
- Then the pinger summarises for the user (`store.cjs:1342-1347`).

This is Hydo product: iMessage-like DMs plus a user-visible ping.

### What Hermes provides

**`bot_relay.*` is not Slack/Discord.** `docs/HERMES-GATEWAY.md` §5 called it
"Hermes' own Slack/Discord bridge." Source disagrees.

`tools/bot_relay.py:1-23` and `methods_bot_relay.py:1-20`: cross-**connection**
relay for Hermes Desktop. Every gateway the Desktop holds (local, SSH, cloud,
docker) is a peer. Desktop owns sockets. Gateway only does file plumbing
under `<root>/bot_relay/` (`roster.json`, `outbox/`, `replies/`). Methods:

| RPC | Job |
|---|---|
| `bot_relay.roster.sync` | Desktop pushes **other connections'** agents |
| `bot_relay.outbox.drain` | Desktop claims envelopes `message_agent` queued for remote targets |
| `bot_relay.deliver` | Desktop runs a one-turn `hermes -p <profile> chat -c "Bot Chat"` on the **target** gateway (`methods_bot_relay.py:75-87`) |
| `bot_relay.outbox.pending` | watcher event, not an `@method` (`server.py:4513`) |

The send path agents actually call is **`message_agent`**
(`tools/bot_mode_dm.py`). It is gated: session title must be Bot Chat
(`BOT_CHAT_TITLE`) and the install must be Bot-Mode-managed
(`bot_mode_dm.py:253-268`). Hydo sessions are titled with the teammate name
(`store.cjs:724`) and `source: 'hydo'` (`hermes-gateway.cjs:707`).
`message_agent` would return "only available in a Bot Mode 'Bot Chat'
session."

Hydo teammates are multiple sessions in **one** Electron app, not multiple
Hermes Desktop connections. `bot_relay` does not move a message from Sauce's
Hydo session to Dev's Hydo session.

### Verdict: **KEEP** Hydo's DM/ping; do **not** REPLACE with `bot_relay`

`bot_relay` fits if Hydo later federates with a remote Hermes gateway (SSH
teammate). It does not fit in-app pings.

`message_agent` would fit only if Hydo became Hermes Bot Mode (profiles +
canonical Bot Chat). That is a product rewrite, not a swap. Lost: Hydo DM
threads, "Pinging/Messaged" chrome, ping-does-not-write-specialist-1:1,
mention regex, tests in `scripts/test.cjs` 176-202.

A **HYBRID** later: keep `runPing`; if `message_agent` is ever enabled, also
fan into Bot Chat. Not now.

Tests: **invalidates ping/DM** if `runPing` / `state.dms` / tally messages
change. Channel fan-out / SKIP / cap / rename stay.

---

## 4. Transcript authority (`state.json` vs `session.history`)

### What Hydo does now

`state.messages[conversationId]` and `state.dms` hold the UI transcript:
user/bot chat, SKIP-elided turns, `kind: sending|tally|approval|clarify|choice|routine|event`,
reactions, `replyTo`, streaming flags, channel fan-out (`store.cjs` throughout).
Hydo uuids. `session.history` is exposed as `hydo:history`
(`main.cjs:246`, `hermes-gateway.cjs:1166`) but the renderer is driven by
`state.json`. Comments treat Hydo as source of truth for reactions
(`store.cjs:241-242, 979`).

### What Hermes provides

`session.history` (`methods_session.py:2776-2804`) reads the session DB with
`include_row_ids=True`. Projection `_history_to_messages` (`server.py:8279-8359`):
`role` in `{user, assistant, tool, system}`, `text`, optional `timestamp`,
`row_id`, tool rows, hidden/compaction rows stripped. One assistant blob per
turn. No Hydo `kind`, no channel membership, no DM pair, no choice cards.

`message.react` addresses `row_id` or `newest_role` (`methods_session.py:1430-1448`).
Hydo uuids are invisible to Hermes (`HERMES-GATEWAY.md` §6.3).

Hermes emits **one** `message.start` / stream / `message.complete` per
`prompt.submit` (`server.py:11438`, complete at 11981). That is the turn
boundary, not a bubble boundary.

### Verdict: **KEEP** Hydo as the UI transcript; **HYBRID** for addressing

Hermes history is the model conversation (tools, reasoning, compaction). Hydo
state is the iMessage surface (channels, SKIP, tallies, choice cards, which
bot spoke in a room). Making Hermes authoritative **breaks**:

- Channels: one Hermes session per **bot**, not per channel. A channel turn
  still lands in that bot's Hermes history mixed with 1:1 turns
  (`speak`/`sessionFor` always use `agent.id`, `store.cjs:722, 1539`).
- SKIP: Hydo omits SKIP from `state.messages` (`store.cjs:1554-1557`) but
  Hermes still persisted the turn.
- `kind: choice|clarify|approval|routine|tally|event`.
- `splitBubbles` fragments (Hermes has one assistant row).
- Bot-bot DMs (no Hermes session for the pair).
- Reactions on older Hydo messages (no `row_id` mapping).

What Hermes should own: durable model log, `row_id` for `message.react`,
compaction, undo. Hydo should **map** Hydo message id → `row_id` after
`message.complete` instead of only `newest_role`.

Tests: making Hermes the roster transcript would invalidate **channel fan-out
and SKIP** (those assert Hydo `state.messages`). Ping/DM too. Member cap and
rename are store-only and would survive if `state.channels` stays.

---

## 5. `extractDirectives` vs real tools (parseChoices / MEMORY: shipped)

`parseChoices` is **gone**. Choices are `clarify.request` + ChoiceCard only.
`MEMORY:` regex is **gone**. Memory tool + SHARED.md. OpenRouter fallback still
strips PING / ROUTINE / REACT / REPLY — it does not get Hermes memory.

### What Hydo does now

`extractDirectives` line-regexes four protocols and strips them from the bubble:

| Directive | Effect |
|---|---|
| `PING: {json}` | `runPing` |
| `ROUTINE: create {json}` | `applyRoutineCreates` |
| `REACT: {json}` | `applyBotReactions` → Hydo toggle + `message.react` (`row_id` when mapped) |
| `REPLY: {json}` | `applyBotReply` (Hydo `replyTo`) |

This is a protocol in the model's **prose**. It leaks when JSON parse fails
(`store.cjs:226-228` keeps the line). Formatting drift breaks it.

### What Hermes already has (Hydo already uses some of it)

**`clarify` tool** (`tools/clarify_tool.py:329-425`, schema 437-458,
toolset `clarify` at 553-554). Structured `question` + `choices` (up to 4) +
`multi_select` + batch `questions`. Gateway emits `clarify.request`; Hydo
already renders `kind: 'clarify'` and `clarify.respond`
(`store.cjs:804-818, 1620-1625`, `hermes-gateway.cjs:399-404, 947-958`).
The schema **forbids** enumerating options in the question text
(`clarify_tool.py:454-458`). `parseChoices` is the anti-pattern that schema
exists to kill.

**`memory` tool** — see §1. In every Hydo tool profile except none
(`hermes-gateway.cjs:641-648`).

**`message.react` RPC** — user/agent tapbacks with durable ids
(`methods_session.py:1430`). Not a model tool; the model cannot call it.
Hermes has a separate `reaction` **event** for affection ("ily" / hearts)
(`hermes-gateway.cjs:384-388`). Different thing.

**`cronjob` tool** — see §2. Not in `writer`.

**`message_agent` tool** — see §3. Gated to Bot Chat. Not in Hydo sessions.

No Hermes tool for "this assistant text is a reply to Hydo message uuid X".
Hermes replies are just the next assistant row.

### Directive → Hermes map

| Hydo directive | Hermes equivalent | Fit | Verdict |
|---|---|---|---|
| `MEMORY:` | `memory` tool (`memory_tool.py`) | Same job, better (schema, budget, scan). Isolation catch in §1. | **REPLACE** once per-bot profile/home exists; until then Hydo's file is the only isolated store |
| `PING:` | `message_agent` / `bot_relay` | Wrong context (Bot Mode / cross-connection). | **KEEP** Hydo ping |
| `ROUTINE:` | `cronjob` tool + `cron.manage` | Right abstraction, wrong process (no ticker in tui_gateway); isolation; not in `writer`. | **KEEP** Hydo create until §2 is solved; then **REPLACE** the prose |
| `REACT:` | no model tool; `message.react` RPC | Hydo must keep a way for the **model** to request a tapback. Hermes has no `react` tool in `tools/`. | **KEEP** a structured request; **REPLACE** the regex with a tiny Hydo tool or a Hermes plugin. RPC-only is not enough — the model never sees RPCs |
| `REPLY:` | none | Hydo thread graph. | **KEEP** |
| `parseChoices` A/B/C | `clarify` tool | Strict upgrade. Hydo already has the UI for `clarify.request`. | **REPLACE** |

`clarify` is mid-turn and **blocks** the agent until `clarify.respond`.
`parseChoices` posts a card **after** the turn and the next user message is a
normal `send`. Different UX. REPLACE means: stop regexing A/B/C; rely on
clarify cards (and delete the soul line that asks for A/B/C). Loss: a
non-blocking "here are options, pick later" card. Gain: no leaked `A)`;
answers resume the same turn.

Five directives, two with a real Hermes **tool** (`memory`, and `cronjob` if
you count ROUTINE), one with a real Hermes **UI tool** that Hydo already
wired (`clarify` vs `parseChoices`), one with an RPC but no model tool
(`REACT` / `message.react`), two with no equivalent (`PING`, `REPLY`).

### Tests

`parseChoices` / `kind: choice` — **unverified** in `npm test`. SKIP tests
use `complete: () => 'SKIP'` and would **not** care. Channel fan-out would
break if `extractDirectives` stopped returning `{text, dirs}` and
`sendToChannel` was not updated (`store.cjs:1546`). Ping tests would break
if `PING:` stopped working before `mentionTarget` is the only path — they
use `ping ${name}` English (`scripts/test.cjs:176`), which is
`mentionTarget`, **not** the `PING:` directive. Member cap / rename
untouched.

---

## 6. `splitBubbles()` vs Hermes message boundaries

### What Hydo does now

`splitBubbles` splits only on a `---` line (`/^\\s*---\\s*$/m`), max 1–3,
leftover joined. Soul does **not** teach blank-line bubbles. Channels `{ max: 1 }`,
job-done `{ max: 2 }`. Used on specialist replies, wrap-ups, routines, channel posts.

During streaming, Hydo uses **one** bubble filled by `message.delta`.
`extracted.posted` / `extracted.yielded` stop `send()` from pushing a second
copy: leftover text after a committed beat is the only extra bubble.

### What Hermes provides

One `message.start` per `prompt.submit` (`server.py:11438` and the other
start sites). Deltas concatenate. One `message.complete` with the full
`text`. History: one assistant row (`_history_to_messages`). No "paragraph =
message" event.

Hermes does **not** emit real iMessage-style bubble boundaries. Hydo's split
is a presentation trick. The TUI renders one assistant message per turn
(`ui-tui` — not re-read line-by-line this pass; gateway events are enough).

### Verdict: **KEEP** (product), optionally **HYBRID**

KEEP if the iMessage multi-bubble look is the point. It is not a Hermes
clone; Hermes will not grow this. Do not expect to delegate it.

HYBRID: stop splitting **after** a Hermes stream if it double-posts; split
only the fallback `defaultComplete` path, or split the completed stream
bubble in place instead of appending.

Tests: none of the named suites assert bubble count from blank lines.
Changing split would not invalidate fan-out / SKIP / cap / rename / ping
unless a ping test counts DM messages loosely (`test.cjs` checks presence,
not bubble cardinality — verified by the assertion strings at 181-199).

---

## 7. `defaultComplete()` OpenRouter fallback

### What Hydo does now

`defaultComplete` (`store.cjs:147-169`): `OPENROUTER_API_KEY`, one
`chat/completions` call, system+user, no tools, no stream, no session.
`createStore({ complete })` injects it for tests.

`speak` (`store.cjs:923-935`): if `opts.complete` is set (tests), use it;
else Hermes `streamThroughHermes`; on throw, OpenRouter.

`docs/HERMES-GATEWAY.md:8-11` already says this is fallback-only.

### Is it still justified?

Yes as **degraded mode** when the python child is missing or a turn throws,
and as the **test harness** (`scripts/test.cjs` injects `complete`).

Lost when it runs (this is the real cost, not a hypothetical):

- Every Hermes tool (`memory`, `clarify`, `file`, skills, MCP).
- Approvals, streaming, activity, `message.react` forwarding, compaction,
  checkpoints/rollback, usage.
- Session history (the turn never hits Hermes).
- Per-session model/provider/fast overrides on `session.create`.
- The teammate is no longer Hermes Agent.

Also: `extractDirectives` still runs on OpenRouter prose, so the regex
protocol is **load-bearing for the fallback**. Killing `MEMORY:` without a
fallback story means OpenRouter turns cannot persist facts.

### Verdict: **KEEP** as last resort and test seam; never as default

Do not widen it. Consider surfacing in the UI that the turn did not go
through Hermes (today the user cannot tell). **Unverified** whether the
renderer shows that.

Tests: **all** of `npm test` inject `complete` and **never** hit Hermes.
Any migration that removes the `opts.complete` seam invalidates the entire
suite (channel fan-out, SKIP, cap, rename, ping/DM). Keep the seam even if
OpenRouter dies.

---

## Other reimplementations (short)

| Hydo | Hermes | Verdict |
|---|---|---|
| `standing()` + `AGENTS.md` rewrite every turn (`store.cjs:284-300, 715-717`) | session cwd context files + profile `SOUL.md` | **HYBRID** — Hydo identity belongs in profile soul / AGENTS.md once, not rebuilt as a MEMORY: protocol every turn |
| Tool profiles as extra python children + `HERMES_TUI_TOOLSETS` (`hermes-gateway.cjs:79-93, 639-691`) | `tools.configure` writes global `config.yaml` (deliberately unused, `HERMES-GATEWAY.md` §2.8, §5) | **KEEP** Hydo's pin; it is the correct isolation for tool schema. Not a clone of a Hermes feature Hermes refuses to make per-session |
| `toggleReaction` allowing multiple distinct emoji per actor (`store.cjs:234-242`) | one reaction per author (`methods_session.py:1434-1436`) | **KEEP** Hydo UI if you want multi-emoji; Hermes store will only keep the last |
| Reaction notes Map (`store.cjs:346-358`) | `_pending_reaction_notes` gated on `display.message_reactions` (off; Hydo does not write config) — `HERMES-GATEWAY.md` §6.2 | **KEEP** until that flag is on without a global config write |
| Channel fan-out, SKIP, `MAX_MEMBERS=6`, `CHANNEL_ROUNDS=3` (`store.cjs:23-28, 303-323, 1495+`) | no channel primitive | **KEEP** — this is Hydo |
| `mentionTarget` English ping (`store.cjs:171-187`) | none | **KEEP** |

---

## Prioritised migration plan

Ordered by (value if Hermes does the job) / (chance of breaking what already
works). Tests called out per step.

1. **Stop `parseChoices`; let `clarify` be the choice UI.**
   Value high (structured, already wired). Risk low: clarify path exists;
   soul A/B/C line is the only teacher. Delete regex + soul sentence.
   Tests: none of the named five. Add a clarify fixture later.

2. **Stop `MEMORY:` prose once each bot has isolated Hermes memory.**
   Value high (real tool, already in `writer`). Risk high unless isolation
   is done first. Do **0b** before this: `session.create` `profile` per bot
   (`methods_session.py:38-43`, `profiles.create` `methods_profiles.py:339`)
   so `memories/MEMORY.md` is not shared. Then drop `memoryAdd` from
   `extractDirectives` and the soul MEMORY line. Keep Hydo files as import
   seed. Tests: named suite untouched. OpenRouter fallback needs a leftover
   path or an honest "no memory" on fallback.

3. **Map Hydo message ids to Hermes `row_id` after each turn.**
   Value medium-high (`message.react` on old messages, `HERMES-GATEWAY.md`
   §6.3). Risk low if purely additive. Tests: untouched.

4. **Kill OpenRouter as a silent twin; keep `opts.complete` for tests.**
   Value medium (every fallback turn is not Hermes). Risk low if UI shows
   the failure instead of a tool-less reply. Tests: **must keep the inject
   seam** or the whole `npm test` file dies.

5. **Fix stream-then-split double-post if it exists (§6).**
   Value medium (honest bubbles). Risk medium (visual regression). Tests:
   ping DM count is presence-not-cardinality; still re-run ping/channel.

6. **Do not replace `runPing` with `bot_relay` / `message_agent`.**
   Negative value at current architecture. Revisit only for remote Hermes
   connections. Tests: ping/DM would be the first casualty.

7. **Do not replace the 15s routine loop with `cron.manage` until a ticker
   exists in-process or Hydo requires `hermes gateway`.**
   `cron.manage` is already IPC'd. Using it as the only scheduler today
   silently no-ops (`hermes_cli/cron.py:91-93`). Optional: add `cronjob` to
   a dedicated tool profile **after** ticker. Tests: routine create in
   `test.cjs` is incidental; due-firing is untested.

8. **`REACT:` / `REPLY:` stay Hydo.** Offer a real tool (Hydo-side or Hermes
   plugin) instead of regex when you touch directives. No Hermes equivalent
   for REPLY. REACT still needs a model-visible tool even after `message.react`
   is perfectly addressed.

9. **Last: make Hermes history a projection source for 1:1 replay**, never
   for channels/DMs/SKIP. Risk high; invalidates channel + SKIP + ping
   tests if you switch `getState().messages` to `session.history`.

**Named `npm test` coverage vs this plan**

| Test | Invalidated by |
|---|---|
| Channel fan-out | Making Hermes history the channel transcript; changing `sendToChannel` SKIP/`speak` contract |
| SKIP suppression | Same; also any `extractDirectives` change that stops returning stripped `text` without updating SKIP checks (`store.cjs:1362, 1555`) |
| Member cap | Nothing here (`MAX_MEMBERS` is Hydo-only) |
| Rename events | Nothing here |
| Ping / DM | Replacing `runPing` / `state.dms` / tally kinds; removing `mentionTarget` |

The expensive, correct Hermes-shaped work is **profiles for isolation** and
**clarify instead of A/B/C**. The rest of Hydo's "clone" is either a surface
Hermes does not have (channels, DMs, bubbles) or an API that does not run
inside the process Hydo actually starts (cron ticker, bot_relay Desktop).
)