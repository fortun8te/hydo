# Hermes gateway reference — what it exposes, what Hydo uses

Audited against `~/.hermes/hermes-agent` on **2026-08-26**. Every method line
below was read from source; every claim marked **verified live** was executed
against the running gateway on this machine and its output captured
(`scripts/hermes-probe.cjs`). Anything neither read nor executed is marked
**unverified** rather than guessed.

Hydo's rule: **all the power comes from Hermes.** The OpenRouter `complete()`
path in `electron/store.cjs` is a fallback for when Hermes is genuinely absent
or a turn throws — never the default.

---

## 1. Wire protocol

Line-delimited JSON-RPC 2.0 over stdio.

```
requests   {"jsonrpc":"2.0","id":"h1","method":"session.create","params":{...}}\n → stdin
responses  {"jsonrpc":"2.0","id":"h1","result":…|"error":…}\n                    ← stdout
events     {"jsonrpc":"2.0","method":"event",
            "params":{"type":"<EVENT>","session_id":"…","payload":{…}}}\n        ← stdout
```

The **event name is `params.type`**. The JSON-RPC `method` is the literal
string `"event"` for every server push. Session-less events carry
`session_id: ""`.

Launch line (`electron/hermes-gateway.cjs`):

```js
spawn(`${HERMES_ROOT}/venv/bin/python`, ['-m', 'tui_gateway.entry'], {
  cwd: HERMES_ROOT,
  env: { ...process.env, PYTHONPATH: HERMES_ROOT, HERMES_PYTHON_SRC_ROOT: HERMES_ROOT },
})
```

One python child for the whole app; one Hermes session per bot.

---

## 2. Methods

`~/.hermes/hermes-agent/tui_gateway/` declares **166** `@method(...)` handlers.
The tables below cover every one Hydo could plausibly want, with its
`file:line`. The remainder (pet/petdex, voice/wake, browser controller, bot
relay, profiles, subscription & billing mutations, spawn trees, handoff,
rollback, MoA) are listed in §5 as deliberately-unused, with the reason.

### 2.1 Session lifecycle

| Method | Source | Hydo |
|---|---|---|
| `session.create` | `methods_session.py:14` | **used** — `sessionFor()`; now forwards `model` / `provider` / `reasoning_effort` / `fast` |
| `session.list` | `methods_session.py:163` | **used** — `listSessions()` |
| `session.most_recent` | `methods_session.py:280` | unused |
| `session.resume` | `methods_session.py:372` | **used** — `resume()` |
| `session.history` | `methods_session.py:2776` | **used** — `history()` |
| `session.status` | `methods_session.py:2700` | unused (session.info events cover it) |
| `session.interrupt` | `methods_session.py:3327` | **used** — `interrupt()` |
| `session.steer` | `methods_session.py:3552` | **used** — `steer()` |
| `session.redirect` | `methods_session.py:3589` | unused — needs `_supports_active_turn_redirect`; steer is the safe sibling |
| `session.close` | `methods_session.py:3099` | **used** — `close()` / `shutdown()` |
| `session.undo` | `methods_session.py:2808` | unused |
| `session.compress` | `methods_session.py:2855` | unused (Hermes compresses on its own) |
| `session.branch` | `methods_session.py:3111` | unused |
| `session.title` | `methods_session.py:1294` | unused — Hydo titles at create |
| `session.delete` / `.activate` / `.set_hidden` / `.cwd.set` / `.workspace.move` / `.active_list` | `methods_session.py:1244/1219/1378/1081/1106/1181` | unused |
| `session.events.since` / `.stats` | `methods_session.py:3640/3671` | unused — Hydo consumes the live stream |

**`session.create` per-session overrides** (`methods_session.py:47-74`) — the
important find. `model` + optional `provider` become a **per-session** override,
and Hermes' own comment is explicit that this is *never* a global config write.
`reasoning_effort` is parsed server-side. `fast` is **presence-sensitive**:
omitted inherits the profile, `true` pins the priority tier, `false` pins
normal. Hydo forwards `fast` only when a real boolean is given.

### 2.2 Turns

