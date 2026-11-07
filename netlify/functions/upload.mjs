// POST /api/upload { data, thumb }  Stores one image (big and thumbnail JPEGs, already shrunk by the browser) in
// Blobs ("images") and returns { key, thumb_key }. Images go up one at a time before the record is saved, because
// Netlify refuses requests over about 6 MB and a precedent can have many photos.
import { randomBytes } from "node:crypto";
import { requireAuth, json, handle } from "../lib/server.mjs";
import { store } from "../lib/blobs.mjs";

const MAX = 3_000_000;
const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { data, thumb } = await req.json().catch(() => ({}));
  const big = Buffer.from(String(data || ""), "base64"), small = Buffer.from(String(thumb || ""), "base64");
  if (!big.length || !small.length) return json({ error: "No image received" }, 400);
  if (big.length > MAX || small.length > MAX) return json({ error: "Image too large after resizing" }, 413);
  const id = "img_" + Date.now().toString(36) + randomBytes(3).toString("hex");
  const key = `up/${id}.jpg`, thumb_key = `up/${id}_t.jpg`;
  const files = store("images");
  await files.set(key, ab(big));
  await files.set(thumb_key, ab(small));
  return json({ id, key, thumb_key });
});

export const config = { path: "/api/upload" };
