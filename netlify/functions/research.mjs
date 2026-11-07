// POST /api/research { record }  Fill gaps online: Groundwork searches the web for what the record is missing and
// streams its work back; it ends with a JSON object the page reads (see readWebAnswer in public/app.js).
// Nothing changes until the reviewer chooses "Use this".
import { requireAuth, json, streamWithSearch } from "../lib/server.mjs";
import { FILL_RULES } from "../lib/prompts.mjs";
import { TEXT_FIELDS, FACETS } from "../lib/vocab.mjs";

export default async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { record: r = {} } = await req.json().catch(() => ({}));
  if (!r.name) return json({ error: "The record needs a name first" }, 400);
  const lines = TEXT_FIELDS.map(f => `${f.label} (${f.key}): ${r[f.key] || "(missing)"}`);
  const facets = FACETS.map(f => `${f.label}: ${(r.facets?.[f.key] || []).join(", ") || "(none)"}`);
  const content = `RECORD\n${lines.join("\n")}\n${facets.join("\n")}\nSources: ${(r.sources || []).join("; ") || "(none)"}\n\nFill the gaps.`;
  return streamWithSearch({ system: FILL_RULES, content, maxUses: 6 });
};

export const config = { path: "/api/research" };
