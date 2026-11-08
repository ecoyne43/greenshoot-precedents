// POST /api/draft { id }  Groundwork drafts a precedent record from an inbox item: reads the web page, looks at the
// images, fills the fields, picks categories only from the lists and checks the library for duplicates.
// The draft is saved on the item (item.draft) so the next person to open it sees the same thing.
import { requireAuth, json, handle, claude, safeUrl, BROWSER_HEADERS } from "../lib/server.mjs";
import { store } from "../lib/blobs.mjs";
import { pageMeta } from "../lib/pagemeta.mjs";
import { readLibrary, cleanRecord, findDuplicates, shortLine } from "../lib/library.mjs";
import { DRAFT_RULES, DRAFT_SCHEMA } from "../lib/prompts.mjs";
import { fetchImage } from "../lib/fetchimage.mjs";

const OK_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_IMG = 3_500_000, MAX_IMAGES = 8;

async function readPage(href) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(href, { headers: { ...BROWSER_HEADERS, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: ctl.signal });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") || "").includes("html")) return null;
    return pageMeta((await res.text()).slice(0, 3_000_000), res.url || href);
  } catch { return null; } finally { clearTimeout(timer); }
}

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { id } = await req.json().catch(() => ({}));
  const box = store("inbox"), files = store("inbox-files");
  const item = await box.get(String(id), { type: "json" });
  if (!item) return json({ error: "Not found" }, 404);

  const u = safeUrl(item.url);
  const meta = u ? await readPage(u.href) : null;

  // Images: the sender's uploads first, then the images they picked on the page, then the page's own.
  const cands = [...(item.uploads || []).map(x => ({ key: x.key, type: x.type })),
    ...[...(item.images || []), ...(meta?.images || [])].filter((v, i, a) => a.indexOf(v) === i).map(url => ({ url }))];
  const seen = [];
  for (const c of cands) {
    if (seen.length >= MAX_IMAGES) break;
    try {
      let buf, type;
      if (c.key) { buf = await files.get(c.key, { type: "arrayBuffer" }); type = c.type; }
      else ({ buf, type } = await fetchImage(c.url));
      if (!buf || buf.byteLength > MAX_IMG || !OK_TYPES.includes(type)) continue;
      seen.push({ ...c, data: Buffer.from(buf).toString("base64"), type });
    } catch { /* skip images that cannot be fetched */ }
  }

  const text = [
    item.url && `PAGE: ${item.url}`, (meta?.title || item.title) && `TITLE: ${meta?.title || item.title}`,
    (meta?.site || item.site) && `SITE: ${meta?.site || item.site}`, (meta?.author || item.author) && `AUTHOR: ${meta?.author || item.author}`,
    (meta?.date || item.date) && `DATE: ${meta?.date || item.date}`, meta?.description && `PAGE DESCRIPTION: ${meta.description}`,
    item.note && `NOTE FROM ${item.by || "the sender"}: ${item.note}`,
    item.text && `TEXT THE SENDER HIGHLIGHTED:\n${item.text.slice(0, 8000)}`,
    meta?.text && `PAGE TEXT:\n${meta.text.slice(0, 9000)}`,
    (item.uploads || []).length && `The first ${(item.uploads || []).length} image(s) are the sender's own photos or screenshots.`,
    `There are ${seen.length} image(s), in order.`,
  ].filter(Boolean).join("\n\n");

  const { records } = await readLibrary();
  const library = records.length ? `\n\nLIBRARY (already in it):\n${records.map(shortLine).join("\n").slice(0, 60000)}` : "\n\nLIBRARY: (empty)";
  const content = [
    ...seen.map(i => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })),
    { type: "text", text: text + library + "\n\nDraft the precedent record." },
  ];
  const out = await claude({ system: DRAFT_RULES, content, schema: DRAFT_SCHEMA, maxTokens: 6000 });

  const record = cleanRecord(out);
  if (item.url && !record.sources.some(x => x.includes(item.url))) record.sources.unshift(`${meta?.title || item.title || item.url}, ${item.url}`);
  item.draft = {
    record,
    images: seen.map((c, n) => ({
      ...(c.key ? { key: c.key } : { url: c.url }),
      image_type: out.images?.[n]?.image_type || "Photo", caption: out.images?.[n]?.caption || "",
      credit: out.images?.[n]?.credit || (c.key ? item.by : meta?.site || item.site || ""),
      keep: out.images?.[n]?.keep !== false, source_url: c.url || item.url || "",
    })),
    duplicates: item.target ? [] : findDuplicates(record, records, (out.same_as || []).filter(m => m.id !== item.target)),
    confidence: out.confidence || "medium", notes: out.notes || "",
    read_page: !!meta, drafted: new Date().toISOString(),
  };
  await box.setJSON(item.id, item);
  return json({ item });
});

export const config = { path: "/api/draft" };