| Method | Source | Hydo |
|---|---|---|
| `prompt.submit` | `methods_prompt.py:287` | **used** — returns `{status:"streaming"}`; the turn settles on `message.complete` |
| `prompt.background` | `methods_prompt.py:1321` | **used** — `submit(..., { background: true })`; settles on `background.complete` |
| `approval.respond` | `methods_prompt.py:1665` | **used** — `respondApproval()` |
| `approval.pending` / `.received` | `methods_prompt.py:1588/1601` | unused |
| `clarify.respond` | `methods_prompt.py:1515` | **used** — `respondClarify()` |
| `sudo.respond` / `secret.respond` / `terminal.read.respond` / `preview.read.respond` / `preview.act.respond` / `window.read.respond` / `tour.respond` / `mcp.setup.respond` | `methods_prompt.py:1578/1583/1524/1533/1541/1550/1559/1569` | **used** — `respondGate()` + ask card Send/Skip. MCP setup skip is `{status:"skipped"}`. |

### 2.3 Usage & billing

| Method | Source | Hydo |
|---|---|---|
| `session.usage` | `methods_session.py:1681` | **used** — `usage()` |
| `session.context_breakdown` | `methods_session.py:1705` | **used** — `contextBreakdown()` |
| `usage.bars` | `methods_session.py:2447` | **used** — `usageBars()` |
| `billing.state` | `methods_session.py:2431` | **used** — `billingState()` |
| `subscription.*`, `billing.charge*`, `billing.auto_reload`, `billing.step_up` | `methods_session.py:2462-2699` | unused — money movement is not Hydo's job |

### 2.4 Models

| Method | Source | Hydo |
|---|---|---|
| `model.options` | `methods_complete.py:469` | **used** — `modelOptions()` |
| `model.save_key` | `methods_complete.py:492` | unused — refuses on managed installs; needs a credential UI |
| `model.disconnect` | `methods_complete.py:572` | unused |

> The brief named `model.default` and `model.provider`. **Neither exists as a
> method.** They are *fields* on the `model.options` payload — verified live,
> its top-level keys are `providers`, `model`, `provider`.

### 2.5 Reactions

| Method | Source | Hydo |
|---|---|---|
| `message.react` | `methods_session.py:1430` | **used** — `react()` |

iOS Tapback semantics, enforced in Hermes' DB layer: **one reaction per author
per message**, re-sending the same emoji retracts it, `emoji: null` clears.
Addressed by durable `row_id`, or by `newest_role: 'user'|'assistant'` meaning
"the newest row of that role" (`methods_session.py:1447`).

### 2.6 Attachments

| Method | Source | Hydo |
|---|---|---|
| `file.attach` | `methods_prompt.py:1207` | **used** — `attachFile()` |
| `image.attach` | `methods_prompt.py:977` | **used** — `attachImage()` |
| `image.attach_bytes` | `methods_prompt.py:1020` | **used** — `attachImageBytes()` |
| `pdf.attach` | `methods_prompt.py:1081` | **used** — `attachPdf()` |
| `clipboard.paste` | `methods_prompt.py:937` | **used** — `pasteClipboard()` |
| `image.detach` | `methods_prompt.py:1254` | **used** — `detachImage()` |
| `input.detect_drop` | `methods_prompt.py:1274` | unused |
| `paste.collapse` | `methods_complete.py:14` | unused |

All stage into the session and are consumed by the **next** `prompt.submit`.

### 2.7 Learning, insights, cron

| Method | Source | Hydo |
|---|---|---|
| `learning.frames` | `methods_tools.py:1775` | **used** — `learningFrames()` |
| `learning.detail` | `methods_tools.py:1799` | **used** — `learningDetail()` |
| `learning.edit` | `methods_tools.py:1821` | **used** — `learningEdit()` |
| `learning.delete` | `methods_tools.py:1810` | **used** — `learningDelete()` |
| `insights.get` | `methods_tools.py:1275` | **used** — `insights()` |
| `cron.manage` | `methods_tools.py:1688` | **used** — `cron()` |

### 2.8 MCP / plugins

