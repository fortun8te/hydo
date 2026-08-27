# The shared computer, and what it actually costs

Everything here was checked against the installed CLI (`box 0.1.184-ascii-prod1`
at `~/.ascii/bin/box`) and the live account on 2026-08-27, or against
`docs.ascii.dev`. Nothing in this file is assumed. No box was ever created, forked or deleted to
write it. Every call was read-only **except** the section "Minutes and starts",
which resumed and stopped the existing box to measure it and says so, in full,
including what it cost.

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
- `box resume --ttl` is optional and "Omit to keep the Box's current setting" —
  which is why Hydo now always sends it. See "Minutes and starts" below: the
  setting it would keep is unobservable and unbounded.
- `box resume --type` can change the machine size on a resume, at no extra start.
- `box stop` returns as soon as the API accepts it; the machine keeps billing
  through its `stopping` tail.
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

## Minutes and starts: what a nap actually costs

Everything above this line was read-only. **This section is not** — it was
measured by resuming and stopping `bx_843rh875` on 2026-08-27. Exactly what was
run, and what it cost: `box resume --ttl 1800`, `box stop`, `box resume`,
`box stop`, plus `box exec` polls and `box info` reads. **Two starts** (the
account went from 6 to 8 used of 75 for the day) and **under three minutes**
of awake time. The box was left stopped, as it was found.

| Measured | Value |
|---|---|
| `box stop` — the API call | **0.22s**. It returns `{"status":"stopping"}` and does **not** wait for the machine |
| `stopping` → `stopped` | **~9s**, polled at 3s intervals. Those seconds are awake, so they bill |
| `box resume` → `ready` frame | **0.28s** |
| `box resume` → first `box exec` that succeeds | **5.9s** total. `ready` is not usable |
| One sleep-and-wake cycle | **~15 billed seconds + 1 start** |
| `box info --json` ttl / autoStop field | **There is none.** `archiveAfter` is the archive deadline (measured at lastSnapshot + 1h, moves with the snapshot, not with the TTL) |
| `box resume --ttl 1800` | Accepted, returned `ready`. Costs no extra round-trip and no extra start |
| The box's disk | 22.9 GB used of 70 GB (`/dev/vda1`), `/home` only 887 MB — the rest is the base image, desktop and Chrome |
| The box's memory in use | 1.4 GB of 7.9 GB, 4.7 GB in cache |

### The break-even, and why it does not set the idle window

On a `default` (1x) box an idle second costs one billed second. A nap costs ~15.
So **the seconds break-even is about fifteen seconds** — anything quieter than
that is already cheaper asleep. `IDLE_STOP_MS` was **ten minutes**: 600 billed
seconds burnt every time the desk goes quiet, to dodge a 15-second cycle. Forty
times past break-even.

