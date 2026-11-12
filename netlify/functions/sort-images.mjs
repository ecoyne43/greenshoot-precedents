// POST /api/sort-images { images: [base64 JPEG, small], project, context }  "Let Groundwork pick": which images pulled
// out of a document are pictures of the project (not logos, backgrounds, text slides...). Streamed (up to 40 images).
// Returns Claude's stream: { images: [{ keep, image_type, caption }] } in the same order.
import { requireAuth, json, streamJSON, userName } from "../lib/server.mjs";
import { SORT_RULES, SORT_SCHEMA } from "../lib/prompts.mjs";

export default async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { images = [], project = "", context = "" } = await req.json().catch(() => ({}));
  const ims = images.filter(x => typeof x === "string" && x.length < 400_000).slice(0, 40);
  if (!ims.length) return json({ error: "No images" }, 400);
  const content = [
    ...ims.map(data => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
    { type: "text", text: `${project ? `PROJECT: ${String(project).slice(0, 200)}\n` : ""}DOCUMENT: ${String(context).slice(0, 3000)}\n\nThere are ${ims.length} images, in order. Sort them.` },
  ];
  return streamJSON({ system: SORT_RULES, content, schema: SORT_SCHEMA, maxTokens: 3000, feature: "sort", user: userName(req) });
};

export const config = { path: "/api/sort-images" };