| Method | Source | Hydo |
|---|---|---|
| `mcp.catalog` | `methods_tools.py:1916` | **used** |
| `mcp.servers.list` | `methods_tools.py:1988` | **used** |
| `mcp.servers.add` | `methods_tools.py:2018` | *not* used for catalog installs — see §4 |
| `mcp.servers.remove` | `methods_tools.py:2250` | **used** |
| `mcp.servers.test` | `methods_tools.py:2171` | **used** |
| `mcp.servers.set_api_key` | `methods_tools.py:2091` | **used** |
| `mcp.servers.oauth.start` | `methods_tools.py:2276` | **used** |
| `mcp.servers.oauth.poll` | `methods_tools.py:2337` | **used** |
| `plugins.list` / `plugins.manage` | `methods_tools.py:1428/2395` | unused — Hermes *plugins* are a different thing from MCP servers |
| `tools.list` / `.show` / `.configure`, `toolsets.list`, `skills.manage`, `agents.list` | `methods_tools.py:1491/1522/1565/1634/1832/1664` | unused |

### 2.9 Everything else, briefly

`config.get` (`methods_config.py:181`), `config.set` (`server.py:12679`),
`config.show` (`methods_tools.py:1450`), `setup.status`
(`methods_config.py:379`), `projects.*` (`methods_config.py:19-181`),
`process.*` (`methods_tools.py:39-61`), `shell.exec`
(`methods_tools.py:2529`), `cli.exec` (`methods_tools.py:371`),
`command.dispatch` (`methods_tools.py:432`), `slash.exec`
(`methods_tools.py:1121`), `llm.oneshot` (`methods_session.py:1483`),
`image.generate` (`methods_images.py:22`), `system.battery`
(`methods_tools.py:14`), `ping` (`server.py:15512`).

Of these Hydo uses exactly one: **`cli.exec`**, and only to run Hermes' own
`hermes mcp install` (§4). `config.set` is deliberately never called — Hydo does
not write `~/.hermes/config.yaml`.

---

## 3. Events

Names extracted from every `_emit(` call site in `tui_gateway/*.py` and
cross-read against `ui-tui/src/gatewayTypes.ts:613-759` (the TUI client's own
union — **not exhaustive**; several emitted names are absent from it).

| Event | Emitted at | Payload (source of truth) | Hydo |
|---|---|---|---|
| `gateway.ready` | `server.py` boot | `{heartbeat?, skin?}` | **used** — boot gate |
| `session.info` | `server.py:2232` (23 sites) | `SessionInfo` | **used** — cached on the bot |
| `message.start` | `server.py:6885` | none | **used** → activity "Thinking" |
| `message.delta` | `server.py:6894` | `{text, rendered?}` | **used** — streams into the bubble |
| `message.interim` | `server.py:7035` | `{text}` | unused |
| `message.complete` | `server.py:2225` | `{text, rendered, usage, status}` | **used** — settles the turn |
| `thinking.delta` | `server.py:6934` | `{text}` | **used** |
| `reasoning.delta` / `.available` | `server.py:6888/6711` | `{text, verbose?}` | **used** (delta) |
| `status.update` | `server.py:2381` (11 sites) | `{kind, text}` | **used** — working-row label |
| `tool.start` | `server.py:6629` | `{name, args_text, …}` | **used** → `activityFromTool` |
| `tool.progress` / `tool.generating` | — / `server.py:6933` | `{name, preview}` | **used** |
| `tool.complete` | `server.py:6676` | `{name, error?, duration_s}` | **used** |
| `tool.output_risk` | `server.py:6705` | **unverified** shape | unused |
| `approval.request` | `server.py:2365` | `{request_id, command, description, choices, allow_permanent, smart_denied}` | **used** — becomes a `kind:'approval'` message |
| `clarify.request` | **unverified** emit site | `{request_id, question(s), choices}` | **used** — `kind:'clarify'` |
| `subagent.spawn_requested` / `.start` / `.thinking` / `.tool` / `.progress` / `.complete` | `server.py:6768-6913` | `SubagentEventPayload` (`gatewayTypes.ts:536`) | **used** — `onSubagent`; drives "sub-agent: <goal>" |
| `reaction` | `server.py:6937` | `{kind}` | **used** — `onAffection`. **NOT the tapback.** This is the core's affection detector ("ily" / "<3" / "good bot" → hearts). Same word, different mechanism from `message.react`. |
| `error` | `server.py:2852` (9 sites) | `{message}` | **used** — rejects the turn |
| `session.usage` | `server.py:11373` | `{usage}` | unused — `message.complete` already carries usage |
| `session.title` | `server.py:11729` | carries the **durable** id, not the live one | handled in `ownerFor()` |
| `session.resume_progress` | `server.py:9375` | **unverified** | unused |
| `notification.show` / `.clear` | `server.py:2634/2651` | `{key, …}` | unused |
| `review.summary` | `server.py:2819` | `{text}` | unused |
| `background.complete` | `methods_prompt.py:1358` | `{task_id, text}` | unused |
| `sudo.request`, `secret.request`, `secret.expire`, `sudo.expire` | **unverified** emit sites (declared in `gatewayTypes.ts:728-730`) | `{request_id, env_var, prompt}` | **unused — gap**, see §6 |
| `moa.*`, `voice.*`, `wake.detected`, `pet.*`, `browser.progress`, `preview.restart.*`, `agent.terminal.output`, `terminal.close`, `billing.step_up.verification`, `notice`, `skin.changed` | various | — | unused, out of scope |

