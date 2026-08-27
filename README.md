# Hydo

Desktop app: Electron 42, React 19, Vite. Entry is `electron/main.cjs`. The renderer lives in `src/`.

It is a Hydo Bot client: a roster of always-on named teammates you chat with, not a single chatbot. Layout and chrome follow the Grok Bot UI, but the product name is Hydo Bot. Do not put "Grok" in any user-facing string.

Turns run on Hermes Agent over its `tui_gateway` JSON-RPC protocol (`electron/hermes-gateway.cjs`, `docs/HERMES-GATEWAY.md`). OpenRouter (`electron/store.cjs`) is a fallback only, used when Hermes is unavailable.

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
