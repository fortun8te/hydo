---
name: hydo-self-improve
description: Change Hydo itself — safely. Work in a throwaway git worktree, verify with tests, build and a real screenshot, and hand back a branch. Never edit the running app, never touch app data, never merge.
author: hydo
---

# Improving Hydo itself

You live inside Hydo. `/Users/michael/Projects/hydo` is the checkout the app the
user is looking at RIGHT NOW is running from, and
`~/Library/Application Support/Hydo/state.json` is the real roster of teammates —
including you. Editing either while the app is running can corrupt the program
you are running in and delete the data you are made of.

So the whole workflow is one idea: **do the work somewhere else, prove it there,
and hand back a branch a human merges.**

## Never

- Never edit files under `/Users/michael/Projects/hydo` directly. Only in a worktree.
- Never touch `~/Library/Application Support/Hydo/**` — state.json, window.json, bot workspaces.
- Never run `npm run smoke`, `npm run app`, `npm run dist`, or `electron .`.
  Those boot `electron/main.cjs`, which **pins userData to the user's real
  Hydo directory with no environment override** (see the comment at the top of
  `main.cjs`). There is no safe way to run the real app for verification.
  Use `scripts/shot.cjs` instead — it never loads main.cjs.
- Never merge, never `git push`, never `git checkout main`, never `git stash`
  in the live checkout. The user merges. That is the whole point.
- Never restart, relaunch or quit Hydo to "apply" a change.
- Never `git add -A` in the live checkout: another agent is often mid-edit there.

## The loop (~30 seconds of machine time, measured)

1s worktree + your edit + 6s screenshot + 20s test & build. It is cheap. Run it
after every change instead of reasoning about whether the change worked.

### 1. Branch somewhere else

```sh
cd /Users/michael/Projects/hydo
git worktree add -b hydo/<short-topic> /tmp/hydo-wt/<short-topic> HEAD
ln -s /Users/michael/Projects/hydo/node_modules /tmp/hydo-wt/<short-topic>/node_modules
cd /tmp/hydo-wt/<short-topic>
```

`HEAD`, not `main` — and never a branch that is checked out. The symlink is
what makes this take one second instead of an `npm install`; the worktree is
disposable, the modules are shared and read-only in practice.

If the live checkout has uncommitted work you need as a base, copy just those
files into the worktree. Do not commit on the user's behalf in the live checkout.

### 2. Make the change there

Match the surrounding style. Comments in this repo explain WHY, and usually name
the bug that motivated the rule. Write that kind of comment or none.

### 3. Verify — measure, do not assume

```sh
npm test          # ~11s, must exit 0
npm run build     # ~1.5s, must be warning-free
```

For anything that touches the UI — CSS, JSX, a token, a layout — those two are
**not enough**. The defining bug of this repo is a change that is correct in the
diff, green in the suite, and moves no pixels:

- `scripts/sidebar-sections-test.cjs:205` — a rule that changed nothing because
  a more specific selector already won.
- `scripts/plan-active-test.cjs:6` — a control that errored and never repainted.

So take a photograph:

```sh
npm run shot -- /tmp/<topic>-after.png          # or, to pick the port:
HYDO_SHOT_PORT=5207 npx electron scripts/shot.cjs /tmp/<topic>-after.png
```

It boots vite and a real `BrowserWindow` against the `?mock=1` fixture, with no
preload and no main process, and fails loudly on a blank frame. Shoot BEFORE and
AFTER and actually look at both images. If you cannot point at what moved, the
change did not land — go fix it, do not report it.

`HYDO_SHOT_WIDTH` / `HYDO_SHOT_HEIGHT` exist for responsive work (the rail
collapses below 880px). For behaviour that only happens *while* a window
resizes, `scripts/window-check.cjs` is the harness.

### When Hermes tells you the work is unverified

Hydo turns on Hermes' `agent.verify_on_stop` for every teammate
(`electron/bot-home.cjs`, `VERIFY_DEFAULTS`). If you edit code and then try to
finish in the same turn without fresh passing evidence, you get one synthetic
follow-up naming your changed files and the project's verify commands. It is
bounded — at most two — and it never fires on a turn that touched only prose.

Answer it honestly, and note what it CANNOT ask for: it names `npm run test`
and `npm run build`, because those are the commands `package.json` declares.
Both of those go green on a CSS rule that renders nothing. If your change was
visual, the nudge is satisfied by the suite and you are still not done — take
the photograph and look at it.

Add a test for what you changed. Every `scripts/*-test.cjs` is plain
`node:assert` — copy the nearest one, and register it at the end of the `test`
script in `package.json`.

### 4. Hand it back

```sh
git add -A && git commit -m "<what changed, and why>"
```

Then, **in this order**:

- If `gh auth status` succeeds AND `git remote -v` shows a remote:
  `git push -u origin <branch>` and `gh pr create`. Report the PR URL.
- Otherwise: stop. Say plainly *"no PR — <the repo has no git remote / the gh
  token is invalid>. The branch is `hydo/<topic>`, merge it with
  `git merge hydo/<topic>` from `/Users/michael/Projects/hydo`."*
  Do not add a remote, do not run `gh auth login`, do not create an account.
  That is the user's to do.

**As of the last check this machine has no git remote and `gh` reports an
invalid token, so the local-branch path is the live one.** Check anyway; the
user may have fixed it.

Leave the worktree in place if the user may want to look at it. When you are
done with it:

```sh
cd /Users/michael/Projects/hydo
git worktree remove --force /tmp/hydo-wt/<topic>   # the branch survives
```

### 5. Report honestly

Split what you **ran** from what you **think**:

> Verified: `npm test` exit 0, `npm run build` clean, screenshot shows the
> label at 4.7:1 against the panel (was 2.9:1).
> Not verified: behaviour in the packaged app, light mode on an external
> display.

Never write "should work", "should be fine", or "verified" about something you
did not execute. A green suite is evidence about the suite.

## Spending your thinking cheaply

You need a shell, so you need the `builder` tool profile — that is ~9.4s of
cold prefill before your first token, against 1.1s on `chat`. Pay it once and
then stay in the worktree; do not bounce between profiles.

**Do not turn thinking off.** `docs/LOCAL-MODEL.md` measures it: thinking costs
~35% more tokens for the same answer, and switching it off makes hard reasoning
*wrong*. On a local model at ~15.5 tok/s the way to be fast is not to think
less — it is to think once and then let the machine check you. Reading a file
costs you almost nothing; running the suite costs 11 seconds; guessing costs a
round trip and a wrong answer.

Concretely: skim, edit, run. Do not write a plan document, do not narrate, do
not re-derive what a 6-second screenshot would tell you.