Events Hydo cannot attribute to a bot are **dropped**, never guessed onto
another bot (`ownerFor()`).

---

## 4. The plugins contract

`electron/hermes-plugins.cjs` implements the frozen UI contract on top of the
`mcp.*` RPCs. Where a shape differs, the adaptation lives in the main process
and the contract is untouched.

| Contract field | Hermes reality | Adaptation |
|---|---|---|
| `id` | no id — `mcp_servers` is a **name-keyed map**, the catalog is keyed by `entry.name` | `id === name` |
| `description` (servers) | `summarize_server` (`mcp_rpc_helpers.py:44`) has **no** description | joined back onto the catalog entry by name; a hand-added server falls back to a truthful transport line |
| `connected` | config presence ≠ connectivity | configured **and** enabled **and** (not OAuth-without-tokens). A cached `testPlugin` probe overrides it |
| `needsAuth` | only `oauth_tokens_present` is exposed | `oauth && !tokens`, **or** the catalog declares `requires` env keys and the config references none. Hermes exposes key *names* only, never values |
| `toolCount` | only a live probe knows | cached probe wins; otherwise the length of the config's `tools` allow-list, else `0` = "unknown, run testPlugin". Never invented |
| `category` | **does not exist anywhere.** `CatalogEntry` (`hermes_cli/mcp_catalog.py:148`) has name/description/source/transport/auth/tools/install and nothing else | derived Hydo-side from name + description keywords, default `"Other"`. The one contract field that is a derivation |
| `addPlugin(id)` | `mcp.servers.add`'s `preset` resolves against `_MCP_PRESETS` (`hermes_cli/mcp_config.py:36`) which holds **exactly one** entry, `"codex"` — not the manifest catalog. `mcp_catalog.install_entry` has **no RPC** | runs Hermes' own installer via `cli.exec ['mcp','install',<id>]` rather than reimplementing manifest + git-bootstrap. Its stdin is `/dev/null` server-side, so an entry that insists on prompting exits non-zero — surfaced verbatim, never swallowed |
| `transport` | **Hermes bug.** `mcp.catalog` reads `getattr(transport,"kind","")` (`methods_tools.py:1957`) but the dataclass field is `type`, so it falls through to `str()` and ships a raw repr: `TransportSpec(type='http', command=None, …)` | `transportKind()` parses the kind back out. Verified live |

---

## 5. Deliberately unused

- **pet / petdex** (`methods_session.py:1735-2429`) — a sprite companion. No place in Hydo.
- **voice / wake / TTS** (`server.py:15293-16110`) — Hydo is a typed chat surface.
- **browser controller** (`methods_browser_control.py`) — for a client that *hosts* a browser; Hermes' own `browser_exec` tool already works inside a turn.
- **bot_relay** (`methods_bot_relay.py`) — Hermes' own Slack/Discord bridge; Hydo *is* the surface.
- **profiles** (`methods_profiles.py`) — multi-profile switching; Hydo runs one.
- **subscription / billing mutations** — Hydo never moves money.
- **spawn_tree, handoff, MoA, delegation.pause** — real capabilities, no product surface yet.
- **subagent.interrupt / subagent.steer** — **wired**. Stop also interrupts the last sub-agent. No extra chrome.
- **`config.set`** — would write `~/.hermes/config.yaml`. Out of bounds.

