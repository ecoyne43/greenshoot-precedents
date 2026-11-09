// Precedents for Mac: the floating search panel. Find a precedent by typing anything (name, place, designer,
// theme...), open it to see its images, and drag them straight into InDesign, PowerPoint or Finder, copy them, or
// download them into a project folder. Also sends screenshots to the inbox.
// The Precedents Mac app (mac-app/) shows this page and does what a web page can't: the floating window, the
// keyboard shortcuts, native drag and drop, downloads into ~/Downloads/Precedents, copying images, screenshots.
// Opened in an ordinary browser (for testing), the Mac-only parts fall back to simple versions.

const mac = window.webkit?.messageHandlers?.pr;
const post = (type, data = {}) => mac?.postMessage({ type, ...data });
const main = document.getElementById("main");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ls = { get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

let auth = { pw: ls.get("gp_pw"), name: ls.get("gp_name") };
let lib = { records: [], token: "" }, q = "", ask = null, openId = null, sel = 0, view = "search", pinned = false;
try { const c = JSON.parse(ls.get("gp_desk_cache") || "null"); if (c?.records) lib = c; } catch { /* no cache */ }

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-app-password": auth.pw, "x-user-name": encodeURIComponent(auth.name), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // The app's own answers are JSON ("Wrong password"). Anything else came from before the app, usually Netlify's
    // visitor protection (a Netlify login), which the browser gets past but this can't.
    const body = await res.json().catch(() => null);
    const msg = body?.error || (res.status === 401 || res.status === 403
      ? "Netlify is blocking this before it reaches the library (visitor protection is on). In Netlify: Project configuration > General > Visitor access: set production to no protection."
      : `The site answered with error ${res.status}`);
    throw Object.assign(new Error(msg), { status: res.status, ours: !!body?.error });
  }
  return res.json();
}

const abs = p => new URL(p, location.href).href;
// Library images straight from Cloudflare once it's set up (lib.imgBase), otherwise from the site.
const imgUrl = key => lib.imgBase ? `${lib.imgBase}/${key}?t=${lib.token}` : abs(`/api/img?k=${encodeURIComponent(key)}&t=${lib.token}`);
const place = r => [r.city, r.state, r.country].filter(Boolean).join(", ") || r.location_text || "";
const designers = r => [r.architect, r.landscape_architect, r.artists].filter(Boolean).join(" · ");
const primary = r => (r.images || []).find(i => i.primary) || (r.images || [])[0];
const hay = r => [r.id, r.name, r.also_known_as, r.location_text, r.city, r.state, r.country, r.country_to, r.year_completed,
  r.architect, r.landscape_architect, r.artists, r.first_peoples_collaborators, r.client, r.summary, r.description,
  ...Object.values(r.facets || {}).flat(), ...(r.tags || [])].join(" ").toLowerCase();
