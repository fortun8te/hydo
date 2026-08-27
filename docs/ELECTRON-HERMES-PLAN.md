# Electron app build plan — Hermes agent integration (Hydo)

Copy-and-paste brief for the team. Product name: **Hydo Bot**. Do **not** rewrite large portions of the frontend; apply targeted CSS and component tweaks on the existing Opus/Hydo kit (`src/kit/tokens.css`, Cursor-dark theme). Preserve Hermes file-management and computer-use as they already run inside turns (`browser_exec` / workspace tools). Do not change plugin-icon mapping or MCP category sort.

**Pending:** a Claude chat transcript was not in the workspace; gaps below come from `docs/HERMES-GATEWAY.md`, `docs/HERMES-PARITY.md`, `electron/hermes-gateway.cjs`, and renderer preview/UI (2026-08-26). If that transcript appears, fold extra items here without deleting KEEP verdicts.

**Backend for cheap work:** Muse 1.2 contributor via CLI (`~/bin/ocodex` → `codex --profile muse`, Meta Model API). Do not default Hydo or ocodex workers to Grok or OX alpha.

---

## Feature Gap Analysis

**Already present — preserve, do not reimplement**

- File-management and computer-use run in the Hermes child; Hydo streams `tool.*`. Keep gateway spawn/env; never `config.set`.
- Approvals, clarify, `message.react`, file/image/pdf attach, MCP catalog/list/remove/test/OAuth, cron RPC (wired, not owning Hydo routines yet), learning frames, usage reads.
- Plugin contract in `hermes-plugins.cjs`. MCP sort: canonical categories then localeCompare (`Plugins.jsx`) — keep.

**Wire next (real gateway gaps)**

Done in code (do not re-do): per-bot profiles, `session.resume` on cold start (not `opts.complete`), `prompt.background`, `subagent.interrupt`/`steer`, gates Send/Skip, `parseChoices`/`MEMORY:` gone, `row_id` mapping, OpenRouter not a silent twin.

Still Hydo: 15s routine poll posts to chat; Hermes cron is `deliver: "local"` registration only. SKIP is prompt-not-harness. `splitBubbles` capped. No computer preview.

- `plugins.list` / `plugins.manage` later (Hermes plugins ≠ MCP).

**Deliberately unused:** pet, voice/wake, hosted browser controller, bot_relay, billing mutations, MoA, `config.set`.

**File preview (MediaViewer in `RichContent.jsx`)**

| Type | Today | Target (targeted, no rewrite) |
|---|---|---|
| `.nd` | Not in `EXT_KIND` / `TEXTISH` | Treat as textish (Notion-like source); label “ND document”; never execute. |
| PDF | Kind `pdf`; viewer falls through to “No preview available” unless `item.text` | Embed via `<iframe>`/`<object>` or `pdf.js` **only** from a sandboxed `file://` / blob the main process already attached; keep `pdf.attach`. |
| HTML / html | Source in `<pre>` by design (never mounted as markup) | Keep source-first; optional sandboxed iframe (`sandbox=""`) if the user asks to “render” — default remains source. |
| `property.zip` | Generic `archive` card | List zip entries (names, sizes) via main-process unzip of the attached path; do not auto-extract into workspace; preview inner `.nd`/PDF/HTML with the same rules. |

`MAX_PREVIEW_TEXT` (400k) stays. Binary without a handler stays the file card.

---

## UI Improvement Checklist

Constraint: **do not rewrite** Shell/Sidebar/Transcript architecture. Tweaks only.

1. **Spinner / avatar spin scoped to the active turn**  
   `busyHere` / `workingIn` already exist (`Transcript.jsx`, `Sidebar.jsx`). Bug: fallback `status === "working"` still spins the same bot in **every** chat when `workingIn` is missing. Ensure `store.cjs` always sets `workingIn` for the live conv; roster and other threads stay `mood="idle"`. BotRail currently uses global `status === "working"` — gate that the same way. In-chat working row may spin; other faces must not.

2. **Shape-rotation animation (easing-in, pause, easing-out, wobble)**  
   `UmbraFace` spin is a continuous eased 360 (`SPIN_MS` 1150, `SPIN_DWELL` 0.7) with no pause. Change **only** `spinTurn` / `SPIN_MS` in `UmbraFace.jsx`: ease-in → one revolution → brief pause (~180–280ms, eyes forward) → ease-out into the next turn; add a 2–4° yaw wobble at rest of the pause so it does not look frozen. Keep `cfg.turn` (eyes ride the mesh). Do not swap the Umbra engine.

