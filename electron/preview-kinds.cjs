"use strict";

/**
 * What Hydo can show you, by extension.
 *
 * One registry, shared by the file chips (`previewFile`) and the artifact pane
 * (`readArtifact`), so a file cannot be viewable in one place and a dead chip
 * in the other. Adding a format means adding a line here.
 *
 * Everything in TEXT is free: it is bytes on disk shown as bytes. The paid
 * ones are DOC (a converter) and SHEET (a parser), and both are deliberately
 * done with things already on the machine rather than a bundled library:
 *   docx/doc/rtf/odt  -> `textutil`, which ships with macOS
 *   xlsx/pptx         -> `uv run --with ...`, which needs no install
 * That keeps the app's bundle out of it and means the list can be long.
 */

// ── text ────────────────────────────────────────────────────────────────
// `lang` is a hint for the viewer's label and future highlighting. It is not
// a promise that anything highlights.
const TEXT = {
  // NOTE: no "" key. An empty extension must fall through to TEXT_BY_NAME,
  // or `Dockerfile` and `.gitignore` match here first and lose their language.
  txt: "", text: "", log: "", me: "", nfo: "",
  md: "markdown", markdown: "markdown", mdx: "markdown", rst: "rst", adoc: "asciidoc",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  py: "python", pyi: "python", rb: "ruby", php: "php", pl: "perl", lua: "lua",
  go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin",
  swift: "swift", m: "objectivec", mm: "objectivec",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp", fs: "fsharp", scala: "scala", clj: "clojure", ex: "elixir",
  exs: "elixir", erl: "erlang", hs: "haskell", ml: "ocaml", r: "r", jl: "julia",
  dart: "dart", zig: "zig", nim: "nim", v: "v", sol: "solidity",
  sh: "bash", bash: "bash", zsh: "bash", fish: "fish", ps1: "powershell", bat: "batch",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "protobuf",
  css: "css", scss: "scss", sass: "sass", less: "less", styl: "stylus",
  html: "html", htm: "html", xhtml: "html", vue: "vue", svelte: "svelte", astro: "astro",
  xml: "xml", plist: "xml", svg: "xml", rss: "xml", atom: "xml",
  json: "json", jsonc: "json", json5: "json", jsonl: "jsonl", ndjson: "jsonl",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", cfg: "ini", conf: "ini",
  env: "ini", properties: "ini", editorconfig: "ini",
  diff: "diff", patch: "diff",
  gitignore: "ini", gitattributes: "ini", dockerignore: "ini", npmrc: "ini",
  lock: "", sum: "", mod: "", cmake: "cmake", gradle: "gradle",
  tf: "hcl", tfvars: "hcl", hcl: "hcl", nix: "nix", pp: "puppet",
  ipynb: "notebook", srt: "", vtt: "", tex: "latex", bib: "latex",
  csv: "csv", tsv: "csv",
};

