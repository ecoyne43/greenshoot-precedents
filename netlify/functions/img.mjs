// GET /api/img?k=<key>&t=<token>  A stored library photo (store "images") or an inbox upload (store "inbox-files").
// The token stands in for the password, because <img> tags cannot send headers.
import { store } from "../lib/blobs.mjs";
import { checkToken } from "../lib/server.mjs";

const LIB = /^(PR-\d{4}|up)\/img_[a-z0-9]+(_t)?\.jpg$/, INBOX = /^\d{14}_[a-f0-9]{6}_\d{1,2}\.(jpg|png)$/;

export default async (req) => {
  const q = new URL(req.url).searchParams;
  if (!checkToken(q.get("t"))) return new Response("Not authorised", { status: 401 });
  const k = q.get("k") || "";
  const name = LIB.test(k) ? "images" : INBOX.test(k) ? "inbox-files" : null;
  if (!name) return new Response("Bad key", { status: 400 });
  const data = await store(name).get(k, { type: "arrayBuffer" });
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(data, { headers: { "content-type": k.endsWith(".png") ? "image/png" : "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
};
export const config = { path: "/api/img" };
