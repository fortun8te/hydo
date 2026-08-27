export const BLOBS = {
  ada: new URL("../kit/images/ada-CkPKuPfQ.svg", import.meta.url).href,
  blue: new URL("../kit/images/blue-B2n6EVGi.svg", import.meta.url).href,
  green: new URL("../kit/images/green-CPliirpZ.svg", import.meta.url).href,
  red: new URL("../kit/images/red-DBxWh2u2.svg", import.meta.url).href,
  dijkstra: new URL("../kit/images/dijkstra-ByucqRsn.svg", import.meta.url).href,
};

// Ours, generated from the real blob geometry by scripts/make-app-icon.mjs .
// not the icon that came out of the extracted kit, which was Grok Bot's.
// SVG on purpose: it is the source, it stays sharp at every size the app draws
// it, and regenerating it after a body is retuned is one command. Packaging
// still needs a raster .icns; that conversion needs a rasteriser this machine
// does not have (rsvg-convert / resvg / sharp).
export const APP_ICON = new URL("../kit/images/hydo-icon.svg", import.meta.url).href;

export function blobSrc(name) {
  return BLOBS[name] || BLOBS.ada;
}

export function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((start(now) - start(d)) / 86400000);
  if (days <= 0) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "numeric", day: "numeric" });
}
