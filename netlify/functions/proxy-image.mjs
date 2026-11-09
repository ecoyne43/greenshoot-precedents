// GET /api/proxy-image?url=...[&t=token]  Fetches an image from another website so the browser can shrink it before
// saving, or show it in the image picker when the site blocks showing it directly.
import { requireAuth, json, checkToken } from "../lib/server.mjs";
import { fetchImage } from "../lib/fetchimage.mjs";

export default async (req) => {
  // The password header, or the image token (so the image picker can show images that won't load straight from their site).
  if (!checkToken(new URL(req.url).searchParams.get("t"))) { const denied = requireAuth(req); if (denied) return denied; }
  try {
    const { buf, type } = await fetchImage(new URL(req.url).searchParams.get("url"));
    return new Response(buf, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
  } catch (e) { return json({ error: e.message }, e.status || 500); }
};
export const config = { path: "/api/proxy-image" };
