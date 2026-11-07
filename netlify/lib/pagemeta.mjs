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

  const images = [];
  const addImg = u => { const a = abs(u, pageUrl); if (a && /^https?:/.test(a) && !images.includes(a)) images.push(a); };
  [meta["og:image"], meta["og:image:url"], meta["twitter:image"], meta["twitter:image:src"], urlOf(pick("contentUrl")), urlOf(pick("image")), urlOf(pick("thumbnailUrl"))]
    .filter(Boolean).forEach(addImg);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (images.length >= 12) break;
    const src = attr(m[0], "data-src") || attr(m[0], "src");
    const w = +attr(m[0], "width") || 0, h = +attr(m[0], "height") || 0;
    if (!src || src.startsWith("data:") || /logo|icon|sprite|avatar|badge|spacer/i.test(src)) continue;
    if ((w && w < 150) || (h && h < 120)) continue;
    addImg(src);
  }

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
