// POST /api/ask  AI search over the library.
//   { question }        Ask the library: "timber shelters with weaving patterns near water"
//   { similar: id }     Find similar to a precedent
//   { brief }           Find precedents for a project brief (pasted text)
// Returns { summary, results: [{ id, reason }] }, best first, ids only from the library.
import { requireAuth, json, handle, claude } from "../lib/server.mjs";
import { readLibrary, indexLine } from "../lib/library.mjs";
import { ASK_RULES, ASK_SCHEMA, SIMILAR_RULES } from "../lib/prompts.mjs";

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { question, similar, brief } = await req.json().catch(() => ({}));
  const { records } = await readLibrary();
  if (!records.length) return json({ summary: "The library is empty so far.", results: [] });

  let ask, rules = ASK_RULES, pool = records;
  if (similar) {
    const r = records.find(x => x.id === similar);
    if (!r) return json({ error: "Not found" }, 404);
    rules = SIMILAR_RULES;
    pool = records.filter(x => x.id !== r.id);
    ask = `PRECEDENT:\n${indexLine(r)}\nWhy it matters: ${r.why_it_matters || ""}`;
  } else if (brief) {
    rules = SIMILAR_RULES;
    ask = `PROJECT BRIEF:\n${String(brief).slice(0, 6000)}`;
  } else {
    if (!String(question || "").trim()) return json({ error: "Ask a question" }, 400);
    ask = `REQUEST: ${String(question).slice(0, 1000)}`;
  }
  const index = pool.map(indexLine).join("\n");
  const out = await claude({ system: rules, content: `${ask}\n\nLIBRARY INDEX:\n${index}`, schema: ASK_SCHEMA, maxTokens: 3000 });
  const ids = new Set(pool.map(r => r.id));
  const results = (out.results || []).filter(x => ids.has(x.id)).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).slice(0, 12);
  return json({ summary: out.summary || "", results });
});

export const config = { path: "/api/ask" };
