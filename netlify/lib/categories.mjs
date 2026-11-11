// The category lists the team has added to (categories.json in the data repo, next to precedents.json):
// { added: { materials: [{ value, by, at }], medium: [...] } }. The base lists are in vocab.mjs. Read on most
// requests, so it is kept in memory for a short while.
import { readJSON, writeJSON, tidy } from "./server.mjs";
import { FACETS, withAdded } from "./vocab.mjs";

const PATH = () => process.env.CATEGORIES_PATH || "categories.json";
let cache = null, cachedAt = 0;

export async function readCategories(fresh = false) {
  if (!fresh && cache && Date.now() - cachedAt < 30000) return cache;
  const { data, sha } = await readJSON(PATH(), { added: {} });
  cache = { added: data?.added || {}, sha }; cachedAt = Date.now();
  return cache;
}

export async function getFacets() {
  try { return withAdded((await readCategories()).added); } catch { return withAdded({}); }
}

export async function changeValue(facet, value, by, remove = false) {
  const f = FACETS.find(x => x.key === facet);
  if (!f) throw Object.assign(new Error("No such category"), { status: 400 });
  value = tidy(String(value || "")).replace(/\s+/g, " ").slice(0, 60);
  if (!value) throw Object.assign(new Error("Give the new value a name"), { status: 400 });
  const { added, sha } = await readCategories(true);
  const list = [...(added[facet] || [])];
  const all = withAdded(added).find(x => x.key === facet).values;
  if (remove) {
    if (f.values.includes(value)) throw Object.assign(new Error("Values in the base list can only be changed in the code"), { status: 400 });
    added[facet] = list.filter(x => (x.value || x) !== value);
  } else {
    const same = all.find(v => v.toLowerCase() === value.toLowerCase());
    if (same) return { facets: withAdded(added), value: same };
    added[facet] = [...list, { value, by: by || "", at: new Date().toISOString() }];
  }
  await writeJSON(PATH(), { added }, sha, `${remove ? "Remove" : "Add"} ${f.label}: ${value}${by ? ` (${by})` : ""}\n\nCommitted via Groundworked Precedents`);
  cache = null;
  return { facets: withAdded(added), value };
}
