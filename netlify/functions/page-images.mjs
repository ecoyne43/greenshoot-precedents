// GET /api/page-images?url=...  Every likely photo on a web page, for the image picker ("Get images" when adding to a
// precedent, and "Add images from a link" in the inbox). Returns { url, title, site, images: [url...] }.
// Some sites refuse to be read by anything but a browser; then the picker suggests the extension instead.
import { requireAuth, json, handle, safeUrl, BROWSER_HEADERS } from "../lib/server.mjs";
import { pageMeta, pageImages } from "../lib/pagemeta.mjs";

export default handle(async (req) => {
  const denied = requireAuth(req);
  if (denied) return denied;
  const u = safeUrl(new URL(req.url).searchParams.get("url"));
  if (!u) return json({ error: "That isn't a web address" }, 400);
  if (/(^|\.)instagram\.com$/.test(u.hostname)) return json({ error: "Instagram only shows posts to people who are logged in. Open the post and click the Precedents button in your browser: it collects every slide", instagram: true }, 422);
  let res;
  try {
    res = await fetch(u.href, { headers: { ...BROWSER_HEADERS, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
  } catch { return json({ error: "That page didn't answer" }, 502); }
  if (!res.ok) return json({ error: `That site won't let Groundwork read the page (${res.status})`, blocked: true }, 502);
  const type = res.headers.get("content-type") || "";
  if (type.startsWith("image/")) return json({ url: u.href, title: "", site: u.hostname, images: [u.href] });   // a link straight to an image
  if (!type.includes("html")) return json({ error: "That link isn't a web page or an image" }, 415);
  const html = (await res.text()).slice(0, 4_000_000);
  const meta = pageMeta(html, res.url || u.href);
  const head = [meta.images[0]].filter(Boolean);
  return json({ url: res.url || u.href, title: meta.title, site: meta.site, images: pageImages(html, res.url || u.href, 80, head) });
});

export const config = { path: "/api/page-images" };