Seconds are not the binding constraint. **Starts are.** The trial allows 25/hour
and 75/day, and `START_WINDOWS` spends at most 24/hour and 70/day. A window of
*T* minutes costs at most 60/*T* wakes an hour in the pathological
alternate-work-and-idle case, so *T* ≥ 60/24 = **2.5 minutes** or the sweep alone
can exhaust the budget a real job later needs.

Hence **`IDLE_STOP_MS` is now 3 minutes**, and it **widens as the budget drains**
(`idleStopMs()`): 3 min while under half the day's starts are spent, 10 min past
half, **30 min past 80%**. A start refused at 6pm is a teammate that cannot work
— sleeping is an optimisation, being unable to wake is an outage. Even the widest
rung is 4x tighter than the trial's 2-hour auto-stop ceiling. The sweep in
`main.cjs` ticks every **30s** rather than 60s, because a 60s tick against a
3-minute window spends up to a third of the window billing past the decision.

Against the old 10-minute window that is **420 billed seconds saved per idle
stretch**, at a cost of one start and ~15 seconds — but only for gaps that fall
between 3 and 10 minutes. Longer gaps were already being stopped and cost
nothing extra.

### The TTL was an unknown number, and now is not

`box resume --ttl` is documented "Omit to keep the Box's current setting", and
this code omitted it. That sounds thrifty and was the most expensive line in the
file:

- The setting it keeps is whatever the box was **created** with, and
  `bx_843rh875` was created by hand, not by Hydo.
- It is **not observable**: `box info --json` was read field by field and carries
  no ttl and no autoStop.
- It is the **only** backstop left when the Mac is force-quit, crashes, or loses
  power, because nothing local runs then.

So the server-side stop was an unknown number somewhere up to the trial's 2-hour
ceiling. Every resume now asserts `--ttl 1800`, clamped through `ttlFor` to the
trial ceiling without a `limits` round-trip (1800 is under both ceilings, so
buying the right to send a bigger number is not worth a call on the hot path).
It rides a resume that was happening anyway: **no extra round-trip, no extra
start.**

1800 is kept rather than shortened. TTL is wall-clock lifetime, not idle time,
and the `AGENTS.md` block caps a command at `--timeout 120` — so 30 minutes is
15x the longest job the teammates are told to run, and the app's own sweep stops
the box long before it in the normal case.

### `stopping` is not `stopped`

Measured above: the box sits in `stopping` for ~9s. Folding that into "stopped"
made the app offer Wake on a machine already on its way down, and `ensureRunning`
would spend one of 75 daily starts resuming something about to finish stopping
anyway — the start **and** the seconds. `status()` now reports `stopping` as its
own state and `ensureRunning` waits it out (locally, no API polling) rather than
racing it.

### The single most expensive bug: quitting did not stop the machine

The idle sweep only runs while Hydo is open. Two exit paths left the box awake:

| Path | What it did | Cost |
|---|---|---|
| `before-quit` | `boxes.stop({ force: true }).catch(() => {})` — fired, **never awaited**, immediately followed by `app.exit(0)` down the `will-quit` path | Whether the request reached the wire was luck |
| `SIGINT`/`SIGTERM`/`SIGHUP` | `app.exit(0)` with **no box stop at all** | `npm run relaunch` sends SIGTERM. Every dev restart left a machine billing, with nothing on this Mac that knew how to stop it |

Both now go through one memoised `stopBoxOnExit()` in `main.cjs`, bounded by
`QUIT_STOP_BUDGET_MS = 2000` — **9x the measured 0.22s call**, and a
`Promise.race`, never a bare await. The signal path exits on a hard timer as
well, because a signal is not a request that can be declined. A hung `box` binary
must lose the app's quit, not win it; the existing 2.5s gateway-shutdown race is
untouched and now runs alongside this one.

A laptop closed on Friday with the box awake was previously billing until the
box's own unknown TTL fired. Both halves of that — the missing stop and the
unknown TTL — are fixed in this pass.

### Machine size: `small` is a resume away, and it is the user's call

Reported, not acted on. `box resume --type` exists (`--help`, verified): "Resume
onto a different machine size: small, default or large. Omit to keep the box's
current size. Shrinking is refused if the box's data does not fit." So switching
rides a resume that was happening anyway — **zero extra starts, zero extra
seconds** — and `small` is **0.5x**, which halves every billed second forever.
That is a bigger multiplier than any timer in this file.

Why it is not done automatically:

- `small` is 2 vCPU / 4 GB against the current 4 vCPU / 8 GB. Measured on the box:
  1.4 GB in use with 4.7 GB of cache. A shell would be fine; Chrome plus the lux
  desktop on 4 GB is the thing that would break, and that is the box's main job.
- The disk is 22.9 GB used. `--help` documents the vCPU and RAM of each size but
  **not the disk**, and shrinking is refused if the data does not fit — which is
  a failed resume that still spends a start.
- It is a one-line change to `DEFAULT_TYPE`/the resume args if the user wants it,
  and it is reversible on the next resume for the same zero cost.

Note that `DEFAULT_TYPE` is already `small` — Hydo *creates* small. The `default`
box on this account is the one the user made by hand, which Hydo adopted.

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

---

## Browsing: what the box side actually costs, measured

**This section is not read-only.** It was measured on 2026-08-27 by resuming
`bx_843rh875`, running `box exec` against it, and stopping it again. Cost:
**two starts** and **~4 minutes** of awake time. Nothing was installed. The box
was left stopped, as it was found.

The baseline to beat: a teammate on the local model fetched `https://example.com`
through one `box exec` and read its `<h1>` — **109 seconds**, one tool call. The
box side of that is 1.4 seconds. Everything else is the model at ~31 tok/s.
**That is the shape of the whole problem: the machine is not slow, the turn is.**
So every lever below is a lever on TURNS and on TOKENS, not on VM seconds.

### The wire is cheap. A second call is not

| Measured (n=3) | Value |
|---|---|
| One `box exec` end to end, warm | **0.45s** (0.96s / 0.43s / 0.41s; the first pays a connection) |
| Three separate `box exec`s | **1.50s** |
| The same three chained into one exec | **0.59s** |
| One `curl … \| html2text … \| head -c 300`, warm | **1.35s** (1.47 / 1.35 / 1.24) |

So batching saves ~0.9s of wire per three commands, which on its own is not
worth a sentence in a prompt that is taxed every turn. It is worth it for the
other half: a second `box exec` is a second whole TURN — the model re-reads the
thread and writes another command at 31 tok/s. Against a 109-second first turn,
the wire is a rounding error and the turn is the bill. Hence the block's line:
**one errand, one command, chained with `;`**.

### `head -c 2000` of HTML buys almost no answer. Of text it buys 13x more

`html2text` is **already installed** at `/usr/bin/html2text`. `lynx`, `w3m`,
`pandoc`, `links` and `elinks` are not; `python3`, `node`, `rg`, `jq`, `curl`
and `google-chrome` are. Nothing was added to the disk to make any of this work.

| Page | Raw HTML | Text (`html2text -utf8 \| awk NF`) |
|---|---|---|
| `example.com` | 559 B | **142 B** |
| `en.wikipedia.org/wiki/Ubuntu` | 1,036,632 B | **109,543 B** (extracted in 0.10s) |
| `news.ycombinator.com` | 34,597 B | 20 KB-ish |

Byte counts are the boring half. The sharp number is what fits under the SAME
`head -c 2000` cap the block already mandates, on the Hacker News front page:

- raw HTML — **1 story**
- `html2text` — **13 stories**, each with title, domain, points and comment count

Thirteen times the answer for the identical token spend. And on `example.com`
the entire useful page is 142 bytes of text, against 559 bytes of markup — the
exact 109-second baseline task, at a quarter of the tokens. Extraction happens
**on the box**, before the bytes cross the wire, which is the only place it can
save anything.

`awk NF` rather than a `grep -v` blank-line filter: html2text emits long runs of
blank lines (24 of them before the first word of a Wikipedia page), and `awk NF`
drops them in six characters with no quoting to get wrong inside a prompt.

### A rung between `curl` and `lux`, that costs no lux session

`lux --help` was read on the box. There is no cheap mode and no session reuse:
`lux start "<task>"`, `lux run [--max-steps N]`, `lux status`. `lux status`
reports the ration — **20 sessions/day, 50 steps/session**, today 0/20 — and
reading it spends nothing. `--max-steps` is the only dial, and it is worth
using: one confused session can eat 50 steps of a 20-session day.

Twenty a day for a whole team is tight, and `curl` cannot run JavaScript. The
gap between them is filled by something already on the disk:

```bash
google-chrome --headless --no-sandbox --user-data-dir=$(mktemp -d) \
  --dump-dom <url> | html2text -utf8 | awk NF | head -c 1500
```

Measured: **~2.1s** for the Hacker News front page, **~3s** each for
`docs.ascii.dev` and `vitejs.dev`. It renders JavaScript, returns text, spends
**zero lux sessions** and takes **zero screenshots**.

**One trap, and it is a silent one.** Reuse a `--user-data-dir` and Chrome exits
**0 with empty stdout** — measured three URLs in a row returning `0` bytes after
an earlier run had left a lock in the same directory. That reads exactly like
"the page is empty", which is the worst failure mode there is. `$(mktemp -d)`
every time. It is also why the throwaway profile is right anyway: the persistent
Chrome profile on this box holds the team's logins, and a headless process must
not fight the desktop one for it.

So the ladder in `AGENTS.md` now has four rungs instead of three:

1. `curl -sL <url> | html2text -utf8 | awk NF | rg -m5 -C2 <pattern> | head -c 1500`
2. `google-chrome --headless … --dump-dom` when the page needs JavaScript
3. `lux start "<goal>" && lux run --max-steps 15` when it needs a login or real clicking
4. screenshots — still never

### `box exec` does NOT wake a sleeping box

Measured, and the old prompt said the opposite. Against a stopped box, `box exec`
returns in **0.18s** with `{"code":"machine_not_running","status":409}`. It does
not resume, it does not queue. The AGENTS.md line "It sleeps when idle; a command
wakes it" was therefore false, and the cost of that falsehood is a confused model
spending a whole turn — tens of seconds at 31 tok/s — working out what to do with
a 409. It now names the error and the one-line recovery.

### The 5.9s wake was being spent before the model was allowed to think

`streamThroughHermes` awaited `box.ensureRunning()` inline whenever `wantsBox()`
matched, so the measured **5.9s cold-to-usable** (`resume` returns at 0.28s; the
first `box exec` that answers is 5.9s later) was serial, in front of the first
token. The model needs far longer than 5.9s to reason its way to a first command,
so the wake now runs **alongside** the turn and falls out of the wall clock.

The `finally` awaits the wake promise before releasing the hold. Without that,
a turn that ends quickly releases a hold that has not been taken yet, and the
hold lands afterwards on a machine nothing will ever stop — the one direction
this file exists to never be wrong in.

Cold end to end, resume included, on the recommended one-liner: **8.35s** to a
correct answer (that figure includes a tight retry loop hammering the box while
it booted). Warm: **1.35s**.

### What is NOT done, and why

- **Pre-warming on a pasted URL.** `WANTS_BOX` does not match "check
  news.ycombinator.com", so a browsing turn typically finds the box asleep and
  pays the resume itself. Adding `https?://` to the pattern would overlap the
  wake with the model's thinking. It is not done because **starts are the binding
  constraint** (75/day), not seconds, and a URL in a sentence is not proof the
  teammate is about to browse. The recovery line in the prompt costs one start
  only when the box is genuinely needed.
- **Installing anything.** The disk is the user's and it is shared. Everything
  above uses binaries that were already there.

---

## The disk really does persist, including browser logins

Tested, not assumed. Planted a marker inside Chrome's own profile directory
(`~/.config/google-chrome/Default/`), stopped the box, waited for
`lastSnapshotStatus: completed`, resumed, and read it back:

```
cookie-persist-1787844338
```

Intact. The box is a single ext4 root on `/dev/sda1` with no separate mounts
under `/home`, so the snapshot takes the whole disk — a Chrome profile, and the
cookies and sessions in it, is just more of that disk. A teammate that signs
into something once leaves it signed in for the next one, across sleeps.

Resume returns in ~0.3s, but the machine is NOT usable that fast: the first
`box exec` afterwards can come back empty while it finishes booting. Timed on
2026-08-27, cold: `ready` at 0.28s, first successful `box exec` at **5.9s**. Poll
for real output rather than trusting the resume call's own timing.

---

## `box exec` quoting: a false-negative that cost two wrong conclusions

This bit twice in one session, and both times the wrong conclusion was reached
first — once accusing a teammate of inventing a file it had genuinely written.

```
# LIES. Returns empty stdout for a file that exists and has content.
box exec <id> -- bash -lc 'cat ~/file.txt 2>/dev/null'

# TRUTH.
box exec <id> -- cat /home/user/file.txt
```

The wrapped `bash -lc` form with a redirect can swallow stdout through the RPC
while still reporting `exitCode: 0`. Absence of output from that form is NOT
evidence of absence of the file. Prefer the direct argv form with an absolute
path, and confirm with `ls -la` before concluding anything is missing.
