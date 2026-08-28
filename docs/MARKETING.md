# Marketing — where to post, and what to say

Research pass, drafts only. Nothing here has been posted anywhere. Product facts below are
checked against the README at https://github.com/fortun8te/hydo (fetched 2026-08-28); nothing
is claimed that the README doesn't say.

**Confirmed facts used in the drafts:** MIT license, macOS, Electron 42 + React 19 + Vite,
runs turns on Hermes Agent (Nous Research) over its `tui_gateway` JSON-RPC protocol, default
model Grok 4.6, works with any OpenAI-compatible endpoint (llama.cpp, LM Studio, Ollama, vLLM,
Unsloth) for a fully local setup, OpenRouter is a fallback only, roster of named persistent
teammates each with its own Hermes profile/memory/workspace, channels wake members once and
only trigger a second turn if someone is addressed by name (bots reply `SKIP` otherwise),
one shared Linux "box" the whole roster can drive (billed per second, optional, needs the
`box` CLI), routines run on a schedule while the app is open, 119 test suites, no telemetry,
no account required, positioned explicitly as an open alternative to xAI's Grok Bot desktop
client, not affiliated with xAI.

---

## Ranked venues

| Rank | Venue | What it is | Realistic reach | Self-promo rules | Effort | Recommendation |
|---|---|---|---|---|---|---|
| 1 | Hacker News — Show HN | Link-aggregator news site, dev/tech-founder audience | High variance: a flop gets ~10 views, a front-page hit gets 50k–200k visits and hundreds of GitHub stars in a day | Explicitly allowed for things you made yourself; don't game titles, don't solicit votes, keep it a small fraction of your overall use of the site | Low (one post, then you owe it real-time replies for ~4 hrs) | **Post** |
| 2 | r/LocalLLaMA | Reddit's largest local-LLM/open-weight-model community | Large, high-intent audience (hundreds of thousands of subscribers, very active); a well-received post routinely lands thousands of upvotes and real traffic | Self-promotion is tolerated but policed — informal 9:1 rule, must read as a contribution not an ad, disclose you're the author | Low–Medium | **Post** |
| 3 | X / Twitter | General social, but has a real dense cluster of local-LLM / agent-tooling / Nous-Research-adjacent accounts | Depends entirely on existing following; organic reach for a cold account is low, but this is where Nous Research, Hermes users, and the "open Grok Bot" search intent actually live | No formal self-promo rule; just don't spam or use engagement-bait tactics that trip the platform's automation rules | Low | **Post** (as a thread, own account) |
| 4 | GitHub `awesome-*` lists (awesome-local-ai, awesome-local-llm, homebrewltd/awesome-local-ai, etc.) | Curated link lists maintained via PR review | Low direct traffic per list, but compounds — these get cited/crawled and linked from other roundups indefinitely | Explicitly built for exactly this — submit via PR, follow each list's contribution format and alphabetical/category placement | Low (a PR each) | **Post** (PRs, not posts — safe, no ban risk) |
| 5 | Product Hunt | Daily-launch product directory | Moderate — open-source dev tools rarely crack top 5, but it's a legitimate discovery surface and doesn't cost reputation to try | Self-hunting (launching your own product) is normal and about 60% of #1 products are self-hunted; just don't buy votes or coordinate vote rings | Medium (needs a maker account, images, a launch-day availability window) | **Post**, low priority |
| 6 | Nous Research Discord (community-projects-showcase channel) | Official Discord for Nous Research / Hermes Agent, where community builders post what they've made with Hermes | Small but extremely high-relevance — this audience already runs Hermes and already understands the `tui_gateway` protocol Hydo depends on | Explicitly a showcase channel for exactly this kind of post; no ban risk, but it's a small room, don't over-post | Low | **Post** |
| 7 | Moltbook | An AI-agent-only forum/social feed (agents post, comment, and vote; humans can only view unless they authenticate an agent via a claim-tweet flow and let it post through the API); acquired by Meta in March 2026; had a serious API-key exposure incident (1.5M keys) reported by Wiz in early 2026 | Real scale on paper — millions of registered agents — but the audience is other LLM agents, not the humans who install macOS apps and file GitHub stars. Reach for actual product adoption is close to zero | No rule against a project being *discussed* by an agent that happens to reference it, but there's no human "post your project" workflow — you'd have to run an agent whose whole job is astroturfing your own launch | Medium-high (build/run an agent just to post) for near-zero payoff | **Skip** — see note below |
| 8 | Chirper.ai | X/Twitter-style feed entirely populated by ~65k LLM "Chirper" personas with no human posting or curation once a persona is spun up | It's a research subject (multiple arXiv papers study it) more than a live community; there is no human distribution path off the platform | No promotion mechanism exists — you'd spin up a persona and it would post into a closed loop other Chirpers read, not people | High for zero human reach | **Skip** |
| 9 | Discord / forums for local-LLM tooling (LM Studio Discord, Ollama Discord, r/LocalLLM, r/selfhosted) | General local-inference and self-hosting communities | Medium — decent overlap audience (people running Ollama/LM Studio are the exact "point it at your own endpoint" users) but most of these servers restrict self-promo to a `#self-promo` or `#showcase` channel only | Varies by server; almost all forbid promotion outside the designated channel, some require a minimum message count first | Low | **Needs care** — post only in the designated channel, read each server's rules first, don't post cold |
| 10 | r/electronjs, r/reactjs, r/opensource | General framework/open-source subreddits | Low-medium, and off-target — these audiences care about the framework, not about local-LLM agent tooling | Both restrict self-promo heavily (r/opensource in particular wants "Sunday self-promo thread" only in many similar subs) | Low | **Skip** — wrong audience for the "local AI agent" pitch, high rejection risk for low payoff |

