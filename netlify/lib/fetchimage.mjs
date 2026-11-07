// Fetch an image from another website (public addresses only).
import { safeUrl, BROWSER_HEADERS } from "./server.mjs";

const MAX = 8_000_000;

export async function fetchImage(href) {
  const u = safeUrl(href);
  if (!u) throw Object.assign(new Error("Not a usable image address"), { status: 400 });
  let res;
  try {
    res = await fetch(u.href, { headers: { ...BROWSER_HEADERS, accept: "image/avif,image/webp,image/*,*/*;q=0.5", referer: u.origin + "/" }, redirect: "follow" });
  } catch { throw Object.assign(new Error("The image could not be downloaded"), { status: 502 }); }
  if (!res.ok) throw Object.assign(new Error(`The image site returned ${res.status}`), { status: 502 });
  const type = (res.headers.get("content-type") || "").split(";")[0];
  if (!type.startsWith("image/")) throw Object.assign(new Error("That address is not an image"), { status: 415 });
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX) throw Object.assign(new Error("Image is larger than 8 MB"), { status: 413 });
  return { buf, type };
}

