// Local test server: serves public/, runs the Netlify functions, and fakes GitHub (a local folder), Netlify Blobs
// (a local folder) and Claude (canned answers). Also serves a fake project web page for testing the inbox.
//   node dev/mock-server.mjs [port]      password: test     data: dev/run/
import http from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +(process.argv[2] || 8899);
const RUN = process.env.RUN_DIR || join(ROOT, "dev/run");
mkdirSync(RUN, { recursive: true });
Object.assign(process.env, {
  APP_PASSWORD: "test", LOCAL_DATA_DIR: join(RUN, "data"), BLOBS_DIR: join(RUN, "blobs"), ALLOW_LOCAL_FETCH: "1",
  ANTHROPIC_API_KEY: "fake", ANTHROPIC_BASE_URL: `http://localhost:${PORT}/fake-claude`,
  GOOGLE_VISION_KEY: "fake", GOOGLE_VISION_URL: `http://localhost:${PORT}/fake-vision`,
  ...(process.env.NO_R2 ? {} : { IMAGES_URL: `http://localhost:${PORT}/fake-r2`, IMAGES_UPLOAD_SECRET: "upload-secret" }),
});

const ROUTES = { config: "config", library: "library", inbox: "inbox", draft: "draft", save: "save", ask: "ask",
  research: "research", check: "check", upload: "upload", merge: "merge", "move-images": "move-images", img: "img", "proxy-image": "proxy-image", "page-images": "page-images" };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };
export const claudeLog = [];

// ---------- fake Claude ----------
function fakeClaude(body) {
  const sys = body.system || "";
  const userText = (body.messages?.[0]?.content || []);
  const text = typeof userText === "string" ? userText : userText.filter(c => c.type === "text").map(c => c.text).join("\n");
  const nImages = typeof userText === "string" ? 0 : userText.filter(c => c.type === "image").length;
  claudeLog.push({ kind: sys.includes("Draft ONE") ? "draft" : sys.includes("Research a precedent") ? "research" : sys.includes("Check a precedent") ? "check" : "ask", nImages, text: text.slice(0, 8000) });
  if (body.stream) return null;
  let out;
  if (sys.includes("Draft ONE")) {
    out = {
      name: text.includes("PAGE:") || text.includes("HIGHLIGHTED") ? "Tidewater Weaving Pavilion" : "", also_known_as: "", location_text: "Foreshore Reserve, Port Sample VIC", city: "Port Sample",
      state: "VIC", country: "Australia", country_to: "", year_completed: "2024", architect: "Example Studio",
      landscape_architect: "", artists: "", first_peoples_collaborators: "", client: "Sample Shire Council", other_team: "", awards: "",
      summary: (text.includes("co-design test") ? "Co-designed by Greenshoot Consulting with Elders. " : "") + "A timber pavilion on a coastal foreshore whose roof screens draw on woven fish-trap forms. It gives shade and a gathering place beside a restored saltmarsh, with seating set around a central fire pit for community events and ceremony.",
      why_it_matters: "Shows how a woven pattern can become structure rather than surface decoration, and how a small shelter can hold both everyday use and ceremony.",
      description: "Completed in 2024 for the Sample Shire Council, the pavilion sits at the edge of a restored saltmarsh.",
      status: "Built", scale: "Building",
      facets: { project_type: ["Park + Open Space"], design_element: ["Shelter + Pavilion", "Screen", "Roof + Ceiling + Soffit"],
        cultural_expression: ["Pattern + Graphics"], dwc_themes: ["Gathering Place", "Ceremony"], environment: ["Wetlands"],
        materials: ["Timber", "Fibre + Weaving"], programme: ["Public Programs + Events"], involvement: ["Not documented"] },
      tags: ["fish trap", "fire pit", "coastal"], sources: [],
      images: Array.from({ length: nImages }, (_, n) => ({ image_type: n === 1 ? "Aerial" : n === 2 ? "Detail" : "Photo", caption: `View ${n + 1} of the pavilion`, keep: n !== 3, credit: "Example Studio" })),
      confidence: "medium", notes: "The page does not say who the Traditional Owners are or how they were involved.",
      same_as: text.includes("riverbend test") && text.includes("PR-0001 | Riverbend") ? [{ id: "PR-0001", reason: "Same pavilion, same reserve" }] : [],
    };
  } else if (sys.includes("ALREADY in")) {
    const desc = (text.match(/^description \([^)]*\): (.*)$/m) || [])[1] || "";
    out = { summary: "Adds site photos and the story of how the panels were made.", caveats: "",
      changes: [{ field: "description", value: (desc === "(empty)" ? "" : desc + "\n\n") + "Added context: the panels were made with community members in 2025.", reason: "The new page describes how they were made.", source: "new material" },
        { field: "awards", value: "Sample Award 2026", reason: "Listed on the new page.", source: "new material" }],
      add_facets: { dwc_themes: ["Relationships + Community Involvement"] }, add_tags: ["community making"], add_sources: [] };
  } else if (sys.includes("Check a precedent")) {
    const notes = text.split("RESEARCH NOTES")[1] || "";
    const empty = k => new RegExp(`^${k} \\([^)]*\\): \\(empty\\)`, "m").test(text);
    out = { summary: "Checked every field against two sources and the record's own text.", changes: [], add_facets: {}, add_tags: [], add_sources: [], caveats: "" };
    if (notes.includes("Sample Architecture Award") && empty("awards")) out.changes.push({ field: "awards", value: "Sample Architecture Award, Small Project, 2025", reason: "Listed on the awards page.", source: "https://example.org/awards" });
    if (/co-designed by Greenshoot/i.test(text) && empty("first_peoples_collaborators")) out.changes.push({ field: "first_peoples_collaborators", value: "Greenshoot Consulting (co-design)", reason: "The description says Greenshoot co-designed it.", source: "record text" });
    out.changes.push({ field: "architect", value: "Example Studio with Tidal Landscape", reason: "The practice page credits both.", source: "https://example.org/tidewater" });
    if (/^name \([^)]*\): \(empty\)/m.test(text)) out.changes.push({ field: "name", value: "Tidewater Weaving Pavilion", reason: "Identified from the image and a matching project page.", source: "https://example.org/tidewater" });
    out.add_facets = { environment: ["Climate + Resilience"] };
    out.add_sources = ["Example Studio project page, https://example.org/tidewater"];
  } else {
    const lines = text.split("LIBRARY INDEX:")[1]?.trim().split("\n") || [];
    const ask = (text.split("LIBRARY INDEX:")[0] || "").toLowerCase();
    const words = ask.replace(/[^a-z ]/g, " ").split(/\s+/).filter(w => w.length > 3 && !["request", "precedent", "brief", "project", "with", "that"].includes(w));
    const hits = lines.map(l => [l, words.filter(w => l.toLowerCase().includes(w)).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 4);
    out = { summary: hits.length ? `${hits.length} precedents fit, the first two most closely.` : "Nothing in the library fits that well.",
      results: hits.map(([l]) => ({ id: l.split(" | ")[0], reason: `Matches on ${words.filter(w => l.toLowerCase().includes(w)).slice(0, 3).join(", ")}.` })) };
  }
  return { content: [{ type: "text", text: JSON.stringify(out) }] };
}

