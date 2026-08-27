import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
const out = "/Users/michael/Projects/hydo/_rc.mjs";
await esbuild.build({
  entryPoints: ["/Users/michael/Projects/hydo/src/screens/RichContent.jsx"],
  bundle: true, format: "esm", outfile: out, jsx: "automatic",
  external: ["react", "react/jsx-runtime", "react-dom", "*.png", "*.svg", "*.woff2"],
  loader: { ".png": "empty", ".svg": "empty", ".css": "empty", ".woff2": "empty" },
});
const RC = await import(out);
const { renderToString } = await import("react-dom/server");
const React = (await import("react")).default;

const SAMPLE = `Here is what I found.

- **First** point with \`code\` and a [link](https://x.com)
- Second point, longer, with some _emphasis_ and more words to chew on

\`\`\`js
const x = 1;
console.log(x);
\`\`\`

| a | b |
| - | - |
| 1 | 2 |

A closing paragraph that runs a bit longer so the inline parser has work to do.`;

const N = 60; // messages in a thread
const msgs = Array.from({ length: N }, (_, i) => SAMPLE + "\n\nmsg " + i);

function once() {
  for (const m of msgs) renderToString(React.createElement(RC.Markdown, { text: m, caret: false }));
}
once();
const t = performance.now();
for (let i = 0; i < 20; i++) once();
const per = (performance.now() - t) / 20;
console.log(`markdown render of a ${N}-message thread: ${per.toFixed(1)} ms`);
console.log(`at one tick per 240ms that is ${(per / 240 * 100).toFixed(1)}% of the main thread, forever`);
