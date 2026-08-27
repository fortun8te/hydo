# Routines and a machine that is off

The short version: **a routine cannot fire while the Mac is off**, and no amount
of Hydo code changes that. What can change is how little you lose.

This file records what was actually checked, because the answer is unintuitive
and the wrong version of it is easy to believe.

---

## Why nothing runs

Three candidates, all of them local or asleep:

| | Where it runs | While the Mac is off |
|---|---|---|
| Hydo's 15s poll | this Mac | not running |
| Hermes' cron (`cron.manage`) | `~/.hermes/hermes-agent`, this Mac | not running |
| The Ascii box | a Linux VM in Hetzner | **stopped**, and a stopped box cannot start itself |

The box is the one that looks like it should work, and it is the one worth being
precise about. It is stopped whenever it is idle, which is exactly why it is
affordable — a stopped box is free and keeps its disk. Verified against the
vendor docs (`/box/long-running-tasks`): there is no cron, no scheduled start,
and no way for a stopped box to wake itself. Keeping one up around the clock
means disabling auto-stop, which needs `ttlSeconds: null`, which needs a payment
method and **is not available on the trial**.

So there is no always-on host in this architecture. Anything that claims a
routine "ran overnight" while the Mac was off would be lying.

---

## What Hydo does instead: catch-up

A routine whose time passed while the app was closed comes due the moment it is
back — **once**, however long the outage, with a paused routine still paused and
a future routine not dragged forward. Three days away is one run, not
seventy-two.

That is not a comment, it is `scripts/routine-offline-test.cjs`, which drives the
real store.

---

## Closing the gap, in order of how much it costs you

### 1. Sleep instead of shutting down (free, and it is the real answer)

A sleeping Mac is not an off Mac. macOS can wake on a schedule, and this machine
supports it — `pmset -g cap` lists `womp`, `standby` and `powernap`, and
`pmset -g sched` already shows the system's own wake events.

Wake a few minutes before the routine is due and let Hydo's catch-up do the rest:

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 06:55:00
```

`wakeorpoweron` wakes from sleep, and starts the Mac from a full shutdown when
it is on mains power. It needs an admin password, which is why it is a command
for you to run rather than something Hydo does to your system. `sudo pmset
repeat cancel` undoes it.

Caveats worth knowing before you rely on it: waking from **sleep** is reliable;
powering on from a full **shutdown** is less so on laptops, and Hydo has to
actually launch — so it wants "Open at Login" set.

### 2. A LaunchAgent (free, not yet built)

`~/Library/LaunchAgents` needs no admin rights, and launchd runs a missed
`StartCalendarInterval` job when the machine wakes. That would make routines
catch up even when Hydo was never opened, rather than only when you open it.

Not implemented. It installs a persistent piece of system configuration, which
is your call to make, not something to switch on quietly. Say the word.

### 3. Pay for a box that never stops (~$20/mo, plus running time)

After the first payment, `ttlSeconds: null` becomes available and a box can stay
up permanently, at which point a real cron on the box fires whether the Mac
exists or not. This is the only option that genuinely runs work at 07:00 on a
machine that is switched off.

It is also the only one that bills you for 24 hours a day of a VM to do a job
that takes ninety seconds.

---

## Verified vs. read

**Run here:** `pmset -g sched`, `-g cap`, `-g ps` on this Mac; the catch-up
behaviour, via the test above; the box's stopped state and the account's trial
limits, via the live CLI.

**Read, not run:** that launchd fires missed calendar jobs on wake (Apple's
documented behaviour — testing it needs a real sleep cycle), and the vendor's
statement that auto-stop cannot be disabled on trial.
