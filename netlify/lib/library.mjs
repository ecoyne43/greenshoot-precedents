// The library file (precedents.json in the data repo): { records: [...] }. One record per precedent.
import { readJSON, writeJSON, DATA_PATH, tidy } from "./server.mjs";
import { FACETS, TEXT_FIELDS, STATUS, SCALE, IMAGE_TYPES, ID_PREFIX, aliasFacets, aliasRecord, isFirstPeoples } from "./vocab.mjs";

export async function readLibrary() {
  const { data, sha } = await readJSON(DATA_PATH(), { records: [] });
  const records = (Array.isArray(data?.records) ? data.records : []).map(aliasRecord);
  return { records, sha };
}

export async function writeLibrary(records, sha, message) {
  try {
    return await writeJSON(DATA_PATH(), { records }, sha, message + "\n\nCommitted via Groundworked Precedents");
  } catch (e) {
    if (e.conflict) throw Object.assign(new Error("Someone else changed the library just now. Try again."), { status: 409 });
    throw e;
  }
}

export function nextId(records) {
  const n = records.reduce((m, r) => Math.max(m, +String(r.id || "").split("-")[1] || 0), 0) + 1;
  return `${ID_PREFIX}-${String(n).padStart(4, "0")}`;
}

const list = (v, allowed) => {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  const out = [];
  for (const x of arr) {
    const s = tidy(String(x));
    if (!s) continue;
    const hit = allowed ? allowed.find(a => a.toLowerCase() === s.toLowerCase()) : s;
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
};
const pick = (v, allowed) => allowed.find(a => a.toLowerCase() === String(v || "").toLowerCase()) || "";

// Clean a record from the browser or from Claude: known fields only, facet values only from the lists (pass the
// lists with the team's added values, from getFacets()).
export function cleanRecord(r = {}, facets = FACETS) {
  r = aliasRecord(r);
  const o = {};
  for (const f of TEXT_FIELDS) o[f.key] = tidy(String(r[f.key] ?? "")).slice(0, f.long ? 6000 : 400);
  o.status = pick(r.status, STATUS) || "Built";
  o.scale = pick(r.scale, SCALE);
  o.facets = {};
  const given = aliasFacets(r.facets || {});
  for (const f of facets) o.facets[f.key] = list(given[f.key], f.values);
  // The exact materials and finishes, as written ("Corten steel", "Spotted gum"): any value.
  o.material_details = list(r.material_details).map(x => x.slice(0, 60)).slice(0, 20);
  // full: the whole write-up; short: facts, a sentence or two, images and categories. Older records are full.
  o.depth = r.depth === "short" ? "short" : r.depth === "full" ? "full" : (r.depth === "auto" ? (isFirstPeoples({ ...r, facets: o.facets }) ? "full" : "short") : "full");
  o.tags = list(r.tags).map(t => t.toLowerCase()).slice(0, 30);
  o.sources = list(r.sources).slice(0, 30);
  o.greenshoot_project = !!r.greenshoot_project;
  o.used_in = list(r.used_in).slice(0, 30);
  o.sensitive = !!r.sensitive;
  o.sensitive_note = tidy(String(r.sensitive_note || "")).slice(0, 1000);
  o.images = (Array.isArray(r.images) ? r.images : []).slice(0, 24).map(i => ({
    id: String(i.id || ""), key: String(i.key || ""), thumb_key: String(i.thumb_key || ""),
    image_type: pick(i.image_type, IMAGE_TYPES) || "Photo", caption: tidy(String(i.caption || "")).slice(0, 400),
    credit: tidy(String(i.credit || "")).slice(0, 300), source_url: String(i.source_url || "").slice(0, 2000),
    primary: !!i.primary,
  })).filter(i => i.key);
  if (o.images.length && !o.images.some(i => i.primary)) o.images[0].primary = true;
  return o;
}

// Possible duplicates of a draft: same or very similar name, or same designer and city.
const norm = s => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
const words = s => new Set(norm(s).split(" ").filter(w => w.length > 2));
function overlap(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
export function findDuplicates(draft, records, aiMatches = []) {
  const out = [];
  const add = (r, why) => { if (r && !out.some(x => x.id === r.id)) out.push({ id: r.id, name: r.name, why }); };
  // Groundwork's own judgement first (it reads the whole library while drafting), then simple name and place checks.
  for (const m of aiMatches) add(records.find(r => r.id === m.id), m.reason || "Groundwork thinks it's the same project");
  const names = r => [r.name, r.also_known_as].filter(Boolean);
  const samePlace = r => (draft.city && norm(r.city) === norm(draft.city)) || overlap(r.location_text, draft.location_text) >= 0.6;
  for (const r of records) {
    const best = Math.max(0, ...names(r).flatMap(a => names(draft).map(b => overlap(a, b))));
    if (norm(r.name) && norm(r.name) === norm(draft.name)) add(r, "Same name");
    else if (best >= 0.75) add(r, "Similar name");
    else if (best >= 0.5 && samePlace(r)) add(r, "Similar name, same place");
    else if (draft.architect && norm(r.architect) === norm(draft.architect) && samePlace(r)) add(r, "Same designer and place");
  }
  return out.slice(0, 5);
}

// One short line per record, for Groundwork to spot a send that's already in the library.
export const shortLine = r => `${r.id} | ${r.name}${r.also_known_as ? ` (also ${r.also_known_as})` : ""} | ${r.location_text || [r.city, r.state, r.country].filter(Boolean).join(", ")} | ${[r.architect, r.landscape_architect, r.artists].filter(Boolean).join("; ")}`;

// A short line per record for Claude to search over (Ask the library, Find similar).
export function indexLine(r) {
  const facets = [...Object.values(r.facets || {}).flat(), ...(r.material_details || [])].join(", ");
  const place = [r.city, r.state, r.country].filter(Boolean).join(", ");
  const who = [r.architect, r.landscape_architect, r.artists].filter(Boolean).join("; ");
  return `${r.id} | ${r.name} | ${place} | ${r.country_to || ""} | ${r.year_completed || ""} | ${who} | ${facets} | ${(r.tags || []).join(", ")} | ${(r.summary || "").slice(0, 260)}`;
}

export const attribution = (r, by, approver) => {
  const now = new Date().toISOString().slice(0, 10);
  return { ...r, added_by: r.added_by || by, approved_by: approver, added: r.added || now, updated: now };
};

// The whole record as text, for Claude to check (Check and fill online).
export function recordText(r = {}) {
  const lines = TEXT_FIELDS.map(f => `${f.key} (${f.label}): ${r[f.key] || "(empty)"}`);
  lines.push(`status: ${r.status || "(empty)"}`, `scale: ${r.scale || "(empty)"}`);
  lines.push(`depth: ${r.depth === "short" ? "short (facts and one or two sentences, no long write-up)" : "full"}`);
  for (const f of FACETS) lines.push(`categories, ${f.label}: ${(r.facets?.[f.key] || []).join("; ") || "(none)"}`);
  lines.push(`specific materials: ${(r.material_details || []).join(", ") || "(none)"}`);
  lines.push(`tags: ${(r.tags || []).join(", ") || "(none)"}`, `sources: ${(r.sources || []).join(" | ") || "(none)"}`);
  const caps = (r.images || []).map(i => i.caption).filter(Boolean);
  if (caps.length) lines.push(`image captions: ${caps.join(" | ")}`);
  return lines.join("\n");
}
