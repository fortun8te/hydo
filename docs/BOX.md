# The shared computer, and what it actually costs

Everything here was checked against the installed CLI (`box 0.1.184-ascii-prod1`
at `~/.ascii/bin/box`) and the live account on 2026-08-27, or against
`docs.ascii.dev`. Nothing in this file is assumed. No box was created, started
or resumed to write it — every call below is read-only.

## The account, exactly

`box status --json` and `box limits --json`:

| Fact | Value |
|---|---|
| Account | `michael@knaap.nu`, `loginState: active` |
| Tier | `accessTier: "trial"`, `billingStatus: "trialing"`, plan key `trial` |
| Trial ends | `2026-09-03T10:57:23Z` (a 7-day trial) |
| Included | `subscriptionQuotaSeconds: 2,000,000` VM-seconds — the `$20/mo` package |
| Used | 2,743s. `creditBalanceHours: 554.79` left |
| Machines at once | **2** (`trialLimits.activeBoxes`), against 100 on the paid tier |
| Starts | 5/min, 25/hour, 75/day. Create, resume AND fork each spend one |
| Auto-stop | Cannot be disabled on trial, and cannot exceed **2 hours** |
| Payment history | none (`hasPaymentHistory: false`) |

So it is **not a free tier** — it is a 7-day trial of the $20/mo plan, already
carrying its full 2,000,000 seconds. The first payment is what lifts the limits
(`upgradeEffects.endTrialOrFirstPayment`: 100 machines, 150 starts/day).

Rates, from `docs.ascii.dev/box/machines` and confirmed by
`billingMultiplier` in `box list --json`: `small` 2 vCPU/4GB at **0.5x**,
`default` 4 vCPU/8GB at **1x**, `large` 8 vCPU/16GB at **2x**. A month is
2,592,000 seconds, so one `small` left awake all month is ~65% of the plan and
one `large` is ~259% of it. Hydo creates `small`.

There is one box on this account already: `bx_843rh875`, `type: default`,
`state: stopped`, with a completed snapshot. Stopped is free and keeps the disk.

## CLI facts that shape the code

- `box new` has `--type`, `--ttl`, `--no-auto-stop`, `--from`, `--environment`.
  There is **no `--name` and no `--size`** — which is why the id is persisted
  rather than looked up.
- `box new --json` emits **JSONL**: `created`, then `state` frames, then
  `ready`. `box info`/`list`/`status`/`limits` emit one object.
- `box list` defaults to `--filter r` — RUNNING only. A stopped box is
  invisible without `--all`.
- `box list --json` already carries `desktopUrl`, `state`, `type`, `memoryGB`,
  `billingMultiplier` and `subdomain`, so nothing extra is needed to show status.
- `box resume --ttl` is optional and "Omit to keep the Box's current setting".
- `box exec <ID> [COMMAND]...` and `box ssh <ID> [COMMAND]...` take a
  **variadic trailing command**, so a global flag appended at the end is handed
  to the box as part of the command.
- Documented TTL ceiling is 30 days (2,592,000s); larger is capped server-side.
  Default auto-stop is 1 hour **from creation, not from activity**.

## One machine, one screen — the promise Hydo cannot keep

The product line is "each teammate gets its own screen". **It cannot, on this
platform.** Checked on 2026-08-27 against the CLI and `docs.ascii.dev`, not
assumed:

- `box info --json` / `box list --json` return exactly **one** `desktopUrl` per
  box, carrying a single Moonlight `hostId`/`appId` pair. There is no second
  stream and no per-agent variant of it.
- `box desktop <ID>` has only `--vnc`, `--public` and `--json`. **No `--display`,
  no `--session`, no `--user`.** Neither does `exec`, `ssh`, `new`, `resume` or
  `fork` — `--help` on every subcommand was read.
- `docs.ascii.dev/box/desktop-streaming`, verbatim: Lux "controls the Box's
  single shared desktop, so run only one Lux session at a time". The account cap
  is 20 lux sessions/day, one at a time per box.

So a per-bot screen would mean a per-bot **box**, which is the one thing
`box-runtime.cjs`'s header exists to prevent: fifty bots would be fifty machines
against an active limit of two, and the shared disk — the browser already signed
in, the font already installed — is the actual product.

Nothing was invented to paper over that. The rail used to caption the stream
"<Bot>'s screen" while every bot opened the same desktop; it now says **"Shared
screen — one desktop, all bots"**, with a line naming the consequence: they see
the same windows and take turns. `computer-rail-test.cjs` pins the old caption
out, so it cannot come back by accident.

What would make the promise true, if it is ever worth paying for: one box per
bot after the trial lifts the machine limit to 100 — a different cost law, and a
different product (no shared disk). It is not a UI fix.

## Clicking is not starting

Create, resume and fork each spend one of 5/minute, 25/hour, 75/day, so a panel
that calls the API on every open is a budget a person runs out of by fidgeting.
Three changes, all in `box-runtime.cjs`:

| Guard | What it stops |
|---|---|
| `STATUS_TTL_MS = 8000` cache + in-flight coalescing on `status()` | Shell.jsx re-reads status on every `sheet`/`rail` change; that was 2 CLI round-trips (`box status` + `box info`) per flick. A burst is now one |
| `START_COOLDOWN_MS = 5000`, answered from the last successful start | The double-click. `starting` only merges callers that OVERLAP; a click 300ms after the last one resolved was a second start |
| `START_WINDOWS` (4/min, 24/hour, 70/day) refused locally | A doomed start still costs a round-trip when the API is the one refusing, and teaches the next click nothing. One under each real limit, because the dashboard and the user's own shell can spend starts too |