function fakeFillStream(res) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = o => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
  ev({ type: "content_block_start", index: 0, content_block: { type: "server_tool_use", name: "web_search" } });
  ev({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "- Architect: Example Studio with Tidal Landscape (Example Studio, https://example.org/tidewater)\n" } });
  ev({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "- Won the Sample Architecture Award, Small Project, 2025 (Awards, https://example.org/awards)\n" } });
  ev({ type: "message_stop" });
  res.end();
}

// ---------- fake project page (for the inbox test) ----------
const FAKE_PAGE = `<!doctype html><html><head><title>Tidewater Weaving Pavilion / Example Studio</title>
<meta property="og:site_name" content="Sample Architecture News"><meta property="og:image" content="/fake-site/a.jpg"></head>
<body><h1>Tidewater Weaving Pavilion</h1><p>Example Studio has completed a timber pavilion on the foreshore at Port Sample, its roof screens drawing on woven fish-trap forms.</p>
<img src="/fake-site/a.jpg" width="1200" height="800"><img src="/fake-site/b.jpg" width="1200" height="800"><img src="/fake-site/c.jpg" width="1200" height="800"><img src="/fake-site/d.jpg" width="1200" height="800"></body></html>`;

// A gallery page laid out the ways real sites hide their photos: srcset, lazy loading, a link to the full size,
// a CSS background and gallery data in a script. Plus a logo the picker should tuck away.
const GALLERY_PAGE = `<!doctype html><html><head><title>Tidewater Weaving Pavilion, photo essay</title>
<meta property="og:site_name" content="Sample Landscape Review"></head><body>
<img src="/fake-site/logo.jpg" alt="Sample Landscape Review">
<h1>Tidewater Weaving Pavilion</h1>
<img src="/fake-site/g1-400.jpg" srcset="/fake-site/g1-400.jpg 400w, /fake-site/g1.jpg 1600w">
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/fake-site/g2.jpg" class="lazy">
<a href="/fake-site/g3.jpg"><img src="/fake-site/g3-400.jpg" width="400" height="267"></a>
<div class="hero" style="background-image: url('/fake-site/g4.jpg')"></div>
<script>window.gallery = {"slides":[{"src":"\\/fake-site\\/g5.jpg"}]};</script>
</body></html>`;

