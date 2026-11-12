// POST /api/draft { id }  Groundwork drafts a precedent record from an inbox item: reads the web page, looks at the
// images, fills the fields, picks categories only from the lists and checks the library for duplicates.
// The draft is saved on the item (item.draft) so the next person to open it sees the same thing.
import { requireAuth, json, handle, claude, safeUrl, BROWSER_HEADERS, userName } from "../lib/server.mjs";
import { store } from "../lib/blobs.mjs";
import { pageMeta } from "../lib/pagemeta.mjs";
import { readLibrary, cleanRecord, findDuplicates, shortLine } from "../lib/library.mjs";
import { draftRules, draftSchema } from "../lib/prompts.mjs";
import { getFacets } from "../lib/categories.mjs";
import { isFirstPeoples } from "../lib/vocab.mjs";
import { fetchImage } from "../lib/fetchimage.mjs";
import { nameFromFile } from "../lib/filename.mjs";

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

  // Images: the sender's uploads, then the images they ticked (in the picker, extension or bookmark button); only if
  // they ticked none, the page's own. Groundwork looks at up to 8 to caption and type them, but everything the sender
  // chose stays on the list, however large (the browser shrinks images when they're approved).
  const picked = (item.images || []).filter((v, i, a) => a.indexOf(v) === i);
  const chosen = [...(item.uploads || []).map(x => ({ key: x.key, type: x.type, mine: true, credit: x.credit, src: x.src, caption: x.caption, image_type: x.image_type })), ...picked.map(url => ({ url, mine: true }))];
  const cands = chosen.length ? chosen : (meta?.images || []).map(url => ({ url }));
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

  const ownCount = (item.uploads || []).filter(x => !x.credit).length;
  const fileNames = [...new Set((item.uploads || []).map(u => nameFromFile(u.name)).filter(Boolean))];
  if (!item.title && !item.url && fileNames.length) item.title = fileNames.join("; ").slice(0, 300);   // items sent before titles came from file names
  const text = [
    item.url && `PAGE: ${item.url}`, (meta?.title || item.title) && `TITLE: ${meta?.title || item.title}`,
    (meta?.site || item.site) && `SITE: ${meta?.site || item.site}`, (meta?.author || item.author) && `AUTHOR: ${meta?.author || item.author}`,
    (meta?.date || item.date) && `DATE: ${meta?.date || item.date}`, meta?.description && `PAGE DESCRIPTION: ${meta.description}`,
    item.note && `NOTE FROM ${item.by || "the sender"}: ${item.note}`,
    item.text && (item.from === "document"
      ? `TEXT FROM THE DOCUMENT "${item.title || "the document"}" (a PowerPoint or PDF the sender added; it is the main source):\n${item.text.slice(0, 15000)}`
      : `TEXT THE SENDER HIGHLIGHTED:\n${item.text.slice(0, 8000)}`),
    meta?.text && `PAGE TEXT:\n${meta.text.slice(0, 9000)}`,
    ownCount && `The first ${ownCount} image(s) are the sender's own photos or screenshots.`,
    fileNames.length && `IMAGE FILE NAMES, as the sender saved them: ${fileNames.map(n => `"${n}"`).join("; ")}. People usually name files after the project, often with the designer after a dash ("Project Name - Designer"). Treat a descriptive file name as the project's name (and designer) unless the images clearly contradict it.`,
    item.site === "Instagram" && `This came from an Instagram post: the caption is the account's own words, so treat claims in it with care.`,
    `There are ${seen.length} image(s), in order.`,
  ].filter(Boolean).join("\n\n");

  const [{ records }, F] = await Promise.all([readLibrary(), getFacets()]);
  const library = records.length ? `\n\nLIBRARY (already in it):\n${records.map(shortLine).join("\n").slice(0, 200000)}` : "\n\nLIBRARY: (empty)";
  const details = [...new Set(records.flatMap(r => r.material_details || []))].slice(0, 400);
  const detailText = `\n\nEXISTING SPECIFIC MATERIALS: ${details.join("; ") || "(none yet)"}`;
  const content = [
    ...seen.map(i => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })),
    { type: "text", text: text + (chosen.length ? "\n\nThe sender chose these images themselves." : "") + library + detailText + "\n\nDraft the precedent record." },
  ];
  const out = await claude({ system: draftRules(F), content, schema: draftSchema(F), maxTokens: 6000, feature: "draft", user: userName(req) });

  // Full write-up for First Peoples precedents and Greenshoot projects; a short record for the rest (the reviewer can
  // switch it). A short record never keeps a long write-up Groundwork wrote anyway.
  const greenshoot = /greenshoot/i.test(`${item.note} ${out.first_peoples_collaborators} ${out.other_team} ${out.architect}`);
  const record = cleanRecord({ ...out, greenshoot_project: false, depth: isFirstPeoples(out) || greenshoot ? "full" : "short" }, F);
  if (record.depth === "short") { record.why_it_matters = ""; record.description = ""; }
  if (item.url && !record.sources.some(x => x.includes(item.url))) record.sources.unshift(`${meta?.title || item.title || item.url}, ${item.url}`);
  item.draft = {
    record,
    images: [...seen.map((c, n) => ({
      ...(c.key ? { key: c.key } : { url: c.url }),
      image_type: out.images?.[n]?.image_type || "Photo", caption: out.images?.[n]?.caption || "",
      credit: c.credit || out.images?.[n]?.credit || (c.key ? item.by : meta?.site || item.site || ""),
      keep: c.mine || out.images?.[n]?.keep !== false, source_url: c.src || c.url || item.url || "",
    })),
    // What the sender chose but Groundwork didn't look at (too large, or over 8): kept, with plain defaults.
    ...chosen.filter(c => !seen.some(x => (x.key && x.key === c.key) || (x.url && x.url === c.url))).map(c => ({
      ...(c.key ? { key: c.key } : { url: c.url }), image_type: c.image_type || "Photo", caption: c.caption || "",
      credit: c.credit || (c.key ? item.by : meta?.site || item.site || ""), keep: true, source_url: c.src || c.url || item.url || "",
    }))],
    duplicates: item.target ? [] : findDuplicates(record, records, (out.same_as || []).filter(m => m.id !== item.target)),
    confidence: out.confidence || "medium", notes: out.notes || "",
    // New list values Groundwork thinks are needed (the reviewer can add them with one click).
    suggest: (out.suggest_values || []).filter(x => F.some(f => f.key === x.facet) && x.value
      && !F.find(f => f.key === x.facet).values.some(v => v.toLowerCase() === String(x.value).toLowerCase())).slice(0, 3),
    read_page: !!meta, drafted: new Date().toISOString(),
  };
  await box.setJSON(item.id, item);
  return json({ item });
});

export const config = { path: "/api/draft" };
