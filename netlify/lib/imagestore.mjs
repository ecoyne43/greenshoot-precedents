// Where precedent images live. With IMAGES_URL set (the Cloudflare Worker in cloudflare/images-worker.js, in front of
// an R2 bucket), images are stored at Cloudflare and viewers load them straight from there: no Netlify bandwidth or
// credits for looking at or downloading images. Without it, they live in Netlify Blobs (store "images") and are
// served by /api/img, as before. Keys look like "PR-0003/img_xxx.jpg" or "up/img_xxx.jpg" (+ "_t" thumbnails).
import { env, imageToken } from "./server.mjs";
import { store } from "./blobs.mjs";

export const LIB_KEY = /^(PR-\d{4}|up)\/img_[a-z0-9]+(_t)?\.jpg$/;
const base = () => (env("IMAGES_URL") || "").replace(/\/+$/, "");
export const remoteOn = () => !!base() && !!env("IMAGES_UPLOAD_SECRET");

// The address pages use for an image (pages add nothing else): Cloudflare when it's set up.
export const imageBase = () => (remoteOn() ? base() : "");
export const remoteUrl = key => `${base()}/${key}?t=${imageToken()}`;

const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);

export async function putImage(key, buf) {
  if (!LIB_KEY.test(key)) throw new Error("Bad image key");
  if (!remoteOn()) return store("images").set(key, ab(buf));
  const res = await fetch(`${base()}/${key}`, {
    method: "PUT", body: buf,
    headers: { authorization: `Bearer ${env("IMAGES_UPLOAD_SECRET")}`, "content-type": "image/jpeg" },
  });
  if (!res.ok) throw Object.assign(new Error(`Image storage refused the upload (${res.status})`), { status: 502 });
}

// The image bytes (for Groundwork to look at), from wherever it is.
export async function getImage(key) {
  if (!LIB_KEY.test(key)) return null;
  if (remoteOn()) {
    const res = await fetch(remoteUrl(key));
    if (res.ok) return await res.arrayBuffer();
  }
  return await store("images").get(key, { type: "arrayBuffer" });   // not yet copied across, or no Cloudflare
}
