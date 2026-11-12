// POST /api/research { record, images? }  Check and fill online, step 1: Groundwork searches the web for the
// precedent and streams back short sourced notes. The page then sends the notes to /api/check, which compares them
// with every field of the record. Nothing changes until the reviewer ticks the changes they want.
// images: up to 3 of the record's pictures ({ key } inbox upload or library image, or { url }), so Groundwork can
// see them; this is how a precedent sent as just an image gets identified.
import { requireAuth, json, streamWithSearch, userName } from "../lib/server.mjs";
import { RESEARCH_RULES } from "../lib/prompts.mjs";
import { recordText } from "../lib/library.mjs";
import { store } from "../lib/blobs.mjs";
import { getImage, LIB_KEY } from "../lib/imagestore.mjs";
import { fetchImage } from "../lib/fetchimage.mjs";
import { reverseImageSearch } from "../lib/vision.mjs";

const OK = ["image/jpeg", "image/png", "image/gif", "image/webp"];

async function load(im) {
  try {
    if (im.key) {
      const buf = LIB_KEY.test(im.key) ? await getImage(im.key) : await store("inbox-files").get(im.key, { type: "arrayBuffer" });
      return buf ? { buf, type: im.key.endsWith(".png") ? "image/png" : "image/jpeg" } : null;
    }
    if (im.url) return await fetchImage(im.url);
  } catch { /* skip */ }
  return null;
}

export default async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { record = {}, images = [], quick = false } = await req.json().catch(() => ({}));
  const pics = [];
  for (const im of images.slice(0, 3)) {
    const got = await load(im);
    if (got && OK.includes(got.type) && got.buf.byteLength < 3_500_000) pics.push(got);
  }
  if (!record.name && !record.location_text && !(record.sources || []).length && !pics.length) {
    return json({ error: "The record needs a name, place, source or image first" }, 400);
  }
  // No web page to go on: ask Google where else this image appears (reverse image search), if it's set up.
  const hasPage = (record.sources || []).some(x => /https?:\/\//.test(x));
  const reverse = !hasPage && pics.length ? await reverseImageSearch(pics[0].buf) : "";
  const content = [
    ...pics.map(p => ({ type: "image", source: { type: "base64", media_type: p.type, data: Buffer.from(p.buf).toString("base64") } })),
    { type: "text", text: `RECORD\n${recordText(record)}\n\n${pics.length ? `The ${pics.length} image(s) above are of this precedent. If the record doesn't say clearly which project it is, use what you can see (signage, landmarks, setting, distinctive forms) and search to identify it.\n\n` : ""}${reverse ? `REVERSE IMAGE SEARCH (Google, for the first image):\n${reverse}\n\nUse these leads, but confirm the match before relying on it.\n\n` : ""}Research this precedent.` },
  ];
  // quick: a second, shorter try when the first ran out of time without any notes.
  return streamWithSearch({ system: RESEARCH_RULES, content, maxUses: quick ? 3 : 5, feature: "research", user: userName(req) });
};

export const config = { path: "/api/research" };
