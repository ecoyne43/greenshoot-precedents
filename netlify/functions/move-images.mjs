// POST /api/move-images { after? }  Copies library images from Netlify Blobs to Cloudflare, 20 at a time (the admin
// page calls it until done). Copies only; nothing is deleted from Netlify, so older pages keep working meanwhile.
// GET /api/move-images  status: { remote, imageToken, total } for the admin page.
import { requireAuth, json, handle, imageToken } from "../lib/server.mjs";
import { store } from "../lib/blobs.mjs";
import { remoteOn, putImage, LIB_KEY } from "../lib/imagestore.mjs";

const BATCH = 20;

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  const files = store("images");
  const { blobs } = await files.list();
  const keys = blobs.map(b => b.key).filter(k => LIB_KEY.test(k)).sort();
  if (req.method === "GET") return json({ remote: remoteOn(), imageToken: imageToken(), total: keys.length });
  if (!remoteOn()) return json({ error: "Cloudflare isn't set up yet (IMAGES_URL and IMAGES_UPLOAD_SECRET in Netlify)" }, 400);
  const { after = "" } = await req.json().catch(() => ({}));
  const todo = keys.filter(k => k > after).slice(0, BATCH);
  let copied = 0;
  for (const k of todo) {
    const buf = await files.get(k, { type: "arrayBuffer" });
    if (buf) { await putImage(k, Buffer.from(buf)); copied++; }
  }
  const next = todo.at(-1) || after;
  return json({ copied, next, done: keys.filter(k => k > next).length === 0, total: keys.length, position: keys.indexOf(next) + 1 });
});

export const config = { path: "/api/move-images" };
