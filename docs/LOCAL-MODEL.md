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
