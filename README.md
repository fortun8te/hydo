# Hydo

**An open-source desktop app for a team of AI teammates — inspired by Grok Bot, running on Hermes Agent, and yours to run on your own hardware.**

Not a chatbot with one window. A roster of named, always-on teammates: each has its own memory, its own workspace on disk, its own tools, and its own animated face. You talk to them in threads, they talk to each other in channels, and they get on with things on a schedule while you are not looking.

MIT licensed. Electron 42, React 19, Vite. Entry is `electron/main.cjs`; the renderer lives in `src/`.

## What makes it different

- **Runs on your hardware if you want it to.** Point it at any OpenAI-compatible endpoint — an Unsloth server, LM Studio, Ollama — and switch between that and a hosted model with one control. The app tells you honestly whether your endpoint is answering *before* you send a message, because a local server that is off looks exactly like a broken model.
- **One shared Linux machine for the whole team.** Files, installed software and browser logins live on its disk, so a teammate that signs into something once leaves it signed in for the next one. Billed by the second and switched off when idle.
- **It says what it is doing.** "Opening a pull request on GitHub", with the real brand mark — read from the actual tool call, not guessed.
- **Everything is measured.** `docs/` records what things cost and what was tested versus merely read. Several entries are corrections of earlier claims that turned out to be wrong.

Turns run on [Hermes Agent](https://hermes-agent.nousresearch.com) over its `tui_gateway` JSON-RPC protocol (`electron/hermes-gateway.cjs`, `docs/HERMES-GATEWAY.md`). OpenRouter is a fallback only, used when Hermes is unavailable.

## Not affiliated with xAI

Hydo is an independent project. The layout and interaction model take inspiration from Grok Bot's desktop client; the name, the code and the backend are its own, and no user-facing string in the app says "Grok" except where it truthfully names xAI's CLI as a coding harness. Contributors: keep it that way.

## Quick start

```
npm install
npm start
```

`npm start` runs Vite on `127.0.0.1:5173` then launches Electron (`package.json` `dev` script).

- Tests: `npm test` (`scripts/test.cjs`)
- Production renderer: `npx vite build` (output in `dist/`)

## How it is wired

Electron loads the Vite URL in development and `dist/index.html` when packaged. `electron/preload.cjs` exposes `window.hydo` to the renderer. `src/App.jsx` / `src/screens/Shell.jsx` drive the UI. `electron/store.cjs` owns bots, channels, messages, and turn orchestration. Each bot gets a Hermes session through `electron/hermes-gateway.cjs`. Plugins are Hermes MCP servers, adapted in `electron/hermes-plugins.cjs`. Keyboard chords live in `src/lib/shortcuts.js`.

A channel fans a user message to every member. Each member takes its own Hermes turn. The channel prompt tells members with nothing to add to reply `SKIP` so they stay quiet. Bots can ping other bots. Messages support reactions, reply-to, attachments, approvals ("ask before acting"), and clarify questions. Routines are stored per bot. Command palette is mod+K. Find in chat is mod+F.

## Keyboard shortcuts

From `src/lib/shortcuts.js` (`mod` is Command on macOS, Ctrl elsewhere):

| Chord | Action |
| --- | --- |
| mod+K | Command palette |
| mod+F | Find in chat |
| mod+N | New bot |
| mod+Enter | Send |
| mod+, | Settings |
| mod+B | Toggle sidebar |
| mod+I, mod+L | Toggle info panel |
| mod+[ / mod+] | Back / forward |
| alt+Up / alt+Down | Previous / next bot |

## State

Persisted at `~/Library/Application Support/hydo/state.json` (Electron `app.getPath("userData")` + `state.json` in `electron/store.cjs`).

## UI without Electron

For renderer work only:

```
npx vite
```

Open `http://localhost:5173/?mock=1`. That query flag, plus `import.meta.env.DEV` and no `window.hydo`, installs `src/lib/devmock.js`. The mock never runs in Electron or in a production build.
