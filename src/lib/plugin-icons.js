/** Kit assets + drawn marks for known MCP ids. Additive map only — sort lives in Plugins.jsx. */

export const PLUGIN_LOGOS = {
  apollo: new URL("../kit/images/apollo-B0sEgAUH.png", import.meta.url).href,
  ashby: new URL("../kit/images/ashby-BidvOSTU.png", import.meta.url).href,
  box: new URL("../kit/images/box-DrJB_xON.png", import.meta.url).href,
  calendly: new URL("../kit/images/calendly-DYRMkyLM.svg", import.meta.url).href,
  canva: new URL("../kit/images/canva-djBDOrSx.svg", import.meta.url).href,
  clay: new URL("../kit/images/clay-CXmF7QZG.png", import.meta.url).href,
  databricks: new URL("../kit/images/databricks-NEF0SRYx.png", import.meta.url).href,
  mailchimp: new URL("../kit/images/mailchimp-AFHOmIeb.svg", import.meta.url).href,
  nooks: new URL("../kit/images/nooks-Da6AC940.png", import.meta.url).href,
  quickbooks: new URL("../kit/images/quickbooks-N88wePET.png", import.meta.url).href,
  rippling: new URL("../kit/images/rippling-cz7o1jpc.png", import.meta.url).href,
  salesforce: new URL("../kit/images/salesforce-DuGcPENR.svg", import.meta.url).href,
  snowflake: new URL("../kit/images/snowflake-B53K53W6.png", import.meta.url).href,
  tableau: new URL("../kit/images/tableau-DMgl1MR0.png", import.meta.url).href,
  workday: new URL("../kit/images/workday-DI2a8j1o.svg", import.meta.url).href,
  zoominfo: new URL("../kit/images/zoominfo-kXQt8h27.png", import.meta.url).href,
  // Added for the marketplace icon audit: these used to be hand-drawn
  // approximations in DRAWN below (or a bare letter tile for slack/notion/
  // linear, which had no mark at all). Real official marks now, sourced
  // from simple-icons/vendor CDNs — see the audit report for provenance.
  slack: new URL("../kit/images/slack.png", import.meta.url).href,
  notion: new URL("../kit/images/notion.svg", import.meta.url).href,
  linear: new URL("../kit/images/linear.svg", import.meta.url).href,
  github: new URL("../kit/images/github.svg", import.meta.url).href,
  figma: new URL("../kit/images/figma.svg", import.meta.url).href,
  gmail: new URL("../kit/images/gmail.svg", import.meta.url).href,
  gcal: new URL("../kit/images/googlecalendar.svg", import.meta.url).href,
  gdrive: new URL("../kit/images/googledrive.svg", import.meta.url).href,
  chatgpt: new URL("../kit/images/openai.svg", import.meta.url).href,
  blender: new URL("../kit/images/blender.svg", import.meta.url).href,
  searxng: new URL("../kit/images/searxng.svg", import.meta.url).href,
};

function svg(inner) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44">${inner}</svg>`
  )}`;
}

const DRAWN = {
  exa: svg(
    `<rect width="44" height="44" rx="11" fill="#111"/><text x="22" y="28" text-anchor="middle" fill="#fff" font-size="16" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif">exa</text>`
  ),
  pencil: svg(
    `<rect width="44" height="44" rx="11" fill="#f4c430"/><path fill="#1c1c1c" d="M12 30.5l14.2-14.2 3.5 3.5L15.5 34H12z"/><path fill="#1c1c1c" d="M27.2 15.2l2.1-2.1 3.6 3.6-2.1 2.1z"/>`
  ),
  magnific: svg(
    `<rect width="44" height="44" rx="11" fill="#6d28d9"/><circle cx="22" cy="22" r="9" fill="none" stroke="#fff" stroke-width="3"/><circle cx="22" cy="22" r="3" fill="#fff"/>`
  ),
  parallel: svg(
    `<rect width="44" height="44" rx="11" fill="#0f172a"/><path fill="none" stroke="#38bdf8" stroke-width="3" d="M14 14v16M22 10v24M30 14v16"/>`
  ),
  sticky: svg(
    `<rect width="44" height="44" rx="11" fill="#fde047"/><path fill="#facc15" d="M28 8h8v8z"/><rect x="12" y="16" width="20" height="16" rx="2" fill="#fff"/>`
  ),
  walkingpad: svg(
    `<rect width="44" height="44" rx="11" fill="#111"/><rect x="8" y="24" width="28" height="8" rx="2" fill="#22c55e"/><circle cx="16" cy="20" r="3" fill="#fff"/><path stroke="#fff" stroke-width="2.4" d="M18 21l4 4 6-8"/>`
  ),
  filesystem: svg(
    `<rect width="44" height="44" rx="11" fill="#3b82f6"/><path fill="#fff" d="M12 14h10l3 3h7v15H12z"/>`
  ),
};

