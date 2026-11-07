// POST /api/check { record, notes }  Check and fill online, step 2: compares every field of the record with the
// research notes and with the record's own text, and proposes changes field by field, each with a reason and source.
// Streams Claude's JSON answer back (a long check would otherwise time out, error 504); the page tidies the answer
// (tidyCheck in public/app.js): drops changes that change nothing and category values not in the lists.
// Answer: { summary, changes: [{ field, value, reason, source }], add_facets, add_tags, add_sources, caveats }.
import { requireAuth, json, streamJSON } from "../lib/server.mjs";
import { CHECK_RULES, CHECK_SCHEMA } from "../lib/prompts.mjs";
import { recordText } from "../lib/library.mjs";

export default async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { record = {}, notes = "" } = await req.json().catch(() => ({}));
  const content = `RECORD\n${recordText(record)}\n\nRESEARCH NOTES\n${String(notes).slice(0, 12000) || "(none: the web search found nothing or was not run)"}\n\nCheck the record.`;
  return streamJSON({ system: CHECK_RULES, content, schema: CHECK_SCHEMA, maxTokens: 4000 });
};

export const config = { path: "/api/check" };
