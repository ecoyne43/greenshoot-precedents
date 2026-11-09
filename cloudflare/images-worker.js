// Precedents images: a Cloudflare Worker in front of an R2 bucket. Paste this whole file into a new Worker in the
// Cloudflare dashboard (see cloudflare/README.md). Viewers load images straight from here (no Netlify traffic, and
// Cloudflare doesn't charge for R2 downloads); the Precedents site uploads here.
//   GET  /<key>?t=<IMAGE_TOKEN>                      an image (the token is the one the site puts in image addresses)
//   PUT  /<key>  Authorization: Bearer <UPLOAD_SECRET>   store an image (only the Precedents site knows the secret)
// Settings the Worker needs: an R2 bucket binding called IMAGES, and two secrets, IMAGE_TOKEN and UPLOAD_SECRET.

const KEY = /^(PR-\d{4}|up)\/img_[a-z0-9]+(_t)?\.jpg$/;

function same(a, b) {   // compare without leaking timing
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const key = decodeURIComponent(url.pathname.slice(1));
    const cors = { "access-control-allow-origin": "*" };
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-methods": "GET" } });
    if (!KEY.test(key)) return new Response("Not found", { status: 404, headers: cors });

    if (req.method === "PUT") {
      if (!same(req.headers.get("authorization") || "", `Bearer ${env.UPLOAD_SECRET}`)) return new Response("Not authorised", { status: 401 });
      await env.IMAGES.put(key, req.body, { httpMetadata: { contentType: "image/jpeg" } });
      return new Response("Stored", { status: 201 });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (!same(url.searchParams.get("t") || "", env.IMAGE_TOKEN)) return new Response("Not authorised", { status: 401, headers: cors });
    const obj = await env.IMAGES.get(key);
    if (!obj) return new Response("Not found", { status: 404, headers: cors });
    return new Response(req.method === "HEAD" ? null : obj.body, {
      headers: { ...cors, "content-type": "image/jpeg", "content-length": String(obj.size), "cache-control": "private, max-age=31536000, immutable", etag: obj.httpEtag },
    });
  },
};
