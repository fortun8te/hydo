/** File-kind + preview classification used by MediaViewer (.nd, PDF, HTML, property.zip). */

export const EXT_KIND = {
  nd: "nd",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  txt: "doc",
  rtf: "doc",
  doc: "doc",
  docx: "doc",
  pages: "doc",
  pdf: "pdf",
  html: "html",
  htm: "html",
  xhtml: "html",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  dmg: "archive",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  heic: "image",
  avif: "image",
  bmp: "image",
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  json: "code",
  py: "code",
  rb: "code",
  go: "code",
  rs: "code",
  sh: "code",
  css: "code",
  yml: "code",
  yaml: "code",
  toml: "code",
  sql: "code",
  swift: "code",
  c: "code",
  h: "code",
  cpp: "code",
  java: "code",
};

export const KIND_LABEL = {
  nd: "ND document",
  markdown: "Markdown document",
  pdf: "PDF document",
  html: "HTML page",
  archive: "Archive",
  image: "Image",
  doc: "Document",
  code: "Code file",
  file: "File",
};

export const TEXTISH = new Set([
  "nd",
  "md",
  "markdown",
  "mdx",
  "txt",
  "text",
  "log",
  "json",
  "csv",
  "tsv",
  "xml",
  "yml",
  "yaml",
  "toml",
  "ini",
  "env",
  "html",
  "htm",
  "xhtml",
  "svg",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "sh",
  "bash",
  "zsh",
  "css",
  "scss",
  "sql",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "java",
  "kt",
  "php",
  "pl",
  "lua",
  "r",
  "diff",
  "patch",
]);

export const MAX_PREVIEW_TEXT = 400000;

export function toText(value) {
  if (value == null) return "";
  return String(value);
}

export function splitName(name) {
  const n = toText(name).replace(/[\r\n\t]/g, " ").trim();
  if (!n) return { base: "Untitled", ext: "" };
  const dot = n.lastIndexOf(".");
  if (dot <= 0 || dot === n.length - 1 || n.length - dot > 12) return { base: n, ext: "" };
  return { base: n.slice(0, dot), ext: n.slice(dot) };
}

export function extOf(item) {
  if (!item || typeof item !== "object") return "";
  const declared = toText(item.ext).trim();
  if (declared) return (declared.startsWith(".") ? declared : `.${declared}`).toLowerCase();
  return splitName(item.name).ext.toLowerCase();
}

export function normKind(kind, ext) {
  const k = toText(kind).toLowerCase().trim();
  if (k) {
    if (k === "zip" || k === "archive") return "archive";
    if (k === "img" || k === "photo" || k === "image") return "image";
    if (KIND_LABEL[k]) return k;
  }
  const e = toText(ext).replace(/^\./, "").toLowerCase();
  return EXT_KIND[e] || "file";
}

export function isTextish(item) {
  return TEXTISH.has(extOf(item).replace(/^\./, ""));
}

export function isPropertyZip(item) {
  const name = toText(item && item.name).toLowerCase();
  return name === "property.zip" || name.endsWith("/property.zip");
}
