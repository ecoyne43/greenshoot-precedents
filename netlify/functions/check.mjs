// POST /api/check { record, notes }  Check and fill online, step 2: compares every field of the record with the
// research notes and with the record's own text, and proposes changes field by field, each with a reason and source.
// Returns { summary, changes: [{ field, current, value, reason, source }], add_facets, add_tags, add_sources, caveats }.
import { requireAuth, json, handle, claude } from "../lib/server.mjs";
import { CHECK_RULES, CHECK_SCHEMA } from "../lib/prompts.mjs";
import { recordText } from "../lib/library.mjs";
import { FACETS, STATUS, SCALE } from "../lib/vocab.mjs";

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { record = {}, notes = "" } = await req.json().catch(() => ({}));
  const content = `RECORD\n${recordText(record)}\n\nRESEARCH NOTES\n${String(notes).slice(0, 20000) || "(none: the web search found nothing or was not run)"}\n\nCheck the record.`;
  const out = await claude({ system: CHECK_RULES, content, schema: CHECK_SCHEMA, maxTokens: 5000 });
  const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const changes = (out.changes || [])
    .filter(c => c.value && !same(c.value, record[c.field]))
    .filter(c => (c.field === "status" ? STATUS.includes(c.value) : c.field === "scale" ? SCALE.includes(c.value) : true))
    .filter((c, i, a) => a.findIndex(x => x.field === c.field) === i)
    .map(c => ({ ...c, current: record[c.field] || "" }));
  const add_facets = {};
  for (const f of FACETS) {
    const have = record.facets?.[f.key] || [];
    const add = (out.add_facets?.[f.key] || []).filter(v => f.values.includes(v) && !have.includes(v));
    if (add.length) add_facets[f.key] = add;
  }
  const add_tags = (out.add_tags || []).map(t => t.toLowerCase().trim()).filter(t => t && !(record.tags || []).includes(t));
  const add_sources = (out.add_sources || []).filter(s => s && !(record.sources || []).includes(s));
  return json({ summary: out.summary || "", changes, add_facets, add_tags, add_sources, caveats: out.caveats || "" });
});

export const config = { path: "/api/check" };
