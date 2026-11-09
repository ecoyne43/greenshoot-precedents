// /api/inbox  Everything sent to the library waits here until someone reviews and approves it.
// Item details in the Blobs store "inbox"; uploaded screenshots and site photos in "inbox-files".
//   GET                 -> { items } newest first
//   POST  { url, title, site, author, date, text, images, note, from, uploads }   add an item
//         uploads: [{ data: base64, type: "image/jpeg" | "image/png", name, credit?, src? }]  up to 20 (screenshots,
//         site photos, Instagram slides saved by the extension: those carry their credit and original address)
//         target: "PR-0004" when sent from a precedent's "Add to this precedent" button
//   PATCH { id, status }      status: "new" | "approved" | "discarded"
//   PATCH { id, uploads }     add more photos to an item (the Add page sends big batches in parts)
//   DELETE ?id=               remove an item and its uploads
import { randomBytes } from "node:crypto";
import { requireAuth, json, handle, userName } from "../lib/server.mjs";
import { store } from "../lib/blobs.mjs";

const s = (v, n) => String(v ?? "").slice(0, n);
const TYPES = { "image/jpeg": "jpg", "image/png": "png" };
const MAX_TOTAL = 4_800_000, MAX_UPLOADS = 20;

// Store uploaded images on an item (up to 20 in all). Returns an error response, or null.
async function addUploads(files, item, ups) {
  let total = 0;
  for (const up of ups) {
    if ((item.uploads || []).length >= MAX_UPLOADS) break;
    const ext = TYPES[up?.type];
    if (!ext) return json({ error: "Only JPEG and PNG images can be sent" }, 415);
    const buf = Buffer.from(String(up.data || ""), "base64");
    total += buf.length;
    if (!buf.length) return json({ error: "An image was empty" }, 400);
    if (total > MAX_TOTAL) return json({ error: "Too much at once (over 4.8 MB). Send fewer photos." }, 413);
    const key = `${item.id}_${item.uploads.length}.${ext}`;
    await files.set(key, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    item.uploads.push({ key, type: up.type, name: s(up.name, 200), taken: s(up.taken, 40),
      ...(up.credit ? { credit: s(up.credit, 200) } : {}), ...(/^https?:/.test(up.src || "") ? { src: s(up.src, 2000) } : {}) });
  }
  return null;
}

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  const box = store("inbox"), files = store("inbox-files");

  if (req.method === "GET") {
    const { blobs } = await box.list();
    const items = (await Promise.all(blobs.map(b => box.get(b.key, { type: "json" })))).filter(Boolean);
    items.sort((a, b) => (a.created < b.created ? 1 : -1));
    return json({ items });
  }

  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ups = (Array.isArray(b.uploads) ? b.uploads : b.upload ? [b.upload] : []).slice(0, MAX_UPLOADS);
    if (!b.text && !b.url && !b.note && !(b.images || []).length && !ups.length) return json({ error: "Nothing to send" }, 400);
    const created = new Date().toISOString();
    const id = created.replace(/\D/g, "").slice(0, 14) + "_" + randomBytes(3).toString("hex");
    const item = {
      id, created, status: "new", by: userName(req),
      url: s(b.url, 2000), title: s(b.title, 300), site: s(b.site, 120), author: s(b.author, 200), date: s(b.date, 60),
      text: s(b.text, 20000), note: s(b.note, 2000),
      images: (Array.isArray(b.images) ? b.images : []).filter(u => /^https?:/.test(u)).slice(0, 30).map(x => s(x, 2000)),
      from: ["extension", "mac", "upload"].includes(b.from) ? b.from : "web", uploads: [],
      ...(/^PR-\d{4}$/.test(b.target || "") ? { target: b.target } : {}),   // sent with "Add to this precedent"
    };
    const err = await addUploads(files, item, ups);
    if (err) return err;
    await box.setJSON(id, item);
    return json({ item });
  }

  if (req.method === "PATCH") {
    const { id, status, uploads } = await req.json().catch(() => ({}));
    const item = await box.get(String(id), { type: "json" });
    if (!item) return json({ error: "Not found" }, 404);
    if (Array.isArray(uploads)) {   // more photos for an item just sent (large batches go up in parts)
      item.uploads ||= [];
      const err = await addUploads(files, item, uploads);
      if (err) return err;
      await box.setJSON(item.id, item);
      return json({ item });
    }
    item.status = ["new", "approved", "discarded"].includes(status) ? status : "new";
    item.status_by = userName(req);
    await box.setJSON(item.id, item);
    return json({ item });
  }

  if (req.method === "DELETE") {
    const id = String(new URL(req.url).searchParams.get("id") || "");
    const item = await box.get(id, { type: "json" });
    for (const u of item?.uploads || []) await files.delete(u.key);
    await box.delete(id);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
});

export const config = { path: "/api/inbox" };