const ALIAS = {
  "blender-mcp": "blender",
  blender: "blender",
  "chatgpt-unlimited": "chatgpt",
  chatgpt: "chatgpt",
  "magnific-unlimited": "magnific",
  magnific: "magnific",
  "parallel-search": "parallel",
  parallel: "parallel",
  "z1-walkingpad": "walkingpad",
  walkingpad: "walkingpad",
  searxng: "searxng",
  exa: "exa",
  pencil: "pencil",
  figma: "figma",
  sticky: "sticky",
  filesystem: "filesystem",
  github: "github",
  gmail: "gmail",
  gcal: "gcal",
  "google-calendar": "gcal",
  gdrive: "gdrive",
  "google-drive": "gdrive",
};

export const PLUGIN_PRETTY = {
  "chatgpt-unlimited": "ChatGPT Unlimited",
  "magnific-unlimited": "Magnific",
  "blender-mcp": "Blender",
  "parallel-search": "Parallel",
  "z1-walkingpad": "WalkingPad",
  searxng: "SearXNG",
  figma: "Figma",
  pencil: "Pencil",
  sticky: "Sticky",
  exa: "Exa",
};

function slugOf(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function pluginPrettyName(plugin) {
  const id = String((plugin && (plugin.id || plugin.name)) || "");
  if (PLUGIN_PRETTY[id]) return PLUGIN_PRETTY[id];
  const slug = slugOf(id);
  for (const [k, v] of Object.entries(PLUGIN_PRETTY)) {
    if (slugOf(k) === slug) return v;
  }
  return String((plugin && plugin.name) || id);
}

/**
 * Marks whose official colour is essentially black.
 *
 * The icon tile is `--sand-fill-secondary`, which is dark under the dark theme
 * and light under the light one — so a black mark disappears in dark and a
 * white one would disappear in light. Recolouring someone's logo per theme is
 * not ours to do, so these get a constant light chip to sit on instead, which
 * is what app stores do with the same problem.
 *
 * GitHub shipped at #181717 and Notion at #000000, and both rendered as a
 * barely-visible smudge on the dark tile.
 */
export const MONO_DARK_LOGOS = new Set(["github", "notion"]);

export function pluginIconUrl(plugin) {
  if (!plugin || typeof plugin !== "object") return "";
  if (plugin.iconUrl) return plugin.iconUrl;
  const raw = String(plugin.id || plugin.name || "").toLowerCase();
  if (PLUGIN_LOGOS[raw]) return PLUGIN_LOGOS[raw];
  const alias = ALIAS[raw] || ALIAS[slugOf(raw)];
  if (alias && DRAWN[alias]) return DRAWN[alias];
  if (DRAWN[raw]) return DRAWN[raw];
  const slug = slugOf(raw);
  if (DRAWN[slug]) return DRAWN[slug];
  for (const [key, href] of Object.entries(PLUGIN_LOGOS)) {
    if (slug === key || slug.includes(key) || key.includes(slug)) return href;
  }
  for (const [key, href] of Object.entries(DRAWN)) {
    if (slug === key || slug.includes(key) || key.includes(slug)) return href;
  }
  return "";
}