`ensureRunning` reads status with `{ fresh: true }` — deciding "create" from an
eight-second-old `missing` would be a SECOND machine on a two-machine account.
`stop()` drops both the cache and the remembered start, or Stop-then-Wake would
be answered from the cooldown and never actually resume. Opening the Computer
rail still only ever READS; waking is the button and nothing else.
`scripts/box-thrift-test.cjs` pins all of it.

## Standing bans, and why each one is a ban

- **`--no-auto-stop`** — a machine that runs until somebody notices the bill.
  Refused on trial anyway.
- **A `null` TTL** — the documented way to say "auto-stop off". Same problem.
- **`28800`** — eight hours: over the trial ceiling, so it fails the create and
  spends a start doing it.
- **`box prompt`** — runs a *second* agent inside the box, on its own context
  and its own credits, behind the teammate the user is talking to. Two bills,
  and a memory nobody in Hydo can see.
- **A Box MCP wired in as `computer_use`** — that is the screenshot loop by
  another name; see below.
- **A box id on an agent** — fifty bots would be fifty machines against a limit
  of two. The id lives on `settings.boxId`. `agent.boxEnabled` is permission,
  not provisioning.

## Token efficiency: where the money actually goes

The box itself is billed in VM-seconds, which is cheap. What is *not* cheap is
what the box sends back into the model's context. There is exactly one surface
where that happens — a teammate with `terminal` runs `box exec` and the stdout
lands in its context — plus one surface that decides how it behaves: the
`## Shared Linux machine` block in each box-enabled teammate's `AGENTS.md`.

**The screenshot arithmetic.** A 1280x800 PNG is about `(1280 x 800) / 750` =
**~1,365 tokens** per look. The default shape of GUI work is look-click-look, so
a twenty-step login flow is **~27,000 tokens** of images alone, repeated on
every turn it stays in context. That is the single largest avoidable cost the
computer can create, and it is the thing a model reaches for by default.

**What replaces it.** Every box ships `lux` (docs.ascii.dev/box/desktop-streaming):
`lux start "<task>" && lux run` drives Chrome and the desktop **inside the box**
and returns text. The click-and-look loop happens on the far side of the wire.
Estimated: ~27,000 tokens → **a few hundred**, call it a **>95% reduction** on
any graphical task. This is an estimate from the token arithmetic above and the
documented behaviour, not a metered measurement — no box was started.

Note the account cap: 20 lux sessions per day, one at a time per box.

**What the AGENTS.md block now does**, in ~250 tokens per turn (estimated at
~4 chars/token from its 1,294 characters of prose; the surrounding comments are
source, not prompt, and are not billed):

1. Gives the id and the one command shape, with `--timeout` so a hung command
   cannot burn the turn.
2. Says out loud that output is charged to the conversation, and names the
   filters that are already on the box: `rg`, `jq`, `head -c 2000`. `cat`-ing a
   200KB log is ~50,000 tokens; the same answer through `rg` is ~50.
3. Points graphical work at `lux` and **forbids screenshots and screen polling
   by name**, because "do not" beats "prefer" when the alternative is the
   model's default.
4. Uses `~/hydo/<agentId>` rather than an absolute home, because the docs put
   lux's own output under a different one and the home path was never verified.

5. Caps output with a NUMBER — `| head -c 2000` — rather than the advice "keep
   it small", which a model talks itself out of the moment a log looks
   interesting. Estimated: a 200KB log is ~50,000 tokens and re-enters context
   on every later turn of the thread; the same command capped is ~500, and
   filtered through `rg` first is ~50.
6. Puts a **ladder** in front of the pixels: `curl -sL <url> | rg <pattern>`
   first, `lux` only when the page needs a real browser or a login, screenshots
   never. The rung that matters is the first one — a model told to "check a
   page" with no cheaper rung named reaches for a browser, and then for a
   screenshot.
7. Names the lux limits (one session at a time per box, 20/day per account), so
   it reads as a tool to aim once, not one to poll.

Net: **~+125 tokens per turn** on a box-enabled teammate, against **tens of
thousands saved** the first time one of them opens a web page or reads a log.
All the numbers in this section are arithmetic from documented sizes and the
~750-pixels-per-token image rule — **estimates, not meterings**. Nothing here
was measured against a live box; no box was started to write it.

**No polling, anywhere.** `Computer.jsx` refreshes on mount and after an action,
never on a timer. `ensureRunning` funnels concurrent callers through a single
in-flight promise, so fifty teammates asking at once is one start. The idle stop
in `main.cjs` is a check, not a screen watcher.

## Bugs fixed in this pass

| Bug | Cost of leaving it |
|---|---|
| `runJson` parsed only the LAST JSONL line | `box new` ends on a `state` frame → "create returned no id" while a machine is running, billing, counted against a 2-machine limit, with nothing left that knows its id well enough to stop it |
| Global flags appended at the END of argv | Broken the moment anything calls `box exec`/`box ssh`; the flag is handed to the box as part of the command |
| Adoption checked for a remembered *string*, not a live machine | A stale id (deleted box) skipped adoption and created a SECOND machine beside the user's own, on a 2-machine limit |
| Off-trial TTL capped at `Number.MAX_SAFE_INTEGER` | Not a value this API accepts. It only looked fine because the path was dead |
| `limits()` called on the resume path | One wasted API round-trip on the most-walked path; `box resume` keeps the box's own TTL |
| `WANTS_BOX` matched neither "on the box" nor `lux run` | The two plainest ways to ask for the machine did not wake it |
| No `event: "error"` handling | The CLI can exit 0 with an error frame; that read as success |

Each has a test in `scripts/box-runtime-test.cjs`, along with source-level
guards for every ban above and for the four properties the AGENTS.md block must
keep.