// Files with no extension that are still text, matched on basename.
const TEXT_BY_NAME = {
  gitignore: "ini", gitattributes: "ini", dockerignore: "ini", npmignore: "ini",
  env: "ini", babelrc: "json", eslintrc: "json", prettierrc: "json", npmrc: "ini",
  dockerfile: "dockerfile", makefile: "makefile", rakefile: "ruby",
  gemfile: "ruby", podfile: "ruby", brewfile: "ruby", procfile: "",
  license: "", licence: "", readme: "markdown", changelog: "markdown",
  authors: "", contributors: "", notice: "", codeowners: "", "agents.md": "markdown",
};

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "apng"]);
// Chromium cannot decode these; `sips` (macOS) transcodes them to PNG first.
const IMAGE_CONVERT = new Set(["heic", "heif", "tif", "tiff", "psd", "raw", "cr2", "nef", "arw", "dng", "pict", "tga"]);
// Rendered by the browser, but only as a picture, never as a document.
const IMAGE_VECTOR = new Set(["svg"]);
const VIDEO = new Set(["mp4", "webm", "m4v", "mov", "ogv"]);
const AUDIO = new Set(["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "opus"]);
// Converted with `textutil` (macOS built-in).
const DOC = new Set(["docx", "doc", "rtf", "rtfd", "odt", "wordml", "webarchive", "pages"]);
const SHEET = new Set(["xlsx", "xlsm", "xls", "ods", "numbers"]);
const SLIDES = new Set(["pptx", "ppt", "odp", "key"]);
const ARCHIVE = new Set(["zip", "jar", "ipa", "apk", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "dmg"]);
const MODEL3D = new Set(["obj", "stl", "gltf", "glb", "fbx", "dae", "ply", "usdz", "blend"]);
const FONT = new Set(["ttf", "otf", "woff", "woff2", "eot"]);

const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif",
  apng: "image/apng", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", m4v: "video/mp4", mov: "video/quicktime",
  ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac", opus: "audio/opus",
  pdf: "application/pdf",
};

/**
 * @returns {{kind:string, lang?:string, mime?:string}}
 *   kind — text | image | vector | video | audio | pdf | doc | sheet | slides
 *          | archive | model3d | font | unknown
 */
function kindOf(fileName) {
  const name = String(fileName || "").toLowerCase();
  const base = name.split("/").pop() || name;
  const dot = base.lastIndexOf(".");
  // A leading dot is the whole name (.gitignore), not an extension.
  const ext = dot > 0 ? base.slice(dot + 1) : "";

  if (ext === "pdf") return { kind: "pdf", mime: MIME.pdf };
  if (IMAGE.has(ext)) return { kind: "image", mime: MIME[ext] };
  if (IMAGE_CONVERT.has(ext)) return { kind: "image-convert", ext };
  if (IMAGE_VECTOR.has(ext)) return { kind: "vector", mime: MIME.svg, lang: "xml" };
  if (VIDEO.has(ext)) return { kind: "video", mime: MIME[ext] };
  if (AUDIO.has(ext)) return { kind: "audio", mime: MIME[ext] };
  if (DOC.has(ext)) return { kind: "doc", ext };
  if (SHEET.has(ext)) return { kind: "sheet", ext };
  if (SLIDES.has(ext)) return { kind: "slides", ext };
  if (ARCHIVE.has(ext)) return { kind: "archive", ext };
  if (MODEL3D.has(ext)) return { kind: "model3d", ext };
  if (FONT.has(ext)) return { kind: "font", ext };
  if (Object.prototype.hasOwnProperty.call(TEXT, ext)) return { kind: "text", lang: TEXT[ext] };
  if (!ext && Object.prototype.hasOwnProperty.call(TEXT_BY_NAME, base)) {
    return { kind: "text", lang: TEXT_BY_NAME[base] };
  }
  // Dotfiles: `.babelrc`, `.env.local`, `.gitignore`.
  if (base.startsWith(".")) {
    const inner = base.slice(1).split(".")[0];
    if (Object.prototype.hasOwnProperty.call(TEXT_BY_NAME, inner)) {
      return { kind: "text", lang: TEXT_BY_NAME[inner] };
    }
    return { kind: "text", lang: "ini" };
  }
  if (base.endsWith("rc")) return { kind: "text", lang: "ini" };
  // No extension at all and no known name: still almost certainly text, and
  // showing it as text is recoverable where refusing to open it is not.
  if (!ext) return { kind: "text", lang: "" };
  return { kind: "unknown", ext };
}

/** Every extension we claim to handle, for tests and for the "what can it open" answer. */
function known() {
  return {
    text: Object.keys(TEXT).filter(Boolean),
    textByName: Object.keys(TEXT_BY_NAME),
    image: [...IMAGE, ...IMAGE_VECTOR, ...IMAGE_CONVERT],
    video: [...VIDEO],
    audio: [...AUDIO],
    doc: [...DOC],
    sheet: [...SHEET],
    slides: [...SLIDES],
    archive: [...ARCHIVE],
    model3d: [...MODEL3D],
    font: [...FONT],
    pdf: ["pdf"],
  };
}

module.exports = { kindOf, known, MIME, TEXT, TEXT_BY_NAME, IMAGE_CONVERT };