3. **Reaction UI**  
   Affection hearts (`reaction` event / `onAffection`) vs tapbacks (`message.react`) share language. One chip style, one hover set, same retract-on-second-click. Keep Hydo multi-emoji per actor; do not adopt Hermes one-emoji-per-author in the renderer.

4. **Plugin icons**  
   Composer already prefers `plugin.iconUrl` then `plugin.icon` / `puzzle-piece`. If catalog rows lack `iconUrl`, map known MCP names to existing kit PNGs/SVGs in `src/kit/images/` — additive map only. **Do not** change MCP sort.

5. **Sidebar (Grokbot-like, still Hydo)**  
   Keep 280px `--sand-sidebar-width`, collapsed mount (must stay mounted), Search / Plugins / account. Tighten row preview (13px), 36px mark, 14/600 name — already documented in `sidebar.css`. No new nav IA.

6. **Plugins spinner**  
   `hy-plugins-spin` is linear infinite; match Umbra easing so loading dots do not fight the face.

No new kit assets. Mock `?mock=1` remains the visual source of truth.

---

## Sub-Agent Strategy

**Research scouts (read-only, ocodex/Muse)**  
Harvest gateway unused methods, preview `EXT_KIND`, `workingIn` call sites. Output CONFIRMED vs PLAUSIBLE with file:line. Never edit.

**Implementation workers (disjoint `owns`)**  
Cheap, mechanical diffs only, Muse 1.2 via `ocodex` (`--profile muse`), not OX alpha:

- Worker A: `RichContent.jsx` + CSS — `.nd`, PDF embed, zip listing UI (no main-process unzip yet if not owned).
- Worker B: `UmbraFace.jsx` spin curve only.
- Worker C: `workingIn` plumbing tests in `scripts/` — no renderer restyle.

Ban refactors. One supervisor (paid / strong model) verifies diffs against this plan and Hydo tests. Failed/empty workers: supervisor finishes from checkpoint.

**Efficiency monitor**  
A scout (or script) diffs `session.usage` before/after: standing prompt size, MEMORY: injection, reaction notes duplicated onto prompt text. Expected impact: drop duplicate MEMORY: prose once profiles exist (~hundreds of tokens/turn); do not shrink tool schemas that Hermes needs.

**Trial (this environment)**  
`ocodex_managed.py doctor`: python, ocodex, orslot, docker, skill OK; SearXNG missing (no worker web search). `search --dry-run` produced a supervisor brief and ledger. Live `ocodex exec` against Muse was not run from the gated harness; operators should `muse login` then `ocodex exec` a one-word ping. Risk: empty streams (~25% historically) → supervisor retry.

---

## Production-Readiness Roadmap

| Milestone | Exit criteria | Safeguard |
|---|---|---|
| M0 Freeze contracts | `npm test` + `scripts/store-extras-test.cjs` green; plugin sort snapshot | Do not merge PRs that rewrite `hermes-plugins.cjs` sort or icon contract |
| M1 Preview | `.nd` text, PDF iframe, HTML source default, `property.zip` listing; tests on `normKind` / `isTextish` | Feature-flag iframe; sandbox HTML |
| M2 Spin / reactions | `workingIn` asserted in store tests; spin curve unit on `spinTurn`; reaction chips visual check on `?mock=1` | No global `status` spin in Sidebar/BotRail |
| M3 Mid-turn sheets | sudo/secret/preview.respond; stall timeout never hits for those events in gateway harness | New kinds only; reuse approval layout |
| M4 Memory/cron hybrid | Per-bot Hermes profile; routines → `cron.manage` with Hydo UI | Keep `soul.cjs` until profiles exist |
| M5 Pack | Electron signed build; Hermes child + venv bundled; OpenRouter `complete()` remains fallback only | Golden `scripts/test.cjs` kit needles |

Overrides: every PR lists files **not** to touch (`hermes-gateway.cjs` spawn, MCP sort, file tools). Reviewer runs `npm test` twice. Product strings stay “Hydo Bot”.

---

## Efficiency Enhancements

- **Audit:** log `session.usage` and `session.context_breakdown` per turn in activity (already gateway methods). Compare standing() length vs Hermes memory tool. Count reaction-note prepends.
- **Cuts:** stop `MEMORY:` regex once the memory tool is isolated per profile; stop re-sending full soul snapshot every turn if Hermes already froze it; keep toolset pin (`HERMES_TUI_TOOLSETS`) — it is isolation, not waste.
- **Expected impact:** 10–25% fewer prompt tokens on chatty channels after dropping duplicate memory injection; no change to computer-use schema.
- **Workers:** Muse 1.2 for scouts/impl; one strong supervisor. Token budget: prefer `effort: low` on keyword checks.

---

*End of plan. Implement in that order; skip pet/voice/billing.*
