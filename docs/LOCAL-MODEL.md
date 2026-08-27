# Running teammates on your own hardware

Hydo can point a teammate at any OpenAI-compatible endpoint — an Unsloth server,
LM Studio, Ollama, anything that speaks `/v1/chat/completions`. This file
records what was tested, and the one thing that does not work as written.

---

## The address you were given will not work, and it is not a bug

```
http://127.0.0.1:8888/v1
```

`127.0.0.1` means **this machine**. The Unsloth server runs on the PC; Hydo runs
on the Mac. From the Mac, that address is the Mac.

Verified rather than assumed: on this Mac, port 8888 is answering — and it is
**SearXNG in Docker**, not a model. Pointing a teammate at it would have failed
in a way that looks like the model is broken.

Three things to change on the PC:

1. **Bind the server to `0.0.0.0`, not `127.0.0.1`.** Bound to loopback it
   refuses every connection that is not from the PC itself, no matter what the
   firewall says.
2. **Use the PC's LAN address**, e.g. `http://192.168.1.42:8888/v1`. On the PC,
   `ipconfig` shows it as the IPv4 Address on your active adapter.
3. **Let port 8888 through Windows Firewall** for the Private network profile.

Then, from the Mac, this must answer before anything else is worth trying:

```bash
curl -H "Authorization: Bearer sk-unsloth-…" http://<PC-LAN-IP>:8888/v1/models
```

A hang means the firewall; `connection refused` means it is still bound to
loopback.

---

## Where it goes once it answers

`~/.hermes/config.yaml`, in the `providers:` block. The entry is already there
with the host to replace:

```yaml
providers:
  unsloth:
    api: http://REPLACE-WITH-PC-LAN-IP:8888/v1
    api_key: sk-unsloth-…
    default_model: unsloth/Qwen3.8-Flash-Next-GGUF
    name: unsloth
    transport: chat_completions
```

`transport: chat_completions` is the "OpenAI-compatible / Custom OpenAI" choice
your notes mention — not "OpenAI" proper, which would phone home.

---

## The bug that would have made this silently do nothing

Hydo runs every teammate in **its own** Hermes profile at
`~/.hermes/profiles/hydo<id>/`, and mirrors an ALLOWLIST of config blocks into
it. `providers` was not on that list.

A session picks a provider **by name**. A profile without the block has not
merely lost a default — it has never heard of the name the session is asking
for, and the turn dies at agent init. So the endpoint would have been configured
correctly, in the right file, and reached no teammate at all.

This is the same shape as the `mcp_servers` bug this project already hit once:
set up in the launch home, every teammate running somewhere else, the feature
doing nothing for anybody while looking entirely configured.

`providers` and `fallback_providers` are mirrored now.

---

## Proven, end to end

Not reasoned about. A stub OpenAI-compatible server was run on `127.0.0.1:8899`
enforcing the API key exactly as Unsloth does (401 without it), registered as a
provider, and a real Hydo teammate was pointed at it:

```
providers block mirrored: true
api url mirrored        : http://127.0.0.1:8899/v1
reply from the custom endpoint: "STUB_ANSWER_OK"
```

So the whole chain works: launch config → per-bot profile → session picks the
provider by name → Hermes streams from it → the reply reaches the app.

**One thing that will bite you.** Hermes requests a **stream**. The first
attempt returned a plain JSON body and Hermes reported:

> Provider returned an empty stream with no finish_reason

That reads like a broken endpoint and is not. If Unsloth is ever started in a
non-streaming mode, this is the error you will see.

---

## Verified vs read

**Run here:** port 8888 on this Mac is SearXNG; the stub round trip above; the
`providers` mirror reaching a real profile at
`~/.hermes/profiles/hydolocalmodelprobe/config.yaml`.

**Not run:** the real Unsloth server, which is on the PC and unreachable from
this Mac until it is bound to `0.0.0.0`. Everything above the address is
independent of which server answers.

---

## A local model CAN use the shared Linux box

This was the open question, and it is not obvious: reaching an endpoint proves
nothing about whether that endpoint gets *tools*. If the `chat_completions`
transport did not carry them, a local model could chat and nothing else — no
terminal, no box, no work.

Tested with a stub that behaves like a tool-using model: it logs what the
request contained, emits a `tool_call`, and answers only after it sees the
tool's result come back.

```
{"turn":1,"toolCount":0, "hasTerminal":false,"sawToolResult":false}
{"turn":2,"toolCount":29,"hasTerminal":true, "sawToolResult":false}
{"turn":3,"toolCount":29,"hasTerminal":true, "sawToolResult":true}
```

