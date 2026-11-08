// POST /api/save  Puts a record into the library (one commit to precedents.json in the data repo).
//   { record, inboxId?, targetId?, newImages: [{ key, thumb_key, image_type, caption, credit, source_url, primary }] }
//   - from the inbox, new precedent:      inboxId, no targetId     -> new id, "Add PR-0012 ..."
//   - from the inbox, add to an existing: inboxId and targetId     -> "Update PR-0004 ... (from inbox)"
//   - edit in the library:                targetId, no inboxId     -> "Edit PR-0004 ..."
// newImages were already uploaded one by one with /api/upload (keys "up/img_....jpg" in Blobs "images").
// Every save records who sent it (added_by) and who approved or edited it (approved_by / edited_by).
import { requireAuth, json, handle, userName } from "../lib/server.mjs";
import { store } from "../lib/blobs.mjs";
import { readLibrary, writeLibrary, cleanRecord, nextId } from "../lib/library.mjs";

const UP = /^up\/img_[a-z0-9]+\.jpg$/;

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const me = userName(req);
  const body = await req.json().catch(() => ({}));
  const rec = cleanRecord(body.record || {});
  if (!rec.name) return json({ error: "Give the precedent a name" }, 400);

  const box = store("inbox");
  const item = body.inboxId ? await box.get(String(body.inboxId), { type: "json" }) : null;
  if (body.inboxId && !item) return json({ error: "That inbox item is gone" }, 404);

  const { records, sha } = await readLibrary();
  const old = body.targetId ? records.find(r => r.id === body.targetId) : null;
  if (body.targetId && !old) return json({ error: `${body.targetId} is not in the library` }, 404);
  const id = old ? old.id : nextId(records);

  // New images were uploaded one at a time first (/api/upload); here they are only attached to the record.
  const added = (Array.isArray(body.newImages) ? body.newImages : []).slice(0, 20)
    .filter(im => UP.test(im.key || "") && im.thumb_key === String(im.key).replace(/\.jpg$/, "_t.jpg"))
    .map(im => ({ id: im.key.slice(3, -4), key: im.key, thumb_key: im.thumb_key, image_type: im.image_type, caption: im.caption, credit: im.credit, source_url: im.source_url, primary: !!im.primary }));

  const today = new Date().toISOString().slice(0, 10);
  const images = cleanRecord({ name: "x", images: [...rec.images, ...added] }).images;
  if (added.some(i => i.primary)) images.forEach(i => { i.primary = added.find(a => a.primary)?.key === i.key; });
  const out = {
    id, ...rec, images,
    added_by: old?.added_by || item?.by || me,
    approved_by: old?.approved_by || me,
    added: old?.added || today,
    updated: today,
    ...(old ? { edited_by: me } : {}),
    history: [...(old?.history || []), { date: today, by: me, what: !old ? `added (sent by ${item?.by || me})` : item ? `updated from inbox (sent by ${item.by})` : "edited" }].slice(-30),
  };
  const next = old ? records.map(r => (r.id === id ? out : r)) : [...records, out];
  const verb = !old ? "Add" : item ? "Update" : "Edit";
  const msg = `${verb} ${id} ${out.name.slice(0, 60)}\n\n${!old ? `Sent by ${out.added_by}, approved by ${me}` : `By ${me}`}`;
  const res = await writeLibrary(next, sha, msg);

  if (item) {
    item.status = "approved"; item.status_by = me; item.record_id = id; item.merged = !!old;
    await box.setJSON(item.id, item);
  }
  return json({ record: out, commitUrl: res.commitUrl });
});

export const config = { path: "/api/save" };
