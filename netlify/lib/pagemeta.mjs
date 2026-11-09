// Reads what a web page says about itself: title, author, date, rights, images and readable text, from its meta
// tags, JSON-LD and body. No dependencies; tolerant of messy HTML. Used to fill in photo credits and inbox items.

const decode = s => String(s ?? "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : "";
};

const abs = (u, base) => { try { return new URL(u, base).href; } catch { return ""; } };

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1].trim());
      const walk = x => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { out.push(x); if (x["@graph"]) walk(x["@graph"]); } };
      walk(v);
    } catch { /* ignore broken JSON-LD */ }
  }
  return out;
}

const nameOf = v => (Array.isArray(v) ? v.map(nameOf).filter(Boolean).join("; ") : v && typeof v === "object" ? (v.name || v["@id"] || "") : String(v ?? ""));
const urlOf = v => (Array.isArray(v) ? urlOf(v[0]) : v && typeof v === "object" ? (v.contentUrl || v.url || "") : String(v ?? ""));

// Every likely photo on a page, largest version where the page offers several: the page's own picks (og:image and
// so on), then <img> (srcset, lazy-loading attributes), <picture> sources, links straight to image files (gallery
// "view full size" links), background images, and image addresses in the page's scripts (many galleries keep their
// photos there). Logos, icons and tracking pixels are left out; tiny images are hidden later by the picker.
export function pageImages(html, pageUrl, max = 80, first = []) {
  const out = [], seen = new Set();
  const JUNK = /logo|icon|sprite|avatar|badge|spacer|pixel|tracking|emoji|favicon|placeholder|blank\.(gif|png)|loader|spinner|\/ads?\//i;
  const add = u => {
    if (!u || out.length >= max) return;
    const a = abs(decode(String(u)).trim().replace(/\\\//g, "/"), pageUrl);
    if (!a || !/^https?:/.test(a) || /\.svg(\?|#|$)/i.test(a) || JUNK.test(a)) return;
    // Same picture at another size (WordPress "-1024x683", query strings) counts once.
    const k = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(a) ? a.replace(/[?#].*$/, "").replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, "") : a;
    if (seen.has(k)) return;
    seen.add(k); out.push(a);
  };
  const largest = set => {
    let best = "", bw = -1;
    for (const part of String(set || "").split(/,\s+(?=\S)/)) {
      const [u, d] = part.trim().split(/\s+/);
      const w = d ? parseFloat(d) * (/x$/.test(d) ? 1000 : 1) : 1;
      if (u && w > bw) { bw = w; best = u; }
    }
    return best;
  };
  first.filter(Boolean).forEach(add);
  // A thumbnail linked to its full-size image: take the full size, in the thumbnail's place.
  html = html.replace(/<a\b[^>]*href=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["'][^>]*>([\s\S]{0,3000}?)<\/a>/gi,
    (all, href, inner) => /<img\b/i.test(inner) ? `<img src="${href}">` : all);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const t = m[0];
    const w = +attr(t, "width") || 0, h = +attr(t, "height") || 0;
    if ((w && w < 150) || (h && h < 120)) continue;
    add(largest(attr(t, "data-srcset") || attr(t, "srcset")) || attr(t, "data-full") || attr(t, "data-large") || attr(t, "data-original")
      || attr(t, "data-lazy-src") || attr(t, "data-src") || attr(t, "src"));
  }
  for (const m of html.matchAll(/<source\b[^>]*>/gi)) add(largest(attr(m[0], "data-srcset") || attr(m[0], "srcset")));
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) add(m[1]);
  // Gallery data in scripts: site-relative image paths in quotes ("/media/a.jpg", JSON-escaped "\/media\/a.jpg").
  for (const sc of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
    for (const m of sc[1].matchAll(/["']((?:\\?\/)(?!\\?\/)[^"'\s<>()]+?\.(?:jpe?g|png|webp))["']/gi)) add(m[1]);
  for (const m of html.matchAll(/https?:(?:\\?\/){2}[^"'\s<>()]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s<>()]*)?(?=["'\s<>)])/gi)) add(m[0]);
  return out;
}

export function pageMeta(html, pageUrl) {
  const meta = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    const key = (attr(t, "property") || attr(t, "name") || attr(t, "itemprop")).toLowerCase();
    const content = attr(t, "content");
    if (key && content && !(key in meta)) meta[key] = content;
  }
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/\s+/g, " ").trim();
  const licenseLink = (html.match(/<(?:link|a)\b[^>]*rel=["'][^"']*license[^"']*["'][^>]*>/i) || [])[0];
  const ld = jsonLd(html);
  const pick = (...keys) => { for (const o of ld) for (const k of keys) if (o[k]) return o[k]; return ""; };

  const images = pageImages(html, pageUrl, 40, [meta["og:image"], meta["og:image:url"], meta["twitter:image"], meta["twitter:image:src"],
    urlOf(pick("contentUrl")), urlOf(pick("image")), urlOf(pick("thumbnailUrl"))]);

  const text = decode(html
    .replace(/<(script|style|noscript|svg|nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|dd|dt)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 9000);

  return {
    url: pageUrl,
    title: meta["og:title"] || meta["twitter:title"] || nameOf(pick("name", "headline")) || title,
    site: meta["og:site_name"] || meta["application-name"] || new URL(pageUrl).hostname.replace(/^www\./, ""),
    description: meta["og:description"] || meta.description || nameOf(pick("description")),
    author: meta.author || meta["article:author"] || meta.citation_author || meta["dc.creator"] || meta["dcterms.creator"] || nameOf(pick("creator", "author")),
    date: meta["article:published_time"] || meta.citation_date || meta["dc.date"] || meta["dcterms.created"] || nameOf(pick("dateCreated", "datePublished", "temporalCoverage")),
    rights: meta["dc.rights"] || meta["dcterms.rights"] || meta.rights || meta.copyright || nameOf(pick("license", "copyrightNotice", "usageInfo")) || (licenseLink ? attr(licenseLink, "href") : ""),
    identifier: meta["dc.identifier"] || meta.citation_id || nameOf(pick("identifier")),
    images,
    text,
  };
}