Turn 2 carried **29 tools including `terminal`** to a custom provider. The stub
asked to run `echo HYDO_TOOLPROOF`; Hermes executed it, fed the result back, and
the model closed with `TOOLS_WORK: I ran it and saw HYDO_TOOLPROOF`. Hydo's own
`onTool` saw three `terminal` calls.

`terminal` is the tool that runs `box exec`, so a local model on the **builder**
profile can drive the shared machine exactly as a hosted one does.

The remaining variable is the model, not the plumbing: it has to be able to emit
`tool_calls` at all. Qwen3-class GGUFs generally can. A model that cannot will
chat happily and never touch the box — and the symptom is a teammate that
describes what it would do rather than doing it.

Turn 1 carries no tools; that is a short internal call, not a fault.

---

## Switching to it, and back

Settings → General now carries an **Own hardware** row directly under Chat
model. It is a two-segment switch — the hosted model on the left, your endpoint
on the right — so the flip is one click either way, and the hosted pick is
remembered so coming back lands on the same model you left.

Beside it is the honest part: Hydo probes `GET <api>/models` with the provider's
key when the dialog opens and reports what actually happened, before you send a
message and get a failure that looks like a broken model.

| what you see | what it means |
| --- | --- |
| **Reachable** | the endpoint answered a model listing |
| **Not set up** (amber) | the `api` is still `REPLACE-WITH-PC-LAN-IP` — the switch is disabled until you fix it, per the top of this file |
| **Offline** | nothing answered: server down, bound to loopback, or the firewall |
| **Key rejected** | it answered and refused the `api_key` |

`Not set up` is deliberately not the same word as `Offline`: nothing was ever
dialled, and sending someone to debug a Windows firewall over a string that is
not an address is the failure this row exists to prevent.

The probe runs in the main process (`electron/local-providers.cjs`). The
`api_key` is read there, sent as a bearer, and dropped — it never crosses IPC
into the renderer and never appears in a status line.

With more than one provider in the block, a **Local endpoint** row picks which
machine the switch points at. Changing it does not change the model you are
running unless you were already on a local one.

---

## Running at 15 tokens a second

### The rate, measured

Three requests to `http://100.74.135.83:8888/v1/chat/completions` on the user's
own box, `unsloth/Qwen3.8-Flash-Next-GGUF` (UD-IQ4_XS):

| what | completion tokens | wall clock | rate |
| --- | --- | --- | --- |
| count 1–60 | 214 | 13.42s | **15.9 tok/s** |
| three-sentence answer | 152 | 9.39s | **16.2 tok/s** |
| count 1–60, thinking off | 171 | 3.82s | 44.8 tok/s |

So ~16 tok/s with thinking on, and that is the number every deadline below is
quoted against. A 2,000-token answer takes **125 seconds**.

The third row is the interesting one and is discussed under *reasoning effort*.

### What actually breaks at that rate — and what does not

Read out of `~/.hermes/hermes-agent` rather than guessed:

| deadline | value | verdict at 16 tok/s |
| --- | --- | --- |
| httpx stream read (`chat_completion_helpers.py`) | 120s cloud, **1800s** when `is_local_endpoint(base_url)` | fine — and Tailscale CGNAT counts as local, deliberately |
| stale-stream detector | 180s cloud, **900s** local (`agent.local_stream_stale_timeout`) | fine |
| compaction aux call (`auxiliary_client.py`) | idle 300s floor, total ceiling `max(600, 4×300)` = **1200s**, and streamed so the timeout is per-chunk, not a total budget | fine |
| Hydo `REQUEST_TIMEOUT_MS` | 120s | fine — no RPC Hydo issues waits on generation; `prompt.submit` returns `{status:"streaming"}` at once, and `session.compress`, the one that does, is already issued at the turn ceiling |
| Hydo `STARTUP_TIMEOUT_MS` | 60s | fine — gateway start does not touch the model |
| **Hydo `TURN_TIMEOUT_MS`** | **900s** | **too tight.** 900s is 14,400 tokens for the WHOLE agent loop — every tool round trip is another generation — and a single legal Hermes compaction may consume 1200s of it on its own. The ceiling could fire while Hermes was doing exactly what it was told to. |

The fix is `LOCAL_TURN_TIMEOUT_MS` = 3600s, applied **only** when the session's
provider resolves to a local endpoint. The hosted 900s does not move: a hosted
turn silent for fifteen minutes is a wedged stream, and a timeout that never
fires is its own bug — the user gets a spinner instead of an answer.