---

## 6. Known gaps and honest caveats

1. **Gates have an ask card.** Sudo/secret use a password field. Other kinds
   (terminal, preview, window, tour, mcp.setup) use text/JSON Send plus Skip.
   Both call `respondGate` with a finished payload so the turn does not sit
   until `TURN_TIMEOUT_MS`.

2. **Reaction notes are gated off in Hermes, so Hydo carries its own.**
   `_pending_reaction_notes` (`methods_prompt.py:237`) folds unseen reactions
   into the next turn's *model input* — but only when config
   `display.message_reactions` is true, and it is **absent from this machine's
   `~/.hermes/config.yaml`**, so it defaults to false. Hydo does not write that
   file. Consequence: `message.react` is still called (Hermes keeps the durable
   record, and it lights up the moment the flag is enabled) **and** the note is
   additionally carried on the next prompt from Hydo's side, which is what makes
   the teammate actually understand the reaction today. That note rides on the
   prompt text, so unlike Hermes' own `_prepend_note` it *does* land in Hermes'
   persisted transcript. It never lands in Hydo's.

3. **Reaction addressing maps Hydo ids → Hermes `row_id` after each turn**
   via `session.history`. Older tapbacks send `row_id` when known, else
   newest-of-role. Hydo multi-emoji UI is kept.

4. **`usage.bars` returns `{ok:true, available:false}` here** — verified live.
   That is Hermes' fail-open answer for "not logged into the Nous portal", not a
   bug. Per-session usage from `session.usage` is real and complete, so the
   Settings pane should lead with that.

5. **`learning.frames` returns rendered terminal frames, not structured
   nodes** — ANSI art sized for an Ink TUI, with node ids embedded in the
   render. Hydo exposes it read-only (`learningFrames` / `learningDetail`) plus
   edit/delete by id. It is **not** a queryable memory store, so it cannot
   simply replace `electron/soul.cjs`'s hand-rolled `MEMORY.md`. Recommendation
   in §7.

6. **Sub-agent control is wired.** `onSubagent` drives the working row;
   `subagent.interrupt` / `subagent.steer` exist. Stop interrupts the last
   sub-agent.

7. **`session.resume` runs on cold start** (skipped when `opts.complete` is the
   test seam). Durable `hermesSessionId` is persisted. First turn also resumes
   if the child is down. Hydo still renders its own `state.json` transcript.

8. **One firer for routines.** `createRoutine` still registers Hermes
   `cron.manage` add with `deliver: "local"` (scheduler-only — no session
   injection). Hydo's 15s `dueRoutines` poll is the only thing that
   `runRoutine` / `speak`s into the transcript. Do not use `deliver: "origin"`.

### Still Hydo (do not "fix" these into Hermes clones)

- 15s routine poll posts to chat; Hermes cron is registration only (`deliver: "local"`).
- SKIP is prompt, not harness — every member is woken; SKIP suppresses the bubble.
- `splitBubbles` is capped at 3 (channels prefer 1). Blank lines do not auto-split dumps.
- No computer preview / second computer-use stack / VLM clicker.
- `parseChoices` and `MEMORY:` prose are gone. Clarify tool + memory tool.
- OpenRouter is test seam / last resort only. Hermes failure shows `Hermes failed: …`.

---

## 7. Should Hermes' learning store replace `soul.cjs`'s MEMORY.md?

**Partly, and not yet.**

- Per-bot `MEMORY.md` still exists on disk for the Hermes memory tool. Hydo
  does **not** parse `MEMORY:` prose and `standing()` does not re-inject it
  (`void memory`). Identity + soul dump + one SKIP line only.
- Hermes' learning store is **global to the Hermes install**, shared across
  every session and surface, and its read API returns pre-rendered TUI frames
  rather than records. It is a journey visualisation with mutation hooks, not a
  key-value memory a caller can query per bot.

Replacing `MEMORY.md` with it would (a) merge every teammate's memory into one
pool, breaking the "teammates never share memory" property `sessionFor()` is
built on, and (b) trade a readable per-bot markdown file for an ANSI render.

