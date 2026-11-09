// Instagram posts: Precedents can't read Instagram from the server (it only shows posts to people who are logged in),
// so the extension does it in the sender's own browser. It steps through a carousel slide by slide, takes the
// full-size image from each one (only from that post), plus the caption, account and location tag. The images are
// downloaded and shrunk right away and sent as files, because Instagram's image links stop working after a few days.

export const IG_HOSTS = ["instagram.com"];   // tests add their own
export const isIgPost = href => {
  try {
    const u = new URL(href);
    return IG_HOSTS.some(h => u.hostname === h || u.hostname.endsWith("." + h)) && /\/(p|reel|tv)\/[\w-]+/.test(u.pathname);
  } catch { return false; }
};
export const cleanPostUrl = href => { const u = new URL(href); const m = u.pathname.match(/^.*?\/(p|reel|tv)\/[\w-]+\/?/); return u.origin + (m ? m[0] : u.pathname); };

// Runs inside the Instagram page (it must not use anything from outside this function).
export async function igGrab() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const dialog = document.querySelector('div[role="dialog"]');
  const root = (dialog && (dialog.querySelector("article") || dialog)) || document.querySelector("main article") || document.querySelector("main") || document.body;
  const isPhoto = i => { const r = i.getBoundingClientRect(); return (i.naturalWidth >= 300 || r.width >= 250) && !/profile picture|photo de profil/i.test(i.alt || ""); };
  const best = i => {
    let u = i.currentSrc || i.src, w = 0;
    for (const part of (i.srcset || "").split(/,\s+(?=\S)/)) { const [s, d] = part.trim().split(/\s+/); const n = parseFloat(d) || 0; if (s && n > w) { w = n; u = s; } }
    try { return new URL(u, location.href).href; } catch { return ""; }
  };
  const first = [...root.querySelectorAll("img")].find(isPhoto);   // the post's own picture comes before "more posts"
  if (!first) return null;
  const list = first.closest("ul");                                // a carousel's slides sit in one list
  const box = first.closest("article") || (list || first).parentElement?.parentElement?.parentElement?.parentElement || root;
  const out = [];
  const take = () => (list ? [...list.querySelectorAll("img")] : [first]).filter(isPhoto)
    .forEach(i => { const u = best(i); if (u && /^https?:/.test(u) && !out.includes(u)) out.push(u); });
  const NEXT = /^(next|suivant|weiter|siguiente|volgende|avanti|próximo|seguinte|neste|nästa|dalej)$/i;
  const nextBtn = () => [...box.querySelectorAll('button, [role="button"]')].find(b => b.offsetParent !== null && NEXT.test((b.getAttribute("aria-label") || "").trim()));
  const here = location.href.split("?")[0];
  take();
  for (let n = 0; list && n < 24; n++) {                             // up to 20 slides, with room for slow loading
    const b = nextBtn();
    if (!b) break;
    b.click();
    await wait(450);
    if (location.href.split("?")[0] !== here) break;              // that arrow went to the next post: stop
    take();
  }
  const pick = sel => box.querySelector(sel) || root.querySelector(sel);
  const meta = n => document.querySelector(`meta[property="${n}"]`)?.content || "";
  const acc = (pick('header a[href^="/"]')?.getAttribute("href") || "").split("/").filter(Boolean)[0]
    || (meta("og:description").match(/-\s+([\w.]+)\s+on\s/) || [])[1] || "";
  const caption = (pick("h1")?.innerText || meta("og:description").replace(/^[^:]*:\s*/, "").replace(/^"|"$/g, "")).trim();
  const place = (pick('a[href*="/explore/locations/"]')?.innerText || "").trim();
  return { images: out.slice(0, 20), account: acc, caption: caption.slice(0, 5000), place };
}

// Download an image (the extension may, Instagram's servers allow it) and shrink it to a JPEG of at most 2000 px.
export async function imageFile(src) {
  const res = await fetch(src, { credentials: "omit" });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 0.85 })).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: "data:image/jpeg;base64," + btoa(bin), src, w: c.width, h: c.height };
}

// Everything for the send window, or null if this doesn't look like a post after all.
export async function igData(tab) {
  let g = null;
  try { [{ result: g }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: igGrab }); } catch { /* fall back */ }
  if (!g?.images?.length) return null;
  const files = [];
  for (let i = 0; i < g.images.length; i += 4) {
    const got = await Promise.allSettled(g.images.slice(i, i + 4).map(imageFile));
    got.forEach(r => r.status === "fulfilled" && files.push(r.value));
  }
  if (!files.length) return null;
  const who = g.account ? `@${g.account}` : "";
  const credit = who ? `${who}, Instagram` : "Instagram";
  files.forEach(f => { f.credit = credit; });
  return {
    url: cleanPostUrl(tab.url), title: who ? `${who} on Instagram` : "Instagram post", site: "Instagram", author: who, date: "",
    text: [g.place && `Location tag: ${g.place}`, g.caption].filter(Boolean).join("\n\n"), images: [], files,
    found: g.images.length,
  };
}
