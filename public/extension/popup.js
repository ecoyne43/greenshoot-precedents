// The toolbar panel: search the Precedents library (instantly, or Ask Groundwork), open a precedent to see its
// images, and download them; or send the current page or a screenshot to the inbox. The library is kept in the
// extension's storage so the panel opens instantly, and refreshed from the site each time.
import { SITE as CONFIGURED } from "./config.js";

const SITE = CONFIGURED.startsWith("__") ? location.origin : CONFIGURED;   // "__SITE__" only in the design preview
const ext = typeof chrome !== "undefined" && chrome.storage?.local;
const main = document.getElementById("main");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- storage (extension storage, or the page's own in the preview) ----------
const store = {
  async get(k) { if (ext) return (await chrome.storage.local.get(k))[k]; try { return JSON.parse(localStorage.getItem("gpx_" + k)); } catch { return undefined; } },
  async set(k, v) { if (ext) return chrome.storage.local.set({ [k]: v }); try { localStorage.setItem("gpx_" + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

let auth = {}, lib = { records: [], token: "" }, q = "", ask = null, openId = null;

async function api(path, body) {
  const res = await fetch(SITE + path, {
    method: body ? "POST" : "GET",
    headers: { "x-app-password": auth.pw || "", "x-user-name": encodeURIComponent(auth.name || ""), ...(body ? { "content-type": "application/json" } : {}) },
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

// Library images straight from Cloudflare once it's set up (lib.imgBase), otherwise from the site.
const imgUrl = key => lib.imgBase ? `${lib.imgBase}/${key}?t=${lib.token}` : `${SITE}/api/img?k=${encodeURIComponent(key)}&t=${lib.token}`;
const place = r => [r.city, r.state, r.country].filter(Boolean).join(", ") || r.location_text || "";
const primary = r => (r.images || []).find(i => i.primary) || (r.images || [])[0];
const hay = r => [r.id, r.name, r.also_known_as, r.location_text, r.city, r.state, r.country, r.country_to, r.year_completed,
  r.architect, r.landscape_architect, r.artists, r.first_peoples_collaborators, r.client, r.summary,
  ...Object.values(r.facets || {}).flat(), ...(r.tags || [])].join(" ").toLowerCase();

// ---------- start ----------
async function start() {
  auth = (await store.get("auth")) || {};
  const cached = await store.get("lib");
  if (cached?.records) lib = cached;
  if (!auth.pw || !auth.name) return showSettings();
  render();
  refresh();
}

async function refresh() {
  try {
    const [cfg, { records }] = await Promise.all([api("/api/config"), api("/api/library")]);
    lib = { records, token: cfg.token, imgBase: cfg.imgBase || "", at: Date.now() };
    await store.set("lib", lib);
    render(true);
  } catch (e) {
    if (e.status === 401) return showSettings(e.ours ? "The team password has changed. Enter the new one." : e.message);
    if (!lib.records.length) main.innerHTML = `<div class="empty bad">Couldn't reach the library: ${esc(e.message)}</div>`;
  }
}

// ---------- settings ----------
function showSettings(msg = "") {
  main.innerHTML = `<form class="form" id="set">
    <p>Sign in once on this computer. The password is the team one for the Precedents site.</p>
    <label for="pw">Team password</label><input id="pw" type="password" value="${esc(auth.pw || "")}" required>
    <label for="nm">Your name</label><input id="nm" value="${esc(auth.name || "")}" required>
    <button class="btn primary">Save</button><p class="msg ${msg ? "bad" : ""}" id="smsg">${esc(msg)}</p></form>`;
  document.getElementById("set").onsubmit = async e => {
    e.preventDefault();
    auth = { pw: document.getElementById("pw").value.trim(), name: document.getElementById("nm").value.trim() };
    try { await api("/api/config"); } catch (err) { document.getElementById("smsg").className = "msg bad"; document.getElementById("smsg").textContent = err.message; return; }
    await store.set("auth", auth);
    render(); refresh();
  };
}
document.getElementById("settings").onclick = () => showSettings();
document.getElementById("open-lib").onclick = () => open(SITE + "/#/library");

// ---------- search and results ----------
function results() {
  if (ask?.results) return ask.results.map(x => ({ r: lib.records.find(r => r.id === x.id), why: x.reason })).filter(x => x.r);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = words.length ? lib.records.filter(r => { const h = hay(r); return words.every(w => h.includes(w)); })
    : [...lib.records].sort((a, b) => (b.updated || b.added || "").localeCompare(a.updated || a.added || ""));
  return list.slice(0, 40).map(r => ({ r }));
}

function render(keepFocus) {
  const focused = document.activeElement?.id === "q", pos = document.getElementById("q")?.selectionStart;
  const list = results();
  main.innerHTML = `
    <form class="search" id="sf"><input id="q" type="search" placeholder="Search: name, place, designer, theme..." value="${esc(q)}" autocomplete="off">
      <button class="ask" title="Ask Groundwork in plain words"><b>✦</b> Ask</button></form>
    ${ask ? `<div class="askbox"><b>✦ Groundwork</b> ${ask.busy ? "Reading the library..." : esc(ask.error || ask.summary || "")} <a href="#" id="clr">Clear</a></div>` : ""}
    <div class="meta"><span>${ask ? `${list.length} suggested` : q ? `${list.length} found` : "Recently added and updated"}</span><span>${lib.records.length} in the library</span></div>
    ${list.length ? list.map(({ r, why }) => row(r, why)).join("") : `<div class="empty">${lib.records.length ? "Nothing matches. Try other words, or Ask." : "Loading the library..."}</div>`}`;
  const input = document.getElementById("q");
  input.oninput = () => { q = input.value; ask = null; render(); };
  if (focused || !keepFocus) { input.focus(); if (pos != null) input.setSelectionRange(pos, pos); }
  document.getElementById("sf").onsubmit = e => { e.preventDefault(); runAsk(); };
  document.getElementById("clr")?.addEventListener("click", e => { e.preventDefault(); ask = null; render(); });
  main.querySelectorAll("[data-row]").forEach(b => b.onclick = () => { openId = openId === b.dataset.row ? null : b.dataset.row; render(true); });
  main.querySelectorAll("[data-dl]").forEach(b => b.onclick = e => { e.stopPropagation(); const [id, n] = b.dataset.dl.split(":"); download(id, [+n]); });
  main.querySelectorAll("[data-all]").forEach(b => b.onclick = () => download(b.dataset.all));
  main.querySelectorAll("[data-lib]").forEach(b => b.onclick = () => open(`${SITE}/#/p/${b.dataset.lib}`));
  main.querySelectorAll("[data-big]").forEach(im => im.onclick = () => { const [id, n] = im.dataset.big.split(":"); big(id, +n); });
}

function row(r, why) {
  const p = primary(r), imgs = r.images || [], isOpen = openId === r.id;
  return `<div class="res ${isOpen ? "open" : ""}">
    <button class="row" data-row="${r.id}"><span class="th">${p ? `<img src="${esc(imgUrl(p.thumb_key))}" alt="" loading="lazy">` : ""}</span>
      <span class="rt"><b>${esc(r.name)}</b><span>${esc(place(r))}${r.year_completed ? ` · ${esc(r.year_completed)}` : ""}</span>
      ${why ? `<span class="why">${esc(why)}</span>` : ""}</span>
      <span class="n">${imgs.length} img</span><span class="chev"></span></button>
    ${isOpen ? `<div class="drop">
      ${r.summary ? `<p class="dsum">${esc(r.summary.length > 220 ? r.summary.slice(0, 220) + "..." : r.summary)}</p>` : ""}
      ${imgs.length ? `<div class="grid">${imgs.map((i, n) => `<div class="im"><img src="${esc(imgUrl(i.thumb_key))}" alt="${esc(i.caption)}" title="${esc(i.caption)}" data-big="${r.id}:${n}" loading="lazy">
        <span class="ty">${esc(i.image_type)}</span><button class="dl" data-dl="${r.id}:${n}" title="Download">⬇</button></div>`).join("")}</div>` : `<p class="dsum">No images yet.</p>`}
      <div class="acts">${imgs.length ? `<button class="btn primary" data-all="${r.id}">Download all (${imgs.length})</button>` : ""}<button class="btn" data-lib="${r.id}">Open in library ↗</button></div>
      ${imgs.some(i => i.credit) ? `<p class="credit">Images: ${esc([...new Set(imgs.map(i => i.credit).filter(Boolean))].join("; "))}. Check rights before using outside Greenshoot.</p>` : ""}
    </div>` : ""}
  </div>`;
}

async function runAsk() {
  const question = document.getElementById("q").value.trim();
  if (!question) return;
  ask = { busy: true }; render(true);
  try { ask = await api("/api/ask", { question }); } catch (e) { ask = { error: `Couldn't ask: ${e.message}` }; }
  openId = null; render(true);
}

// ---------- images ----------
const safe = s => String(s || "").replace(/[\\/:*?"<>|#%]+/g, "").replace(/\s+/g, " ").trim().slice(0, 60);

function download(id, which) {
  const r = lib.records.find(x => x.id === id);
  const imgs = (r?.images || []).map((im, n) => ({ im, n })).filter(({ n }) => !which || which.includes(n));
  for (const { im, n } of imgs) {
    const filename = `Precedents/${id} ${safe(r.name)}/${String(n + 1).padStart(2, "0")} ${safe(im.image_type)}${im.caption ? " - " + safe(im.caption) : ""}.jpg`;
    if (ext && chrome.downloads) chrome.downloads.download({ url: imgUrl(im.key), filename, conflictAction: "uniquify" });
    else { const a = Object.assign(document.createElement("a"), { href: imgUrl(im.key), download: filename.split("/").pop() }); document.body.append(a); a.click(); a.remove(); }
  }
}

function big(id, n) {
  const r = lib.records.find(x => x.id === id), im = r.images[n];
  const box = document.createElement("div");
  box.className = "big";
  box.innerHTML = `<img src="${esc(imgUrl(im.key))}" alt=""><p>${esc(im.caption)}${im.credit ? ` · Image: ${esc(im.credit)}` : ""}</p>
    <div class="acts"><button class="btn primary" id="bdl">Download</button><button class="btn" id="bx">Close</button></div>`;
  document.body.append(box);
  box.querySelector("#bdl").onclick = () => download(id, [n]);
  box.querySelector("#bx").onclick = () => box.remove();
  box.onclick = e => { if (e.target === box) box.remove(); };
}

// ---------- send the current page ----------
for (const [btn, kind] of [["send-page", "page"], ["send-shot", "shot"]]) {
  document.getElementById(btn).onclick = async () => {
    if (!ext) return;
    const res = await chrome.runtime.sendMessage({ send: kind });
    if (res?.error) { main.insertAdjacentHTML("afterbegin", `<p class="empty bad">${esc(res.error)}</p>`); return; }
    window.close();
  };
}

start();