The right split: Hermes' per-profile memory tool owns facts; Hydo does not
re-inject `MEMORY.md` into the standing prompt. Learning-store read stays
optional. If Hermes later ships a structured `learning.list` with scope, revisit.

---

## 8. Hydo's surface

`electron/hermes-gateway.cjs` exports: `available, ensure, sessionFor,
hasSession, sessionIdOf, submit, respondApproval, respondClarify, interrupt,
steer, close, shutdown, logTail, usage, contextBreakdown, usageBars,
billingState, modelOptions, history, listSessions, resume, react, attachFile,
attachImage, attachImageBytes, attachPdf, pasteClipboard, detachImage,
learningFrames, learningDetail, learningEdit, learningDelete, insights, cron,
request`.

`request()` is the escape hatch for `hermes-plugins.cjs` and is **never**
exposed to the renderer. `contextIsolation: true` and `sandbox: true` are
unchanged.

Renderer API (`preload.cjs`, all `hydo:*` IPC): `react, setPinned, setUnread,
setHidden, duplicateAgent, steer, usage, listModels, history, listSessions,
resumeSession, attachFile, attachImage, attachImageBytes, attachPdf,
pasteClipboard, detachImage, learningFrames, learningDetail, learningEdit,
learningDelete, insights, cron, listPlugins, addPlugin, removePlugin,
testPlugin, startPluginAuth, pollPluginAuth, setPluginKey` — plus `send(text,
{replyTo})`.

Read-only wrappers are **fail-soft**: with Hermes absent they resolve to an
empty shape instead of rejecting, so `available() === false` leaves the app
fully usable.

---

## 10. Context efficiency — the tool-definition problem

### 10.1 What was wrong

Live `session.context_breakdown` on a Hydo teammate, before any of this:

```
context_used 24,711 / 1,000,000        model deepseek-v4-pro
  system_prompt          4,645
  tool_definitions      12,609   ← paid on EVERY turn
  mcp                    6,408   ← paid on EVERY turn
  subagent_definitions   1,443
  memory                   501
  conversation              53   ← the actual message
```

**~19,000 tokens of tool and MCP schema to read a 53-token conversation**, on a
teammate that writes ad copy and will never call `browser_exec`,
`computer_use`, the 29 chrome-devtools tools, `delegate_task` or `project_*`.
In a six-member channel that is ~114,000 tokens of tool definitions per user
message.

### 10.2 The lever, and why it forces one child per profile

Hermes resolves a session's toolset from the **environment variable**
`HERMES_TUI_TOOLSETS`, read inside `_make_agent` at agent-build time
(`server.py:7799` → `_load_enabled_toolsets`, `server.py:5255`).

It is not an RPC parameter. The only RPC that changes it — `tools.configure`
(`methods_tools.py:1565`) — calls `save_config`, i.e. it rewrites
`~/.hermes/config.yaml`, which is out of bounds and would move every teammate
at once anyway.

So a per-bot toolset means **a per-profile gateway child**. `hermes-gateway.cjs`
now keys children by pin string: bots sharing a profile share a python process,
a new profile costs one more. Everything that was one child's state — pending
requests, session index, log ring, ready flag — is per-runtime, and `ownerFor`
is scoped to one child so two children minting the same 8-hex session handle
cannot cross-attribute events.

**MCP falls out of the same mechanism.** An entry in that list that is not a
built-in toolset is looked up against `mcp_servers` in config.yaml
(`server.py:5322-5343`), so `pinFor({profile:'researcher', mcp:['chrome-devtools']})`
gives a bot exactly the MCP servers it was granted and no others — requirement
2 solved by requirement 1's plumbing.

### 10.3 Measured (`node scripts/toolset-bench.cjs`)

Prompt tokens on a one-line turn, from `session.context_breakdown`:

| profile | toolsets | used | system | tool defs | subagents | saving |
|---|---|---:|---:|---:|---:|---:|
| `chat` | clarify, memory, todo | **5,096** | 2,555 | 2,200 | 0 | **−13,231 (72%)** |
| `writer` *(default)* | + skills, file | **9,834** | 4,577 | 5,335 | 0 | **−8,493 (46%)** |
| `researcher` | + web | **10,317** | 4,599 | 5,812 | 0 | **−8,010 (44%)** |
| `builder` | + terminal, delegation, session_search | **14,633** | 4,645 | 8,883 | 1,443 | **−3,694 (20%)** |
| `full` | Hermes' own resolution | 18,327 | 4,645 | 12,609 | 1,443 | — |