const safe = s => String(s || "").replace(/[\\/:*?"<>|#%]+/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
const folderFor = r => `${r.id} ${safe(r.name)}`;
const fileFor = (im, n) => `${String(n + 1).padStart(2, "0")} ${safe(im.image_type)}${im.caption ? " - " + safe(im.caption) : ""}.jpg`;

let tt;
function toast(html, ms = 2600) {
  const t = document.getElementById("toast");
  t.innerHTML = html; t.hidden = false;
  clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, ms);
  return t;
}

// ---------- start and refresh ----------
async function start() {
  if (!auth.pw || !auth.name) return showSettings();
  render();
  refresh();
}
async function refresh() {
  try {
    const [cfg, { records }] = await Promise.all([api("/api/config"), api("/api/library")]);
    lib = { records, token: cfg.token, imgBase: cfg.imgBase || "" };
    ls.set("gp_desk_cache", JSON.stringify(lib));
    if (view === "search") render(true);
  } catch (e) {
    if (e.status === 401) return showSettings(e.ours ? "The team password has changed. Enter the new one." : e.message);
    if (!lib.records.length) main.innerHTML = `<div class="empty bad">Couldn't reach the library: ${esc(e.message)}</div>`;
  }
}

function showSettings(msg = "") {
  view = "settings";
  main.innerHTML = `<form class="form" id="set">
    <p>Sign in once on this Mac with the team password for the Precedents site, and your name.</p>
    <label for="pw">Team password</label><input id="pw" type="password" value="${esc(auth.pw)}" required>
    <label for="nm">Your name</label><input id="nm" value="${esc(auth.name)}" required>
    <button class="btn primary">Save</button><p class="msg ${msg ? "bad" : ""}" id="smsg">${esc(msg)}</p></form>`;
  document.getElementById("pw").focus();
  document.getElementById("set").onsubmit = async e => {
    e.preventDefault();
    auth = { pw: document.getElementById("pw").value.trim(), name: document.getElementById("nm").value.trim() };
    try { await api("/api/config"); } catch (err) { const m = document.getElementById("smsg"); m.className = "msg bad"; m.textContent = err.message; return; }
    ls.set("gp_pw", auth.pw); ls.set("gp_name", auth.name);
    view = "search"; render(); refresh();
  };
}

// ---------- search ----------
function results() {
  if (ask?.results) return ask.results.map(x => ({ r: lib.records.find(r => r.id === x.id), why: x.reason })).filter(x => x.r);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = words.length
    ? lib.records.filter(r => { const h = hay(r); return words.every(w => h.includes(w)); })
      .sort((a, b) => Number(b.name.toLowerCase().includes(words[0])) - Number(a.name.toLowerCase().includes(words[0])))
    : [...lib.records].sort((a, b) => (b.updated || b.added || "").localeCompare(a.updated || a.added || ""));
  return list.slice(0, 50).map(r => ({ r }));
}

function render(keepFocus) {
  view = "search";
  const focused = document.activeElement?.id === "q", pos = document.getElementById("q")?.selectionStart;
  const list = results();
  sel = Math.min(sel, Math.max(0, list.length - 1));
  document.getElementById("count").textContent = lib.records.length ? `${lib.records.length}` : "";
  main.innerHTML = `
    <form class="search" id="sf">
      <div class="sbox"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg>
        <input id="q" type="search" placeholder="Find a precedent: name, place, designer, theme..." value="${esc(q)}" autocomplete="off" spellcheck="false"></div>
      <button class="ask" type="submit" title="Ask Groundwork in plain words (Command-Return)"><b>✦</b> Ask</button>
    </form>
    ${ask ? `<div class="askbox"><b>✦ Groundwork</b> ${ask.busy ? "Reading the library..." : esc(ask.error || ask.summary || "")} <a href="#" id="clr">Clear</a></div>` : ""}
    <div class="meta"><span>${ask ? `${list.length} suggested` : q ? `${list.length} found` : "Recently added and updated"}</span><span>${lib.records.length} in the library</span></div>
    <div id="list">${list.length ? list.map(({ r, why }, i) => row(r, why, i)).join("") : `<div class="empty">${lib.records.length ? "Nothing matches. Try other words, or ✦ Ask." : "Loading the library..."}</div>`}</div>`;
  const input = document.getElementById("q");
  input.oninput = () => { q = input.value; ask = null; sel = 0; openId = null; render(); };
  input.onkeydown = keys;
  if (focused || !keepFocus) { input.focus(); if (pos != null) input.setSelectionRange(pos, pos); }
  document.getElementById("sf").onsubmit = e => { e.preventDefault(); runAsk(); };
  document.getElementById("clr")?.addEventListener("click", e => { e.preventDefault(); ask = null; render(); });
  wire();
}

function row(r, why, i) {
  const p = primary(r), imgs = r.images || [], isOpen = openId === r.id;
  const themes = [...(r.facets?.project_type || []), ...(r.facets?.dwc_themes || [])].slice(0, 3).join(" · ");
  return `<div class="res ${isOpen ? "open" : ""} ${i === sel ? "sel" : ""}" data-i="${i}">
    <button class="row" data-row="${r.id}" data-i="${i}"><span class="th">${p ? `<img src="${esc(imgUrl(p.thumb_key))}" alt="" loading="lazy" draggable="false">` : ""}</span>
      <span class="rt"><b>${esc(r.name)}</b><span>${esc(place(r))}${r.year_completed ? ` · ${esc(r.year_completed)}` : ""}${designers(r) ? ` · ${esc(designers(r))}` : ""}</span>
      ${why ? `<span class="why">${esc(why)}</span>` : themes ? `<span class="tags">${esc(themes)}</span>` : ""}</span>
      <span class="n">${imgs.length} img</span><span class="chev"></span></button>
    ${isOpen ? `<div class="drop">
      ${r.summary ? `<p class="dsum">${esc(r.summary.length > 260 ? r.summary.slice(0, 260) + "..." : r.summary)}</p>` : ""}
      ${imgs.length ? `<div class="grid">${imgs.map((im, n) => `<div class="im">
          <img src="${esc(imgUrl(im.thumb_key))}" alt="${esc(im.caption)}" title="${esc(im.caption)}${im.credit ? " · Image: " + esc(im.credit) : ""}" data-img="${r.id}:${n}" draggable="true">
          <span class="ty">${esc(im.image_type)}</span>
          <span class="tools"><button data-copy="${r.id}:${n}" title="Copy image">⧉</button><button data-dl="${r.id}:${n}" title="Download">⬇</button></span>
        </div>`).join("")}</div>` : `<p class="dsum">No images yet.</p>`}
      <div class="acts">${imgs.length ? `<button class="btn primary" data-all="${r.id}">Download all (${imgs.length})</button>` : ""}
        <button class="btn" data-lib="${r.id}">Open in library ↗</button></div>
      ${imgs.some(i => i.credit) ? `<p class="credit">Images: ${esc([...new Set(imgs.map(i => i.credit).filter(Boolean))].join("; "))}. Check rights before using outside Greenshoot.</p>` : ""}
    </div>` : ""}
  </div>`;
}

function wire() {
  main.querySelectorAll("[data-row]").forEach(b => b.onclick = () => toggle(b.dataset.row, +b.dataset.i));
  main.querySelectorAll("[data-dl]").forEach(b => b.onclick = e => { e.stopPropagation(); const [id, n] = b.dataset.dl.split(":"); download(id, [+n]); });
  main.querySelectorAll("[data-copy]").forEach(b => b.onclick = e => { e.stopPropagation(); const [id, n] = b.dataset.copy.split(":"); copyImage(id, +n); });
  main.querySelectorAll("[data-all]").forEach(b => b.onclick = () => download(b.dataset.all));
  main.querySelectorAll("[data-lib]").forEach(b => b.onclick = () => openUrl(abs(`/#/p/${b.dataset.lib}`)));
  main.querySelectorAll("[data-img]").forEach(im => {
    const [id, n] = im.dataset.img.split(":");
    im.onclick = () => big(id, +n);
    im.ondragstart = e => dragOut(e, id, +n);
  });
}

function toggle(id, i) {
  openId = openId === id ? null : id;
  if (i != null) sel = i;
  render(true);
  if (openId) {
    const r = lib.records.find(x => x.id === id);
    // The Mac app fetches the full-size images now, so dragging them out is instant.
    post("prefetch", { items: (r.images || []).map((im, n) => ({ url: imgUrl(im.key), filename: `${folderFor(r)} ${fileFor(im, n)}` })) });
    main.querySelector(`.res[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

function keys(e) {
  const list = results();
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    sel = Math.max(0, Math.min(list.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
    main.querySelectorAll(".res").forEach(x => x.classList.toggle("sel", +x.dataset.i === sel));
    main.querySelector(`.res[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault(); runAsk();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (list[sel]) toggle(list[sel].r.id, sel);
  }
}

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const b = document.querySelector(".big");
  if (b) return b.remove();
  if (view !== "search") { render(); return; }
  if (openId) { openId = null; render(true); return; }
  if (q || ask) { q = ""; ask = null; sel = 0; render(); return; }
  post("hide");
});

async function runAsk() {
  const question = document.getElementById("q").value.trim();
  if (!question) return;
  ask = { busy: true }; openId = null; render(true);
  try { ask = await api("/api/ask", { question }); } catch (e) { ask = { error: `Couldn't ask: ${e.message}` }; }
  sel = 0; render(true);
}

// ---------- images: drag out, copy, download, view ----------
function dragOut(e, id, n) {
  if (!mac) return;   // in a browser, the browser's own drag
  e.preventDefault();
  const r = lib.records.find(x => x.id === id), im = r.images[n];
  post("drag", { url: imgUrl(im.key), filename: `${folderFor(r)} ${fileFor(im, n)}` });
}

function copyImage(id, n) {
  const r = lib.records.find(x => x.id === id), im = r.images[n];
  if (mac) return post("copy", { url: imgUrl(im.key) });
  fetch(imgUrl(im.key)).then(x => x.blob()).then(b => createImageBitmap(b).then(bmp => {
    const c = Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
    c.getContext("2d").drawImage(bmp, 0, 0);
    return new Promise(ok => c.toBlob(ok, "image/png"));
  })).then(png => navigator.clipboard.write([new ClipboardItem({ "image/png": png })])).then(() => toast("Image copied")).catch(() => toast("Couldn't copy here"));
}

function download(id, which) {
  const r = lib.records.find(x => x.id === id);
  const items = (r.images || []).map((im, n) => ({ url: imgUrl(im.key), filename: fileFor(im, n), n })).filter(x => !which || which.includes(x.n));
  if (mac) return post("download", { folder: folderFor(r), items: items.map(({ url, filename }) => ({ url, filename })) });
  for (const it of items) { const a = Object.assign(document.createElement("a"), { href: it.url, download: it.filename }); document.body.append(a); a.click(); a.remove(); }
}

function big(id, n) {
  const r = lib.records.find(x => x.id === id), im = r.images[n];
  const box = document.createElement("div");
  box.className = "big";
  box.innerHTML = `<img src="${esc(imgUrl(im.key))}" alt="" draggable="true"><p>${esc(im.caption)}${im.credit ? ` · Image: ${esc(im.credit)}` : ""}</p>
    <div class="acts"><button class="btn" id="bc">Copy</button><button class="btn primary" id="bd">Download</button><button class="btn" id="bx">Close</button></div>`;
  document.getElementById("shell").append(box);
  box.querySelector("img").ondragstart = e => dragOut(e, id, n);
  box.querySelector("#bc").onclick = () => copyImage(id, n);
  box.querySelector("#bd").onclick = () => download(id, [n]);
  box.querySelector("#bx").onclick = () => box.remove();
}

function openUrl(u) { if (mac) post("open", { url: u }); else window.open(u, "_blank"); }

// ---------- sending to the inbox: a screenshot, or images dropped or pasted onto the panel ----------
function showShot(item) {
  const images = item.images || (item.image ? [item.image] : []);
  if (!images.length) return;
  view = "shot";
  const src = item.title || item.windowTitle || item.app || "";
  main.innerHTML = `<form class="form" id="sendshot" style="max-width:none">
    <b>Send ${images.length > 1 ? `these ${images.length} images` : item.image ? "this screenshot" : "this image"} to the Precedents inbox</b>
    <div class="shots">${images.map(im => `<img class="shotprev" src="data:${im.type};base64,${im.data}" alt="">`).join("")}</div>
    ${src || item.url ? `<p class="msg">From ${esc(src)}${item.url ? ` · ${esc(item.url)}` : ""}</p>` : ""}
    <label for="sn">Note <em class="msg">which project is it? Optional: Groundwork tries to work it out</em></label>
    <textarea id="sn" rows="2" placeholder="e.g. Bunjil Place forecourt paving"></textarea>
    <div class="acts"><button class="btn primary">Send to the inbox</button><button class="btn" type="button" id="cancel">Cancel</button></div>
    <p class="msg" id="shmsg"></p></form>`;
  document.getElementById("sn").focus();
  document.getElementById("cancel").onclick = () => render();
  document.getElementById("sendshot").onsubmit = async e => {
    e.preventDefault();
    const m = document.getElementById("shmsg"); m.className = "msg"; m.textContent = "Sending...";
    const note = [document.getElementById("sn").value.trim(), item.file ? `From ${item.file.split("/").pop()}` : ""].filter(Boolean).join(". ");
    const base = { from: "mac", url: item.url || "", title: item.title || item.windowTitle || note || "", site: item.app || "", author: item.author || "", note };
    try {
      // Netlify refuses requests over about 6 MB, so several images go up in parts.
      const parts = [[]]; let size = 0;
      for (const im of images) {
        if (size + im.data.length > 3_500_000 && parts.at(-1).length) { parts.push([]); size = 0; }
        parts.at(-1).push({ data: im.data, type: im.type, name: im.name || "image.jpg" }); size += im.data.length;
      }
      const { item: sent } = await api("/api/inbox", { ...base, uploads: parts[0] });
      for (const p of parts.slice(1)) await fetch("/api/inbox", { method: "PATCH", headers: { "x-app-password": auth.pw, "x-user-name": encodeURIComponent(auth.name), "content-type": "application/json" }, body: JSON.stringify({ id: sent.id, uploads: p }) });
      render(); toast("Sent to the inbox");
    } catch (err) { m.className = "msg bad"; m.textContent = `Couldn't send: ${err.message}`; }
  };
}

// Image files dropped on the panel (from Finder, the desktop, another app) or pasted: shrink and offer to send.
async function shrinkFile(f) {
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.82);
  return { data: url.split(",")[1], type: "image/jpeg", name: (f.name || "image").replace(/\.[a-z]+$/i, "") + ".jpg" };
}
async function offerFiles(files) {
  const imgs = [...files].filter(f => f.type.startsWith("image/")).slice(0, 8);
  if (!imgs.length) return toast("Only images can be sent from here. For a web page, use the browser extension.");
  if (!auth.pw) return showSettings();
  showShot({ images: await Promise.all(imgs.map(shrinkFile)) });
}
document.addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); document.getElementById("shell").classList.add("dropping"); } });
document.addEventListener("dragleave", e => { if (!e.relatedTarget) document.getElementById("shell").classList.remove("dropping"); });
document.addEventListener("drop", e => {
  document.getElementById("shell").classList.remove("dropping");
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault(); offerFiles(e.dataTransfer.files);
});
document.addEventListener("paste", e => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length && document.activeElement?.id !== "sn") { e.preventDefault(); offerFiles(files); }
});

