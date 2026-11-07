// File storage for photos and the inbox. On Netlify this is Netlify Blobs (no extra account or keys). For local
// tests, set BLOBS_DIR and the same calls read and write files in that folder instead.
import { getStore } from "@netlify/blobs";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";

function folderStore(dir) {
  mkdirSync(dir, { recursive: true });
  const p = k => join(dir, encodeURIComponent(k));
  return {
    async get(k, o = {}) {
      if (!existsSync(p(k))) return null;
      const b = readFileSync(p(k));
      if (o.type === "json") return JSON.parse(b.toString());
      if (o.type === "arrayBuffer") return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
      return b.toString();
    },
    async set(k, v) { writeFileSync(p(k), typeof v === "string" ? v : Buffer.from(v)); },
    async setJSON(k, v) { writeFileSync(p(k), JSON.stringify(v)); },
    async delete(k) { if (existsSync(p(k))) unlinkSync(p(k)); },
    async list({ prefix = "" } = {}) {
      return { blobs: readdirSync(dir).map(decodeURIComponent).filter(k => k.startsWith(prefix)).map(key => ({ key })) };
    },
  };
}

export function store(name) {
  const dir = process.env.BLOBS_DIR;
  if (dir) return folderStore(join(dir, name));
  return getStore({ name, consistency: "strong" });
}