"Local" is the same set Hermes uses (`agent/model_metadata.py`
`is_local_endpoint`): loopback, container DNS, unqualified hostnames, RFC-1918,
link-local, and **Tailscale CGNAT 100.64/10**. That last one is why the drawn
line has to match Hermes exactly — `100.74.135.83` is not RFC-1918 and reads as
a public cloud host to a naive check, and if Hydo disagreed with Hermes about
it, Hydo's ceiling would kill streams Hermes was still happily waiting on.
`electron/local-providers.cjs` `isLocalHost` / `paceOf` / `paceFor`.

### Reasoning effort is not sent to this endpoint at all

Hydo sends `reasoning_effort` on `session.create` (`low` normally, `minimal`
for the landing turn). On this transport it is inert, and it is worth being
exact about why rather than pretending it tuned something.

Hermes puts `reasoning_effort` (or `extra_body.reasoning`) on a
`chat_completions` request only when `AIAgent._supports_reasoning_extra_body()`
returns true (`run_agent.py:7629`). That method says yes to: nousresearch.com,
ai-gateway.vercel.sh, GitHub Models / Copilot, provider id `lmstudio`,
ollama.com, and OpenRouter URLs — and then ends
`if not self._is_openrouter_url(): return False`. An Unsloth box, llama.cpp,
vLLM, any plain OpenAI-compatible server is none of those. The transport
(`agent/transports/chat_completions.py:664`) gates the emit on the same flag.
There is also no user lever: provider-level `extra_body` in config.yaml is read
by `auxiliary_client.py` for **aux calls only** and never reaches the main turn.

So the field was never on the wire — but sending it was not free. `sessionFor`
treats a changed `reasoningEffort` as a different session and tears the old one
down, so the landing turn (`minimal`) followed by the first real turn (`low`)
rebuilt the session every time: a cold agent init and a re-prefill at 16 tok/s,
bought with a field the endpoint never saw. Hydo now omits it, and stops
counting it as a session difference, whenever the provider is one Hermes will
not send it to. `lmstudio` keeps it, because Hermes really does honour it there.

**The lever that does work** on this server is `chat_template_kwargs:
{enable_thinking: false}` — verified by sending it: `reasoning_content` came
back empty and the same prompt finished in 3.82s instead of 13.42s. Hermes has
no config path that puts that on a main-turn request, so today it is something
to set server-side (the Unsloth/llama.cpp launch flags) if the thinking tokens
are not worth their seconds. Hydo cannot turn it on for you and does not claim
to.

### Two minutes of "Working" is not a hang

At 16 tok/s a 2,000-token answer is 125 seconds during which the working row
said one unchanging word. That is indistinguishable from a wedge, and the only
thing a user can do about a wedge is abandon a turn that was fine.

The row now carries an elapsed clock after 20s (`elapsedLabel` in
`src/lib/presence.js`). 20s is ~320 tokens at the measured rate: past every
short local answer, and well past anything a hosted model does routinely, so it
is silent on hosted work. It is a legibility threshold, **not** a deadline —
nothing gives up when it passes, and `presenceOf` has no time limit on a
working turn (asserted at 30 minutes in `scripts/slow-model-test.cjs`).

### Compaction is native, on, and now says so

Hydo does not disable or duplicate Hermes' compaction. `compression.enabled` is
true by default and Hydo's profile config only narrows `tail_mode` to `lean`;
`electron/context-mgmt.cjs` is a between-turn nudge at 70%, which Hermes is
free to decline (and it hands back the real percent either way).

What was wrong was the telling. Hydo has two compaction paths and only the
post-turn one posted an event; the **pre-turn** one wrote a line to the action
log and nothing else. On a 200K hosted window that barely matters. On a
modest-context local model it is the path that fires, so the visible effect was
a teammate pausing before it answered, forgetting things, and never saying why.
Both paths now post the same sentence, from one definition, into the
conversation it happened in.

### Verified vs read

**Run here:** the three timing rows above, against the real endpoint; the
`enable_thinking:false` probe; `npm test` (now including
`scripts/slow-model-test.cjs`) and `npm run build`.

**Read, not run:** every Hermes deadline in the table — they come from the
Python in `~/.hermes/hermes-agent`, with file names given so the next person
can check them rather than trust this file. No Hydo turn was driven end to end
against the box; the context cap discussed at the top of this file was still
being raised on the PC side while this was written.
