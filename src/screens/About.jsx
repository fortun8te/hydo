import { useState } from "react";
import { APP_ICON } from "../lib/blobs.js";
import pkg from "../../package.json";

/**
 * About.
 *
 * It said "Hydo 0.1.0" in body text with the version hardcoded beside a real
 * one in package.json, so the two could drift and nobody would notice. The
 * version is imported now: Vite inlines it at build time, which means the
 * number in this dialog is the number that was built.
 *
 * "Copy version info" copies what a bug report actually needs. A dialog that
 * shows a version and gives you no way to send it makes you retype it.
 */
export default function About() {
  const [copied, setCopied] = useState(false);
  const version = pkg.version || "0.0.0";

  function copy() {
    // Straight from the runtime rather than from anything we hardcode: the
    // whole point is to describe the build that is actually running.
    const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
    const chrome = /Chrome\/([\d.]+)/.exec(ua);
    const electron = /Electron\/([\d.]+)/.exec(ua);
    const lines = [
      `Hydo ${version}`,
      electron ? `Electron ${electron[1]}` : "",
      chrome ? `Chromium ${chrome[1]}` : "",
      typeof navigator !== "undefined" && navigator.platform ? navigator.platform : "",
    ].filter(Boolean);
    navigator.clipboard?.writeText(lines.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="hy-about">
      <img className="hy-about__icon" src={APP_ICON} alt="" width="92" height="92" />
      <h2 className="hy-about__name">Hydo</h2>
      <p className="hy-about__version">Version {version}</p>
      <p className="hy-about__legal">Teammates that run on Hermes Agent.</p>
      <button type="button" className="hy-about__copy" onClick={copy}>
        {copied ? "Copied" : "Copy version info"}
      </button>
    </div>
  );
}
