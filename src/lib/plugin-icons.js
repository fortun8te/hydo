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
};

function svg(inner) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44">${inner}</svg>`
  )}`;
}

const DRAWN = {
  figma: svg(
    `<rect width="44" height="44" rx="11" fill="#1e1e1e"/><circle cx="16" cy="14" r="5" fill="#f24e1e"/><circle cx="28" cy="14" r="5" fill="#ff7262"/><circle cx="16" cy="22" r="5" fill="#a259ff"/><circle cx="28" cy="22" r="5" fill="#1abcfe"/><circle cx="16" cy="30" r="5" fill="#0acf83"/>`
  ),
  blender: svg(
    `<rect width="44" height="44" rx="11" fill="#e87d0d"/><path fill="#fff" d="M22 8l11 6.4v12.2L22 33l-11-6.4V14.4z"/><circle cx="22" cy="20" r="4.2" fill="#e87d0d"/>`
  ),
  searxng: svg(
    `<rect width="44" height="44" rx="11" fill="#3050f0"/><circle cx="20" cy="20" r="8" fill="none" stroke="#fff" stroke-width="3"/><path stroke="#fff" stroke-width="3" stroke-linecap="round" d="M26 26l8 8"/>`
  ),
  exa: svg(
    `<rect width="44" height="44" rx="11" fill="#111"/><text x="22" y="28" text-anchor="middle" fill="#fff" font-size="16" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif">exa</text>`
  ),
  pencil: svg(
    `<rect width="44" height="44" rx="11" fill="#f4c430"/><path fill="#1c1c1c" d="M12 30.5l14.2-14.2 3.5 3.5L15.5 34H12z"/><path fill="#1c1c1c" d="M27.2 15.2l2.1-2.1 3.6 3.6-2.1 2.1z"/>`
  ),
  chatgpt: svg(
    `<rect width="44" height="44" rx="11" fill="#10a37f"/><path fill="#fff" d="M22 11c2.4 0 4.6 1 6.1 2.7a7.2 7.2 0 013.3 6.1c0 .4 0 .8-.1 1.2a7.3 7.3 0 012.3 8.3A7.3 7.3 0 0128 33.6a7.2 7.2 0 01-12-.3 7.3 7.3 0 01-6.4-4.6 7.3 7.3 0 012.4-8.2 7.2 7.2 0 013.3-6.2A7.2 7.2 0 0122 11z"/>`
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
  github: svg(
    `<rect width="44" height="44" rx="11" fill="#111"/><path fill="#fff" d="M22 10a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.3 1.2a11.4 11.4 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 3 .1 3.3.8.8 1.2 1.9 1.2 3.2 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A12 12 0 0022 10z"/>`
  ),
  gmail: svg(
    `<rect width="44" height="44" rx="11" fill="#fff"/><path fill="#4285F4" d="M7 13v19h7.6V21.4L22 26.9l7.4-5.5V32H37V13L22 24.1z"/><path fill="#EA4335" d="M7 13v4l15 11 15-11v-4L22 23.3z"/>`
  ),
  gcal: svg(
    `<rect width="44" height="44" rx="11" fill="#fff"/><rect x="5" y="5" width="34" height="34" rx="7" fill="#1a73e8"/><text x="22" y="30" text-anchor="middle" fill="#fff" font-size="19" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif">31</text>`
  ),
  gdrive: svg(
    `<rect width="44" height="44" rx="11" fill="#fff"/><path fill="#0F9D58" d="M15.6 31 22 11.6 28.4 31z"/><path fill="#4285F4" d="M6.2 31h12.6L15.9 20.7z"/><path fill="#FFBA00" d="M25.2 31h12.6L34.9 20.7z"/>`
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
