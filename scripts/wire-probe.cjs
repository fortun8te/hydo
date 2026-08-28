#!/usr/bin/env node
"use strict";

/**
 * wire-probe.cjs — does this endpoint actually HONOUR the knob, or just
 * return 200 when you turn it?
 *
 * `local-providers.probe()` answers "is something listening and does it have
 * a model". That is a liveness check, and liveness is not the question that
 * has bitten this project. The question is whether a parameter we send
 * changes anything, and the honest answer has never been derivable from a
 * status code.
 *
 * Today `paceOf()` decides that with:
 *
 *     reasoningHonoured = id === "lmstudio" || host.endsWith("ollama.com")
 *
 * which is a guess keyed on a provider's NAME. It drives whether Hydo sends
 * reasoning_effort at all, and whether a changed effort rebuilds the session.
 * If the guess is wrong in one direction we silently drop a capability the
 * endpoint has; in the other we churn sessions for a field it ignores.
 *
 * This replaces the guess with evidence, per OpenGrok's rule that a wire map
 * needs a captured request behind it rather than a plausible story:
 *
 *   reasoning   send the same prompt at low vs high effort. A server that
 *               honours it spends visibly more on the high one --
 *               reasoning_content, reasoning_tokens, or simply far more
 *               completion tokens. Identical output on both is the tell that
 *               the field was accepted and dropped.
 *   thinking    chat_template_kwargs.enable_thinking:false is the only lever
 *               that turns a Qwen-class scratchpad off (docs/LOCAL-MODEL.md).
 *               Verified the same way: it must make the reasoning DISAPPEAR.
 *
 * Nothing here is inferred from a name, and nothing is reported as verified
 * that was not observed. An endpoint that is down reports "unknown", never
 * "does not honour it" -- the failure this whole file exists to avoid.
 *
 *   node scripts/wire-probe.cjs                 # every configured provider
 *   node scripts/wire-probe.cjs unsloth         # just one
 */

const localProviders = require("../electron/local-providers.cjs");

const TIMEOUT_MS = 90_000;
const PROMPT = "A farmer has 17 sheep. All but 9 run away. How many are left? Answer with the number and one short sentence.";

async function post(url, key, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, status: res.status, ms };
    const json = await res.json();
    const choice = (json.choices || [])[0] || {};
    const msg = choice.message || {};
    const usage = json.usage || {};
    return {
      ok: true,
      ms,
      text: String(msg.content || ""),
      // Two shapes in the wild: a sibling field, and usage detail.
      reasoning: String(msg.reasoning_content || msg.reasoning || ""),
      completionTokens:
        Number(usage.completion_tokens || 0) || Number(usage.output_tokens || 0) || 0,
      reasoningTokens:
        Number((usage.completion_tokens_details || {}).reasoning_tokens || 0) ||
        Number(usage.reasoning_tokens || 0) ||
        0,
    };
  } catch (err) {
    return { ok: false, error: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(t);
  }
}

/** Evidence that the second call did MORE thinking than the first. */
function spentMore(low, high) {
  if (low.reasoningTokens || high.reasoningTokens) {
    return high.reasoningTokens > low.reasoningTokens * 1.25;
  }
  if (low.reasoning || high.reasoning) {
    return high.reasoning.length > low.reasoning.length * 1.25;
  }
  // No dedicated channel: completion length is the only signal left, and it
  // is noisy, so it needs a wide margin before it counts as evidence.
  return high.completionTokens > low.completionTokens * 1.6;
}

(async () => {
  const want = (process.argv[2] || "").trim().toLowerCase();
  const providers = localProviders
    .list()
    .filter((p) => !p.placeholder && (!want || p.id.toLowerCase() === want));

  if (!providers.length) {
    console.log(want ? `No configured provider called "${want}".` : "No usable providers configured.");
    process.exit(1);
  }

  for (const p of providers) {
    const url = `${p.api.replace(/\/$/, "")}/chat/completions`;
    const key = localProviders.keyFor(p.id);
    const model = p.model;
    console.log(`\n${p.id}  (${p.host}${model ? `, ${model}` : ""})`);
    if (!model) {
      console.log("  unknown — no default_model configured, nothing to send");
      continue;
    }

    const base = { model, messages: [{ role: "user", content: PROMPT }], stream: false };

    const low = await post(url, key, { ...base, reasoning_effort: "low" });
    if (!low.ok) {
      // Down is UNKNOWN, never "does not honour it".
      console.log(`  unknown — endpoint did not answer (${low.error || `HTTP ${low.status}`})`);
      continue;
    }
    const high = await post(url, key, { ...base, reasoning_effort: "high" });
    if (!high.ok) {
      console.log(`  unknown — second call failed (${high.error || `HTTP ${high.status}`})`);
      continue;
    }

    const honours = spentMore(low, high);
    console.log(
      `  reasoning_effort : ${honours ? "HONOURED" : "ignored"}  ` +
        `(low ${low.completionTokens}tok/${low.ms}ms vs high ${high.completionTokens}tok/${high.ms}ms` +
        `${low.reasoningTokens || high.reasoningTokens ? `, reasoning ${low.reasoningTokens}->${high.reasoningTokens}` : ""})`
    );

    const guess = localProviders.paceFor(p.id).reasoningHonoured;
    if (guess !== honours) {
      console.log(
        `  MISMATCH: local-providers.paceOf() says ${guess}, the wire says ${honours}. ` +
          `That guess is keyed on the provider NAME — this endpoint disagrees with it.`
      );
    }

    // The thinking off-switch, only where there was thinking to switch off.
    if (low.reasoning || low.reasoningTokens) {
      const off = await post(url, key, {
        ...base,
        chat_template_kwargs: { enable_thinking: false },
      });
      if (!off.ok) {
        console.log(`  enable_thinking : unknown — call failed (${off.error || `HTTP ${off.status}`})`);
      } else {
        const quiet = !off.reasoning && !off.reasoningTokens;
        console.log(
          `  enable_thinking : ${quiet ? "HONOURED (scratchpad off)" : "ignored (still thinking)"}` +
            `  ${off.completionTokens}tok/${off.ms}ms`
        );
      }
    }

    const answer = (high.text || "").replace(/\s+/g, " ").trim().slice(0, 90);
    console.log(`  answer: ${answer || "(empty)"}`);
    // The correctness check that made thinking-off look attractive and then
    // turned out to cost accuracy (docs/LOCAL-MODEL.md): 9 is right, 8 is the
    // trap.
    if (answer && !/\b9\b/.test(answer)) console.log("  note: got the sheep question WRONG");
  }
  process.exit(0);
})();