// ---------- server ----------
// ---------- fake Cloudflare: the real Worker (cloudflare/images-worker.js) over a folder standing in for R2 ----------
const R2DIR = join(RUN, "r2");
const r2 = {
  async get(key) {
    const p = join(R2DIR, encodeURIComponent(key));
    if (!existsSync(p)) return null;
    const body = readFileSync(p);
    return { body, size: body.length, httpEtag: '"' + body.length + '"' };
  },
  async put(key, body) {
    const chunks = []; for await (const c of body) chunks.push(Buffer.from(c));
    mkdirSync(R2DIR, { recursive: true }); writeFileSync(join(R2DIR, encodeURIComponent(key)), Buffer.concat(chunks));
  },
};
let worker;
export const r2Log = [];

const mods = {};
async function fn(name) { return (mods[name] ||= (await import(join(ROOT, "netlify/functions", name + ".mjs"))).default); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  // Like Netlify: requests over about 6 MB never reach the function (the browser sees "Failed to fetch").
  if (url.pathname.startsWith("/api/") && body.length > 6_000_000) return req.socket.destroy();
  try {
    if (url.pathname === "/fake-claude/v1/messages") {
      const b = JSON.parse(body.toString());
      if (b.stream && !(b.system || "").includes("Research a precedent")) {   // streamed JSON answer (Check and fill)
        const text = fakeClaude({ ...b, stream: false }).content[0].text;
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (let i = 0; i < text.length; i += 40) res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 40) } })}\n\n`);
        return res.end();
      }
      if (b.stream) { fakeClaude(b); return fakeFillStream(res); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(fakeClaude(b)));
    }
    if (url.pathname.startsWith("/fake-r2/")) {
      worker ||= (await import(join(ROOT, "cloudflare/images-worker.js"))).default;
      const { imageToken } = await import(join(ROOT, "netlify/lib/server.mjs"));
      const wreq = new Request("http://worker" + url.pathname.slice(8) + url.search, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body, duplex: "half" });
      const out = await worker.fetch(wreq, { IMAGES: r2, IMAGE_TOKEN: imageToken(), UPLOAD_SECRET: "upload-secret" });
      r2Log.push(`${req.method} ${out.status} ${url.pathname.slice(8)}`);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      if (out.body) res.write(Buffer.from(await out.arrayBuffer()));
      return res.end();
    }
    if (url.pathname === "/__r2") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(r2Log)); }
    if (url.pathname === "/fake-vision/v1/images:annotate") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ responses: [{ webDetection: { bestGuessLabels: [{ label: "tidewater weaving pavilion" }],
        webEntities: [{ description: "Pavilion", score: 0.7 }],
        pagesWithMatchingImages: [{ url: "https://example.org/tidewater", pageTitle: "Tidewater Weaving Pavilion | Example Studio" }] } }] }));
    }
    if (url.pathname === "/__claude") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(claudeLog)); }
    if (/^\/dev\/[a-z-]+-preview\.html$/.test(url.pathname)) { res.writeHead(200, { "content-type": "text/html" }); return res.end(readFileSync(join(ROOT, url.pathname.slice(1)))); }
    if (url.pathname === "/fake-site/gallery.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(GALLERY_PAGE); }
    if (url.pathname === "/fake-site/project.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(FAKE_PAGE); }
    if (url.pathname.startsWith("/fake-site/")) {
      const p = join(RUN, "fake-site", url.pathname.slice(11));
      if (existsSync(p)) { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(readFileSync(p)); }
    }
    const m = url.pathname.match(/^\/api\/([a-z-]+)$/);
    if (m && ROUTES[m[1]]) {
      const handler = await fn(ROUTES[m[1]]);
      const r = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
      const out = await handler(r);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      if (out.body) { for await (const c of out.body) res.write(c); }
      return res.end();
    }
    let p = join(ROOT, "public", url.pathname === "/" ? "index.html" : url.pathname);
    if (existsSync(p) && !p.endsWith("/")) { res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); return res.end(readFileSync(p)); }
    res.writeHead(404); res.end("not found");
  } catch (e) {
    console.error(e); res.writeHead(500); res.end(String(e.stack || e));
  }
}).listen(PORT, () => console.log(`Mock server on http://localhost:${PORT}`));
