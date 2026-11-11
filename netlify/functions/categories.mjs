// /api/categories  The category lists, and adding to them (anyone on the team).
//   GET                          -> { facets }  (base lists plus added values, with who added them)
//   POST   { facet, value }      add a value (e.g. a new Materials group). Returns { facets, value }.
//   DELETE { facet, value }      remove an added value, if no precedent uses it.
import { requireAuth, json, handle, userName } from "../lib/server.mjs";
import { getFacets, changeValue } from "../lib/categories.mjs";
import { readLibrary } from "../lib/library.mjs";

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method === "GET") return json({ facets: await getFacets() });
  const { facet, value } = await req.json().catch(() => ({}));
  if (req.method === "POST") return json(await changeValue(facet, value, userName(req)));
  if (req.method === "DELETE") {
    const { records } = await readLibrary();
    const n = records.filter(r => (r.facets?.[facet] || []).includes(value)).length;
    if (n) return json({ error: `${n} precedent${n === 1 ? " uses" : "s use"} it. Take it off ${n === 1 ? "that one" : "those"} first.` }, 409);
    return json(await changeValue(facet, value, userName(req), true));
  }
  return json({ error: "Method not allowed" }, 405);
});

export const config = { path: "/api/categories" };