Two honest notes on these numbers:

- The `full` row reads 18,327 rather than the 24,711 at the top of this section
  because **MCP tools connect asynchronously** and a one-line benchmark turn
  finishes before `chrome-devtools` has attached. Against a warm session the
  same profile measures 24,711 with `mcp: 6,408`. Every non-`full` profile
  excludes MCP outright, so the real-world saving is **larger** than the table
  shows, not smaller.
- `system_prompt` moves too (2,555 → 4,645). That is Hermes tailoring its own
  prompt to the tools present; it is a genuine saving, not a measurement
  artefact.

Process topology, captured from the same run:

```
pid=36499  toolsets: clarify,memory,todo                          bots=[bench-chat]
pid=41168  toolsets: clarify,file,memory,skills,todo              bots=[bench-writer]
pid=44601  toolsets: clarify,file,memory,skills,todo,web          bots=[bench-researcher]
pid=46063  toolsets: clarify,delegation,file,…,terminal,todo,web  bots=[bench-builder]
pid=47119  toolsets: (hermes default)                             bots=[bench-full]
```

Widening a live bot's profile moves it to a new child and a new session —
verified in the same bench.

### 10.4 Why `writer` is the default, and why `skills` is in every profile

`writer` is the leanest profile that can still hold a conversation, remember,
plan, load a skill and touch its own workspace. `chat` is leaner but cannot
write a file, which most teammates eventually need.

`skills` (3 tools, `skill_manage` / `skill_view` / `skills_list`) is in **every**
profile including `chat`, because skills are Hermes' own answer to "make this
bot good at X" *without* permanent context cost: the toolset is three tool
definitions and a skill body loads only when the agent opens it. That is
strictly better than stuffing capability into the system prompt, which is paid
on every turn forever.

### 10.5 Reasoning effort on channel turns

`session.create` takes `reasoning_effort`. A channel turn is usually one line
or a bare `SKIP` — the SKIP rule guarantees it — so channel sessions default to
`low` effort. An explicit per-bot `reasoningEffort` always wins.

### 10.6 Compaction

`session.compress` (`methods_session.py:2855`) summarises old turns and rebuilds
the system prompt. Hydo runs `compressIfNeeded(botId, 70)` after every Hermes
turn, between turns only — Hermes returns 4009 and refuses mid-turn.

The threshold is 70%, not 95%: compression shrinks *history*, not the ~5k of
system prompt and tool schema underneath it, so compacting at the ceiling would
barely move the number. The user sees one quiet system line
("Older messages were summarised…"), never the raw compaction payload — a
transcript is a conversation, and a summariser's output is machinery.

### 10.7 Rollback — verified live

`_make_agent` reads `HERMES_TUI_CHECKPOINTS` from the process env
(`server.py:7812`); without it `rollback.list` answers `{enabled:false}`. Same
lever as toolsets, so it is enabled per-runtime for any profile carrying `file`
or `terminal`, and pointless (correctly off) for `chat`.

```
pin: clarify,file,memory,skills,todo
rollback.list before edit : {"enabled":true,"checkpoints":[]}
turn                      : "done"    (agent rewrote notes.txt)
file now                  : "REPLACED"
rollback.list             : [{"hash":"c0e5639c…","timestamp":"2026-08-26T17:45:09+02:00"}]
diff stat                 : "notes.txt | 2 +-  1 file changed, 1 insertion(+), 1 deletion(-)"
restore                   : {"success":true,"restored_to":"c0e5639c","reason":"before write_file","history_removed":4}
file after restore        : "ORIGINAL CONTENT\n"
```

Note the two modes: `rollbackRestore(bot, hash, filePath)` touches disk only and
is allowed mid-turn; without `filePath` it is a **full** rollback that also
rewinds session history (`history_removed: 4` above) and Hermes refuses it
while a turn is running.

---