---

## Are the agent-native platforms (Moltbook, Chirper.ai) worth it?

**Honest answer: no, not as marketing channels, and inflating them would be dishonest.**

Moltbook is real and large by registration count (millions of claimed agents), and it is a
genuinely interesting phenomenon — Meta thought it worth acquiring in March 2026, largely for
its verified-agent-identity registry rather than for its content. But its entire posting and
voting population is other AI agents, authenticated through a human's claim-tweet, and its
reading population is humans who are there to *observe* agent behavior as a curiosity, not to
evaluate macOS developer tools. There is no path from "an agent posts about Hydo on Moltbook"
to "a human downloads Hydo" — the humans present aren't shopping for software, they're watching
the zoo. It also had a serious credential-exposure incident reported by Wiz (roughly 1.5M
agent API keys leaked), which is one more reason not to wire any of Hydo's own credentials or
a general-purpose agent into posting there. If you want to observe it or use it as a curiosity
piece in a blog post about "what agent-native social even looks like," that's a legitimate,
separate use — but it is not a distribution channel for this launch, and no draft for it is
included below.

Chirper.ai is smaller and effectively a closed research artifact at this point: ~65k
autonomous personas talking to each other with no human curation and no mechanism for a human
to inject a promotional post at all. It shows up almost exclusively in arXiv papers studying
LLM social dynamics, not in any go-to-market conversation. Skip it entirely.

If a genuinely agent-native platform with real human reach and clear self-promo rules turns up
later, it's worth revisiting — but neither of these two clears that bar today.

---

## Drafts

### Hacker News — Show HN

Title:
```
Show HN: Hydo – an open, self-hostable Grok Bot (Electron, runs on Hermes Agent)
```

Body:
```
Grok Bot's desktop client had a good idea: not one chat window, but a roster of named
bots with their own memory that keep working while you do something else. Hydo is that
idea, open source (MIT), running on your own machine instead of xAI's servers.

Each teammate is its own Hermes Agent (Nous Research) profile — its own memory, its own
workspace on disk, its own tools, its own animated face. You talk to them in threads,
they talk to each other in channels, and they can run on a schedule while the app is
open. Default model is Grok 4.6, but any OpenAI-compatible endpoint works — llama.cpp,
LM Studio, Ollama, vLLM — so the whole thing can run fully local if you point it there.

A few things that took actual engineering, not just UI:

- Channels wake every member once, concurrently. A member with nothing to add replies
  SKIP and that's the whole cost — six quiet teammates cost six turns, not eighteen.
- There's one shared Linux machine ("the box") the whole roster can drive — files,
  installed software, and browser logins persist on it, billed per second, stopped when
  idle. A teammate that logs into something once leaves it logged in for the next one.
- It tells you honestly whether your local endpoint is actually answering before it
  sends anything to it, because a local server that's off looks exactly like a broken
  model otherwise.

Electron 42 + React 19 + Vite, ~50k lines, 119 test suites, no telemetry, no account.
Turns run over Hermes Agent's tui_gateway JSON-RPC protocol; the wiring is documented in
docs/HERMES-GATEWAY.md if anyone wants to see how that works.

Requires macOS and Hermes Agent installed locally. Repo + install instructions:
https://github.com/fortun8te/hydo

Happy to answer questions about the Hermes integration, the channel wake model, or the
local-model setup.
```

---

### r/LocalLLaMA

Title:
```
Built an open-source, self-hosted alternative to Grok Bot's desktop client — runs on Hermes Agent, works fully local
```

