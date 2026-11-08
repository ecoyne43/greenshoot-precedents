// POST /api/merge { target: record, incoming: record, note, text, url }  Adding new material to a precedent that's
// already in the library: Groundwork reads the existing record and the new material (the draft made from what was
// sent) and proposes changes, each with a reason, in the same shape as Check and fill. Streamed (long descriptions).
import { requireAuth, json, streamJSON } from "../lib/server.mjs";
import { MERGE_RULES, CHECK_SCHEMA } from "../lib/prompts.mjs";
import { recordText } from "../lib/library.mjs";

export default async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { target = {}, incoming = {}, note = "", text = "", url = "" } = await req.json().catch(() => ({}));
  if (!target.name) return json({ error: "No existing precedent given" }, 400);
  const content = `EXISTING RECORD (${target.id || ""})\n${recordText(target)}\n\nNEW MATERIAL${url ? ` from ${url}` : ""}\n${recordText(incoming)}`
    + `${note ? `\n\nSENDER'S NOTE: ${String(note).slice(0, 2000)}` : ""}${text ? `\n\nHIGHLIGHTED TEXT:\n${String(text).slice(0, 8000)}` : ""}\n\nPropose the changes.`;
  return streamJSON({ system: MERGE_RULES, content, schema: CHECK_SCHEMA, maxTokens: 5000 });
};

export const config = { path: "/api/merge" };
