# Voice benchmarks

Real transcripts from Grok Bot, replayed against a fresh Hydo teammate so the
two can be compared line for line.

These exist because "it feels stiff" is not actionable and was, three separate
times this week, wrong about the cause. Each of these files is a case where a
reference client answered well and Hydo did not; the reference reply is stored
next to the prompt so a regression is visible rather than remembered.

Run one:

    node scripts/benchmark.cjs james

Run all of them:

    node scripts/benchmark.cjs

This spends real tokens on a real model — it is NOT part of `npm test`.
Each run creates a teammate in a throwaway store directory, so nothing
touches the user's own roster.
