// GET /api/proxy-image?url=...  Fetches an image from another website so the browser can shrink it before saving.
import { requireAuth, json } from "../lib/server.mjs";
import { fetchImage } from "../lib/fetchimage.mjs";

export default async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { buf, type } = await fetchImage(new URL(req.url).searchParams.get("url"));
    return new Response(buf, { headers: { "content-type": type, "cache-control": "no-store" } });
  } catch (e) { return json({ error: e.message }, e.status || 500); }
};
export const config = { path: "/api/proxy-image" };
