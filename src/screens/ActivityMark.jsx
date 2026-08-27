import { pluginIconUrl, MONO_DARK_LOGOS } from "../lib/plugin-icons.js";

/**
 * The brand mark that sits next to an activity line.
 *
 * The slug comes off a real `tool.start` event: an MCP tool is registered as
 * `mcp__<server>__<tool>`, so `electron/activity.cjs` can hand the renderer
 * the server it belongs to and the icon is the SAME asset the marketplace
 * shows — `pluginIconUrl`, including its fuzzy alias pass, so "blender_mcp"
 * still lands on the Blender mark.
 *
 * Renders NOTHING when the slug resolves to no asset. That branch is the
 * whole reason this is a component instead of an inline <img>: an <img> with
 * an empty src is a broken-image glyph in some states and a 0x0 box in
 * others, and this codebase has shipped both.
 */
export default function ActivityMark({ plugin, size = 14 }) {
  const id = String(plugin || "").toLowerCase();
  if (!id) return null;
  // The slug is sanitized by Hermes ("chrome-devtools" → "chrome_devtools"),
  // so try the underscore form and the hyphen form the catalog is keyed by.
  const src = pluginIconUrl({ id }) || pluginIconUrl({ id: id.replace(/_/g, "-") });
  if (!src) return null;
  // GitHub and Notion ship an essentially black mark, which vanishes on this
  // app's dark surfaces. Same fix as the marketplace: a constant light chip.
  const chip = MONO_DARK_LOGOS.has(id) || MONO_DARK_LOGOS.has(id.replace(/_/g, "-"));
  return (
    <span
      className={`hy-act-mark${chip ? " hy-act-mark--chip" : ""}`}
      style={{ "--hy-act-mark-size": `${size}px` }}
      aria-hidden="true"
    >
      <img src={src} alt="" />
    </span>
  );
}
