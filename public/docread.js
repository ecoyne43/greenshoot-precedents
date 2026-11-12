// Reading a PowerPoint (.pptx) or PDF in the browser: every slide or page's text, and its images. No AI and nothing
// uploaded: only the images and text someone picks are sent on. Used by "Add from a document" (Add page) and the
// document box in "Add to this precedent".
//   readDocument(file, onProgress) -> { name, kind: "pptx" | "pdf", pages: [{ n, title, text }], images: [{ id, page,
//     blob, name, w, h, repeated }] }
// PowerPoint images come out as the original files (full size, uncropped). PDF pages come out as page pictures.

const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

// A minimal zip reader (a .pptx is a zip of XML files and media). Deflated entries are unpacked by the browser.
async function unzip(buf) {
  const dv = new DataView(buf), bytes = new Uint8Array(buf), dec = new TextDecoder();
  let e = buf.byteLength - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("That file isn't a PowerPoint (.pptx) file. Older .ppt files need saving as .pptx first");
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
    entries.set(name, async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = bytes.slice(start, start + size);
      if (method === 0) return raw;
      if (method !== 8) throw new Error("Unsupported compression in the file");
      const out = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(out).arrayBuffer());
    });
    p += 46 + nl + xl + cl;
  }
  return entries;
}

const xml = s => new DOMParser().parseFromString(s, "application/xml");
const textOf = async (zip, name) => (zip.has(name) ? new TextDecoder().decode(await zip.get(name)()) : "");
const resolve = (base, target) => {
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
  return parts.join("/");
};
const rels = async (zip, file) => {
  const relName = file.replace(/([^/]+)$/, "_rels/$1.rels"), map = {};
  const doc = xml(await textOf(zip, relName));
  for (const r of doc.getElementsByTagName("Relationship")) map[r.getAttribute("Id")] = { target: resolve(file, r.getAttribute("Target") || ""), type: r.getAttribute("Type") || "" };
  return map;
};
const dims = async blob => { try { const b = await createImageBitmap(blob); const d = { w: b.width, h: b.height }; b.close?.(); return d; } catch { return { w: 0, h: 0 }; } };

async function readPptx(file, onProgress) {
  const zip = await unzip(await file.arrayBuffer());
  // Slide order comes from the presentation, not the file names.
  const pres = xml(await textOf(zip, "ppt/presentation.xml")), presRels = await rels(zip, "ppt/presentation.xml");
  let order = [...pres.getElementsByTagName("p:sldId")].map(s => presRels[s.getAttribute("r:id")]?.target).filter(Boolean);
  if (!order.length) order = [...zip.keys()].filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const pages = [], images = [], seen = new Map();
  for (const [i, path] of order.entries()) {
    onProgress?.(`Reading slide ${i + 1} of ${order.length}...`);
    const doc = xml(await textOf(zip, path)), r = await rels(zip, path);
    const paras = [...doc.getElementsByTagName("a:p")].map(p => [...p.getElementsByTagName("a:t")].map(t => t.textContent).join("")).map(s => s.trim()).filter(Boolean);
    let title = "";
    for (const sp of doc.getElementsByTagName("p:sp")) {
      const ph = sp.getElementsByTagName("p:ph")[0];
      if (ph && /title/i.test(ph.getAttribute("type") || "")) { title = [...sp.getElementsByTagName("a:t")].map(t => t.textContent).join(" ").trim(); break; }
    }
    pages.push({ n: i + 1, title: title || paras[0] || "", text: paras.join("\n") });
    for (const blip of doc.getElementsByTagName("a:blip")) {
      const rel = r[blip.getAttribute("r:embed")];
      if (!rel) continue;
      const ext = (rel.target.split(".").pop() || "").toLowerCase();
      if (!IMAGE_TYPES[ext] || !zip.has(rel.target)) continue;            // drawings in EMF/WMF/TIFF are skipped
      if (seen.has(rel.target)) { seen.get(rel.target).uses++; continue; }
      const blob = new Blob([await zip.get(rel.target)()], { type: IMAGE_TYPES[ext] });
      const im = { id: `s${i + 1}_${images.length}`, page: i + 1, blob, name: `${file.name.replace(/\.[^.]+$/, "")} slide ${i + 1}.${ext}`, uses: 1, ...(await dims(blob)) };
      seen.set(rel.target, im); images.push(im);
    }
  }
  // An image on many slides is usually a logo or a background.
  images.forEach(im => { im.repeated = im.uses >= 3; });
  return { name: file.name, kind: "pptx", pages, images };
}

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "/vendor/pdfjs-3.11.174/pdf.min.js"; s.onload = ok; s.onerror = () => bad(new Error("Couldn't load the PDF reader")); document.head.append(s); });
  pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs-3.11.174/pdf.worker.min.js";
  return pdfjs;
}

async function readPdf(file, onProgress) {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [], images = [], max = Math.min(pdf.numPages, 80);
  for (let i = 1; i <= max; i++) {
    onProgress?.(`Reading page ${i} of ${max}...`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map(t => t.str + (t.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim();
    pages.push({ n: i, title: text.split("\n")[0]?.slice(0, 120) || "", text });
    // The page as a picture, about 1600 px across.
    const vp1 = page.getViewport({ scale: 1 }), scale = Math.min(3, 1600 / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.85));
    images.push({ id: `p${i}`, page: i, blob, name: `${file.name.replace(/\.[^.]+$/, "")} page ${i}.jpg`, w: c.width, h: c.height, uses: 1, repeated: false, pageImage: true });
  }
  return { name: file.name, kind: "pdf", pages, images, truncated: pdf.numPages > max ? pdf.numPages : 0 };
}

export const isDocument = f => /\.(pptx|pdf)$/i.test(f?.name || "") || /presentationml|pdf/.test(f?.type || "");

export async function readDocument(file, onProgress) {
  if (/\.ppt$/i.test(file.name)) throw new Error("That's an older .ppt file. Open it in PowerPoint and save it as .pptx first");
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return readPdf(file, onProgress);
  return readPptx(file, onProgress);
}

// The document's text for Groundwork: each slide or page with its number, up to about 15,000 characters.
export function documentText(doc) {
  let out = "";
  for (const p of doc.pages) {
    if (!p.text) continue;
    const block = `[${doc.kind === "pdf" ? "Page" : "Slide"} ${p.n}] ${p.text}\n\n`;
    if (out.length + block.length > 15000) { out += `[...the rest of the ${doc.kind === "pdf" ? "pages" : "slides"} left out for length]`; break; }
    out += block;
  }
  return out.trim();
}
