"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;

function readU32(buf, off) {
  return buf.readUInt32LE(off);
}
function readU16(buf, off) {
  return buf.readUInt16LE(off);
}

function findEocd(buf) {
  const maxComment = 65535;
  const start = Math.max(0, buf.length - (maxComment + 22));
  for (let i = buf.length - 22; i >= start; i--) {
    if (readU32(buf, i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * List zip central-directory entries. Does not extract files.
 * @param {string} filePath
 * @returns {{ok:boolean, name:string, entries:Array<{name:string, size:number, compressed:number}>, reason?:string}}
 */
function listZip(filePath) {
  const abs = path.resolve(String(filePath || ""));
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { ok: false, name: path.basename(abs), entries: [], reason: "missing" };
  }
  const buf = fs.readFileSync(abs);
  const eocd = findEocd(buf);
  if (eocd < 0) return { ok: false, name: path.basename(abs), entries: [], reason: "not-zip" };

  const count = readU16(buf, eocd + 10);
  let off = readU32(buf, eocd + 16);
  const entries = [];
  for (let i = 0; i < count && off + 46 <= buf.length; i++) {
    if (readU32(buf, off) !== SIG_CEN) break;
    const compressed = readU32(buf, off + 20);
    const size = readU32(buf, off + 24);
    const nameLen = readU16(buf, off + 28);
    const extraLen = readU16(buf, off + 30);
    const commentLen = readU16(buf, off + 32);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString("utf8");
    entries.push({ name, size, compressed });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { ok: true, name: path.basename(abs), entries };
}

module.exports = { listZip };