## 11. Native reply: it does not exist

The brief asked whether Hermes has a first-class reply/thread/quote, the way
`message.react` turned out to be a real durable RPC rather than something Hydo
had to fake.

**It does not.** Verified by sweeping `tui_gateway/` and `hermes_state/` for
`reply_to`, `in_reply_to`, `parent_message`, `parent_id`, `thread_id`,
`thread_ts`, `quoted_message`, `quote_message` — **zero hits**. `prompt.submit`
(`methods_prompt.py:287`) accepts `session_id`, `text`, `display_kind`,
`truncate_before_user_ordinal` and `interrupted`; there is no parent field.
`session.history`'s `row_id` is a durable message address used for reactions and
truncation targeting, not a threading parent. Nothing in the `bot_relay` family
carries one either.

So Hydo keeps what it has, and it is the right shape anyway: a local `replyTo`
snapshot (id + text + author, copied so the quote survives the original being
deleted) as the render source, plus a `Replying to X: "…"` preamble on the
prompt so the model actually sees what is being answered. If Hermes ever ships a
parent field, only `send()` changes.

---

## 12. Second-pass triage — landed vs skipped

| Capability | Verdict | Reason |
|---|---|---|
| `notification.show` / `.clear` | **landed** | Consumed as `onNotice` → the working row (it is almost always "still starting the agent"). Separately, the per-bot **Notifications toggle now does something**: a teammate speaking in a conversation the user is not looking at raises a real `Notification`, and clicking it selects that conversation. Three gates — real words, speaker opted in, user elsewhere — plus a focused-window check. |
| `rollback.list` / `.diff` / `.restore` | **landed** | Agreed with the coordinator: a teammate editing files with no undo is the genuinely risky configuration. Needed the `HERMES_TUI_CHECKPOINTS` discovery to work at all. Verified live (§10.7). |
| `session.compress` | **landed** | Long threads otherwise grow until they blow the window (§10.6). |
| `session.title` | **landed** | One line on rename; without it `session.list` shows the old name forever. Cosmetic, so failures are swallowed. |
| `todo` / `delegate_task` | **landed** | `todo` is in every profile; `delegation` is in `builder`. Both are toolsets, so this *is* the wiring — and `delegation`'s 1,443 tokens of subagent definitions are exactly why it should not be in every profile. |
| `skills` | **landed** | In every profile (§10.4). Per-session scoping needs no extra work: skills load on demand through the toolset. |
| `subagent.*` events | already landed | `onSubagent` drives "sub-agent: \<goal\>" in the working row. |
| `session.undo` | **skipped** | Needs a message-level rewind UI Hydo has no concept of. `rollback.restore` already covers the dangerous half (files). |
| `session.branch` | **skipped** | Forked threads are a roster/navigation feature, not an RPC gap. Wiring it without the UI is dead code. |
| `handoff.*` | **skipped** | Moves a session between surfaces. Hydo is the only surface. |
| `spawn_tree.*` | **skipped** | Persists sub-agent trees for later inspection; the live `subagent.*` events already deliver the visibility that was asked for. |
| `moa.*` | **skipped** | Mixture-of-agents is configured in `config.yaml`, which Hydo must not write. The events are consumable but there is nothing to consume without the config. |
| `voice.*` | **skipped** | Real work — mic capture, streaming transcripts, barge-in — and the composer mic lives in `src/`, which this agent does not own. Half-wiring it would be worse than leaving it decorative. |
| `message.interim` | **skipped** | `message.delta` already streams the visible text; interim adds nothing a user would see. |
| `session.delete` / `.set_hidden` | **skipped** | Hydo's delete already closes the session. Deleting Hermes' durable row would destroy the very transcript `session.history` exists to preserve. Hiding is a Hydo roster concern (`setHidden`), not a Hermes one. |

---

## 9. Reproducing the evidence

```
node scripts/hermes-probe.cjs        # live: models, usage, history, react, plugins, cron
node scripts/toolset-bench.cjs       # live: per-profile context cost + process topology
node scripts/gateway-harness.cjs     # streaming turn, tool call, session reuse
node scripts/store-extras-test.cjs   # reactions, reply-to, workingIn, roster flags (offline)
npm test                             # the lead's suite
```