// ---------- the Mac app talks to the page through window.pr ----------
window.pr = {
  focus() { if (view === "search") { const i = document.getElementById("q"); i?.focus(); i?.select(); } refresh(); },
  setPinned(on) { pinned = on; document.getElementById("pin").classList.toggle("on", on); document.getElementById("pin").textContent = on ? "Pinned" : "Pin"; },
  shot(item) { showShot(item); },
  downloaded(n, folder) { const t = toast(`${n} image${n === 1 ? "" : "s"} saved to Downloads › Precedents <button id="reveal">Show in Finder</button>`, 5000); t.querySelector("#reveal").onclick = () => post("reveal", { folder }); },
  copied() { toast("Image copied. Paste it into InDesign, PowerPoint or anywhere."); },
  note(text) { toast(esc(text), 4000); },
};
document.getElementById("pin").onclick = () => { window.pr.setPinned(!pinned); post("pin", { on: pinned }); };
document.getElementById("close").onclick = () => post("hide");
document.getElementById("gear").onclick = () => showSettings();
document.getElementById("lib").onclick = () => openUrl(abs("/#/library"));
document.getElementById("shot").onclick = () => post("screenshot");
if (!mac) document.getElementById("shot").title = "Only in the Mac app";

// Dragging the panel by its header (the Mac app moves the window).
let dragFrom = null;
document.getElementById("drag").addEventListener("mousedown", e => { if (e.target.closest("button")) return; dragFrom = { x: e.screenX, y: e.screenY }; });
window.addEventListener("mousemove", e => {
  if (!dragFrom) return;
  post("move", { dx: e.screenX - dragFrom.x, dy: e.screenY - dragFrom.y });
  dragFrom = { x: e.screenX, y: e.screenY };
});
window.addEventListener("mouseup", () => { dragFrom = null; });

post("ready");
start();