Body:
```
Grok Bot's desktop app has a roster of named bots with persistent memory and a shared
computer they can all drive. I liked the shape of it and didn't like that it's closed
and cloud-only, so I built Hydo — same idea, MIT-licensed, running on Hermes Agent
(Nous Research) instead of xAI's backend.

Relevant to this sub specifically: each teammate is its own Hermes profile, and you can
point any of them at any OpenAI-compatible endpoint — llama.cpp, LM Studio, Ollama, vLLM,
Unsloth — per teammate, switchable at runtime. Default is Grok 4.6 through Hermes/OpenRouter,
but nothing about the architecture requires a hosted model. There's a doc
(docs/LOCAL-MODEL.md in the repo) that goes through the actual wiring and what it costs
on real hardware, not marketing numbers.

Other things that might matter to people here:
- No telemetry, no account, MIT license.
- Each teammate is a fully isolated Hermes profile — separate memory, separate MCP
  servers, separate workspace on disk.
- Channels only cost a turn from members actually being addressed; idle members reply
  SKIP instead of burning a full generation every time someone else talks.
- An optional shared Linux box the roster can use as a common machine (files, logins,
  installed tools persist across teammates) — this is billed per second and entirely
  optional, not required to run the app.

Requires macOS and Hermes Agent installed (~/.hermes/hermes-agent). 119 test suites,
Electron 42 + React 19. Repo: https://github.com/fortun8te/hydo

I'm the author — posting this here because the local-model wiring is the part I'd
actually want feedback on, especially from anyone running vLLM or llama.cpp as a daily
driver for agent workloads.
```

---

### X / Twitter thread

```
1/ Grok Bot's desktop client had the right idea: not one chat window, a roster of named
bots with memory that keep working while you don't watch them.

Hydo is that idea, open source, running on your own machine instead of xAI's servers.

github.com/fortun8te/hydo

2/ Each teammate is its own Hermes Agent (Nous Research) profile — own memory, own
workspace on disk, own tools, own face. They talk to you in threads and to each other
in channels.

3/ Default model is Grok 4.6, but point any teammate at llama.cpp, LM Studio, Ollama, or
vLLM instead and it runs fully local. Switchable per teammate, per session.

4/ Channels wake every member once. A teammate with nothing to say replies SKIP — that's
the whole cost. Six quiet teammates cost six turns, not eighteen.

5/ One shared Linux box the whole roster can drive if you want it — files, logins,
installed tools persist across teammates. Billed per second, optional, off by default.

6/ MIT license, no telemetry, no account, Electron 42 + React 19, 119 test suites.
Not affiliated with xAI — inspired by the shape of Grok Bot, built on Hermes Agent.

github.com/fortun8te/hydo
```

---

### Nous Research Discord — #community-projects-showcase

```
Built something on top of Hermes Agent I wanted to share here: Hydo, an open-source
desktop app (MIT, macOS) that gives Hermes a roster instead of one profile — named
teammates, each its own Hermes session with its own memory/workspace/tools, talking to
each other in channels and running routines on a schedule.

It's positioned as an open alternative to xAI's Grok Bot client — same "roster of bots +
shared computer" shape, but running on Hermes and whatever model you point it at (Grok
4.6 by default through Hermes/OpenRouter, or a local OpenAI-compatible endpoint per
teammate).

Turns run over tui_gateway — wiring is in electron/hermes-gateway.cjs and
docs/HERMES-GATEWAY.md if anyone's curious how that integration works or wants to poke
at it. 119 test suites, no telemetry.

github.com/fortun8te/hydo

Would genuinely like eyes from people who know the gateway protocol better than I do —
particularly interested if there's a cleaner way to handle the channel wake/SKIP pattern
than what I've got now.
```

---

### GitHub awesome-list PR entry (generic — adapt per list's format)

```
- [Hydo](https://github.com/fortun8te/hydo) - Open-source (MIT) macOS desktop app giving
  you a roster of persistent AI teammates on Hermes Agent, each with its own memory,
  workspace, and tools; supports fully local models via any OpenAI-compatible endpoint
  (llama.cpp, LM Studio, Ollama, vLLM).
```

PR description:
```
Adding Hydo, an open-source (MIT) macOS app that runs a roster of persistent AI
teammates on Hermes Agent (Nous Research). Any teammate can be pointed at a local
OpenAI-compatible endpoint (llama.cpp, LM Studio, Ollama, vLLM) instead of a hosted
model, which seemed relevant to this list. Happy to adjust category/wording to match
the list's conventions.
```

---

### Product Hunt

Tagline:
```
An open, self-hosted Grok Bot — teammates, not tabs
```

Description:
```
Hydo is an open-source (MIT) macOS app that gives you a roster of persistent AI
teammates instead of a single chat window. Each one has its own memory, its own
workspace on disk, its own tools, and its own animated face. They talk to you in
threads and to each other in channels, and they can run on a schedule while you're not
watching.

It's modeled on the shape of xAI's Grok Bot desktop client — a roster + a shared
computer — but it runs on Hermes Agent (Nous Research) instead of a closed backend, and
you choose the model: Grok 4.6 by default, or point any teammate at your own
OpenAI-compatible endpoint (llama.cpp, LM Studio, Ollama, vLLM) and keep it fully local.

No telemetry, no account required, MIT licensed, 119 test suites.

Requires macOS and Hermes Agent installed locally.
```

First comment (maker):
```
Hey — maker here. Built this because I wanted the "roster of bots that keep working"
idea from Grok Bot without the closed backend. It's genuinely just a shell around
Hermes Agent — Hydo owns the roster, the channels, and the shared machine; Hermes owns
the actual agent turn. Happy to answer anything about the local-model setup or the
Hermes integration.
```
