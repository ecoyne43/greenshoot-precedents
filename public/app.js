// Groundworked Precedents: the library, the inbox review and the Add page. One page, views chosen by the address
// (#/library, #/p/PR-0001, #/inbox, #/inbox/<id>, #/add). Records come from /api/library; nothing is saved until
// someone approves (inbox) or saves an edit, which commits to the data repo.
import { esc, api, setAuth, getAuth, toast, shrink, toBase64, readWebText, readWebStream, readJSONAnswer } from "./util.js";
import { bookmarklet } from "./bookmarklet.js";
import { nameFromFile } from "./filename.js";

const st = {
  cfg: null, records: [], inbox: [],
  q: "", filters: {}, sort: "added", ask: null, asking: false,
  openFacets: new Set(["project_type", "dwc_themes"]),
};
const view = document.getElementById("view");
const byId = id => st.records.find(r => r.id === id);

// ---------- start ----------
async function start() {
  const { pw, name } = getAuth();
  if (!pw || !name) return showLogin();
  try {
    st.cfg = await api("/api/config");
  } catch (e) {
    if (e.status === 401) return showLogin("Wrong password");
    return showLogin(e.message);
  }
  document.getElementById("login").hidden = true;
  document.getElementById("app").hidden = false;
  document.getElementById("who").textContent = name;
  await Promise.all([loadLibrary(), loadInbox()]);
  route();
}

function showLogin(msg = "") {
  document.getElementById("app").hidden = true;
  document.getElementById("login").hidden = false;
  const { name } = getAuth();
  document.getElementById("login-name").value = name || "";
  document.getElementById("login-msg").textContent = msg;
  document.getElementById("login-pw").focus();
}
document.getElementById("login-form").onsubmit = e => {
  e.preventDefault();
  setAuth(document.getElementById("login-pw").value.trim(), document.getElementById("login-name").value.trim());
  start();
};
document.getElementById("who").onclick = () => {
  const n = prompt("Your name (shown on what you add and approve)", getAuth().name);
  if (n && n.trim()) { setAuth(getAuth().pw, n.trim()); document.getElementById("who").textContent = n.trim(); }
};

async function loadLibrary() {
  st.records = (await api("/api/library")).records;
  document.getElementById("lib-count").textContent = st.records.length || "";
}
async function loadInbox() {
  st.inbox = (await api("/api/inbox")).items;
  const n = st.inbox.filter(i => i.status === "new").length;
  const b = document.getElementById("inbox-count");
  b.textContent = n || ""; b.classList.toggle("has", n > 0);
}

// ---------- routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [tab, arg] = h.split("/");
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === (tab === "p" ? "library" : tab || "library")));
  window.scrollTo(0, 0);
  if (tab === "p" && arg) return renderRecord(arg);
  if (tab === "inbox") {   // always fresh: other people send things in all the time
    if (!arg || !st.inbox.some(i => i.id === arg)) return loadInbox().then(() => renderInbox(arg)).catch(e => toast(e.message));
    return renderInbox(arg);
  }
  if (tab === "add") return renderAdd();
  if (tab === "admin") return renderAdmin();
  if (tab === "categories") return renderCategories();
  renderLibrary();
}
window.addEventListener("hashchange", route);

// ---------- helpers ----------
// Library images come straight from Cloudflare once it's set up (cfg.imgBase); inbox uploads always from the site.
const imgSrc = key => key.includes("/") && st.cfg.imgBase ? `${st.cfg.imgBase}/${key}?t=${st.cfg.token}` : `/api/img?k=${encodeURIComponent(key)}&t=${st.cfg.token}`;
const img = (key, cls = "") => key ? `<img class="${cls}" loading="lazy" alt="" src="${imgSrc(key)}">` : "";
const primary = r => (r.images || []).find(i => i.primary) || (r.images || [])[0];
const place = r => [r.city, r.state, r.country].filter(Boolean).join(", ") || r.location_text || "";
const designers = r => [r.architect, r.landscape_architect, r.artists].filter(Boolean).join(" · ");
const allFacetValues = r => Object.values(r.facets || {}).flat();
function region(r) {
  const c = (r.country || "").toLowerCase(), s = (r.state || "").toLowerCase();
  if (!c) return "";
  if (c === "australia") return /^(vic|victoria)$/.test(s) ? "Victoria" : "Australia (other states)";
  return "International";
}
const fmtDate = d => (d ? new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");
const ago = d => {
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return fmtDate(d);
};

// ---------- library ----------
const haystack = r => [r.id, r.name, r.also_known_as, r.location_text, r.city, r.state, r.country, r.country_to, r.year_completed,
  r.architect, r.landscape_architect, r.artists, r.first_peoples_collaborators, r.client, r.summary, r.why_it_matters,
  r.description, ...allFacetValues(r), ...(r.material_details || []), ...(r.tags || []), ...(r.used_in || [])].join(" ").toLowerCase();

function matches(r, skip) {
  if (st.q) {
    const h = haystack(r);
    if (!st.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => h.includes(w))) return false;
  }
  for (const [k, vals] of Object.entries(st.filters)) {
    if (k === skip || !vals.length) continue;
    if (k === "region") { if (!vals.includes(region(r))) return false; continue; }
    if (k === "status") { if (!vals.includes(r.status)) return false; continue; }
    if (k === "greenshoot") { if (!r.greenshoot_project) return false; continue; }
    if (!vals.some(v => (r.facets?.[k] || []).includes(v))) return false;
  }
  return true;
}

function sorted(list) {
  const by = { added: (a, b) => (b.added || "").localeCompare(a.added || "") || b.id.localeCompare(a.id),
    name: (a, b) => a.name.localeCompare(b.name), year: (a, b) => (+b.year_completed || 0) - (+a.year_completed || 0) };
  return [...list].sort(by[st.sort]);
}

function facetGroup(key, label, values, valueOf) {
  const pool = st.records.filter(r => matches(r, key));
  const sel = st.filters[key] || [];
  const counts = values.map(v => [v, pool.filter(r => valueOf(r).includes(v)).length]);
  const open = st.openFacets.has(key) || sel.length;
  const shown = counts.filter(([v, n]) => n || sel.includes(v));
  return `<section class="fg ${open ? "open" : ""}" data-fg="${key}">
    <button class="fg-h" data-toggle="${key}"><span>${esc(label)}</span>${sel.length ? `<span class="fg-n">${sel.length}</span>` : ""}<span class="chev"></span></button>
    <div class="fg-b">${shown.length ? shown.map(([v, n]) => `<label class="opt ${n ? "" : "zero"}"><input type="checkbox" data-f="${key}" value="${esc(v)}" ${sel.includes(v) ? "checked" : ""}><span>${esc(v)}</span><em>${n}</em></label>`).join("") : `<p class="muted small">Nothing yet</p>`}</div>
  </section>`;
}

function renderLibrary() {
  const c = st.cfg;
  const list = sorted(st.records.filter(r => matches(r)));
  const active = Object.entries(st.filters).flatMap(([k, vs]) => vs.map(v => [k, v]));
  const askRes = st.ask && !st.ask.error ? st.ask.results.map(x => ({ ...x, r: byId(x.id) })).filter(x => x.r) : null;
  view.innerHTML = `
  <div class="lib">
    <aside class="side">
      ${facetGroup("region", "Where", c.regions, r => [region(r)])}
      ${c.facets.map(f => facetGroup(f.key, f.label, f.values, r => r.facets?.[f.key] || [])).join("")}
      ${facetGroup("status", "Status", c.status, r => [r.status])}
      <section class="fg open"><div class="fg-b"><label class="opt"><input type="checkbox" data-f="greenshoot" value="yes" ${(st.filters.greenshoot || []).length ? "checked" : ""}><span>Greenshoot projects only</span><em>${st.records.filter(r => r.greenshoot_project).length}</em></label></div></section>
      <p class="small side-link"><a class="link" href="#/categories">See or add to the category lists</a></p>
    </aside>
    <section class="results">
      <form class="search" id="search">
        <div class="search-box">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg>
          <input id="q" type="search" placeholder="Search precedents, or ask a question: timber shelters near water with weaving patterns" value="${esc(st.q)}" autocomplete="off">
        </div>
        <button class="btn ask" id="ask-btn" type="submit" ${st.asking ? "disabled" : ""}><span class="spark">✦</span> ${st.asking ? "Searching..." : "Ask Groundwork"}</button>
      </form>
      ${askRes || st.asking || st.ask?.error ? `<div class="askbox">
        <div class="askbox-h"><b>✦ Groundwork</b>${st.ask?.label ? `<span class="muted">${esc(st.ask.label)}</span>` : ""}<button class="link" id="ask-clear">Clear</button></div>
        ${st.asking ? `<p class="muted">Reading the library...</p>` : st.ask.error ? `<p class="bad">${esc(st.ask.error)}</p>` : `<p>${esc(st.ask.summary)}</p>
        <div class="grid">${askRes.map(x => card(x.r, x.reason)).join("")}</div>`}
      </div>` : ""}
      <div class="bar">
        <span class="n"><b>${list.length}</b> of ${st.records.length} precedent${st.records.length === 1 ? "" : "s"}</span>
        <span class="active">${active.map(([k, v]) => `<button class="pill" data-rm="${esc(k)}" data-v="${esc(v)}">${k === "greenshoot" ? "Greenshoot projects" : esc(v)} ×</button>`).join("")}${active.length ? `<button class="link" id="clear">Clear all</button>` : ""}</span>
        <label class="sort">Sort <select id="sort">
          <option value="added" ${st.sort === "added" ? "selected" : ""}>Recently added</option>
          <option value="name" ${st.sort === "name" ? "selected" : ""}>Name</option>
          <option value="year" ${st.sort === "year" ? "selected" : ""}>Year completed</option>
        </select></label>
      </div>
      ${list.length ? `<div class="grid">${list.map(r => card(r)).join("")}</div>` : `<div class="empty">${st.records.length ? "No precedents match. Try fewer filters, or Ask Groundwork." : `The library is empty. <a href="#/add">Add the first precedent</a>.`}</div>`}
    </section>
  </div>`;

  const q = document.getElementById("q");
  q.oninput = () => { st.q = q.value; const pos = q.selectionStart; renderLibrary(); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(pos, pos); };
  document.getElementById("search").onsubmit = e => { e.preventDefault(); runAsk({ question: q.value.trim() }, `"${q.value.trim()}"`); };
  view.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => {
    const k = b.dataset.toggle; st.openFacets.has(k) ? st.openFacets.delete(k) : st.openFacets.add(k); b.parentElement.classList.toggle("open");
  });
  view.querySelectorAll("input[data-f]").forEach(i => i.onchange = () => {
    const k = i.dataset.f, cur = new Set(st.filters[k] || []);
    i.checked ? cur.add(i.value) : cur.delete(i.value);
    st.filters[k] = [...cur]; renderLibrary();
  });
  view.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { st.filters[b.dataset.rm] = (st.filters[b.dataset.rm] || []).filter(v => v !== b.dataset.v); renderLibrary(); });
  document.getElementById("clear")?.addEventListener("click", () => { st.filters = {}; renderLibrary(); });
  document.getElementById("sort").onchange = e => { st.sort = e.target.value; renderLibrary(); };
  document.getElementById("ask-clear")?.addEventListener("click", () => { st.ask = null; renderLibrary(); });
}

function card(r, reason = "") {
  const p = primary(r);
  const chips = [...(r.facets?.project_type || []), ...(r.facets?.dwc_themes || []), ...(r.facets?.cultural_expression || [])].slice(0, 3);
  return `<a class="card" href="#/p/${r.id}">
    <div class="ph">${p ? img(p.thumb_key) : `<span class="noimg">No image</span>`}${r.greenshoot_project ? `<span class="gs">Greenshoot</span>` : ""}</div>
    <div class="cb">
      <div class="cid">${r.id}${r.year_completed ? ` · ${esc(r.year_completed)}` : ""}</div>
      <h3>${esc(r.name)}</h3>
      <p class="pl">${esc(place(r))}</p>
      ${designers(r) ? `<p class="ds">${esc(designers(r))}</p>` : ""}
      ${reason ? `<p class="why">${esc(reason)}</p>` : `<div class="chips">${chips.map(c => `<span>${esc(c)}</span>`).join("")}</div>`}
    </div>
  </a>`;
}

async function runAsk(body, label) {
  if (!Object.values(body)[0]) return;
  st.asking = true; st.ask = { label, results: [] };
  st.q = "";   // the question shows in the Groundwork box; the grid below goes back to the whole (filtered) library
  if (!location.hash.startsWith("#/library")) location.hash = "#/library"; else renderLibrary();
  try {
    const out = await api("/api/ask", { method: "POST", body });
    st.ask = { ...out, label };
  } catch (e) { st.ask = { error: e.message, label, results: [] }; }
  st.asking = false;
  renderLibrary();
}

// ---------- record view ----------
function renderRecord(id) {
  const r = byId(id);
  if (!r) { view.innerHTML = `<div class="page"><p>${esc(id)} is not in the library. <a href="#/library">Back to the library</a></p></div>`; return; }
  const imgs = r.images || [];
  const p = primary(r);
  const details = r.material_details || [];
  const facetBlocks = st.cfg.facets.filter(f => (r.facets?.[f.key] || []).length || (f.key === "materials" && details.length)).map(f =>
    `<div class="fb"><h4>${esc(f.label)}</h4><div class="chips big">${(r.facets[f.key] || []).map(v => `<button data-filter="${f.key}" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div>
    ${f.key === "materials" && details.length ? `<p class="mdetails">${details.map(d => `<a href="#/library" data-q="${esc(d)}">${esc(d)}</a>`).join(" · ")}</p>` : ""}</div>`).join("");
  const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : "");
  const link = s => { const m = String(s).match(/^(.*?),?\s*(https?:\/\/\S+)\s*$/); return m ? `<a href="${esc(m[2])}" target="_blank" rel="noopener">${esc(m[1] || m[2])}</a>` : esc(s); };
  view.innerHTML = `
  <article class="rec">
    <div class="rec-top"><a class="link" href="#/library">← Library</a>
      <div class="rec-actions">
        <button class="btn" id="similar">Find similar</button>
        <button class="btn" id="addto">Add to this precedent</button>
        <button class="btn" id="edit">Edit</button>
      </div></div>
    <header class="rec-h">
      <div class="cid">${r.id}${r.greenshoot_project ? ` · <span class="gs-inline">Greenshoot project</span>` : ""}${r.sensitive ? ` · <span class="sens">Sensitive</span>` : ""}</div>
      <h1>${esc(r.name)}</h1>
      <p class="sub">${esc(place(r))}${r.year_completed ? ` · ${esc(r.year_completed)}` : ""}${r.status && r.status !== "Built" ? ` · ${esc(r.status)}` : ""}</p>
    </header>
    ${imgs.length ? `<section class="gal" id="gal"></section>` : ""}
    <div class="rec-cols">
      <div class="rec-main">
        ${r.summary ? `<p class="lead">${esc(r.summary)}</p>` : ""}
        ${r.why_it_matters ? `<div class="why-box"><h4>Why it matters for Greenshoot</h4><p>${esc(r.why_it_matters)}</p></div>` : ""}
        ${r.description ? `<h4>Description</h4><p class="pre">${esc(r.description)}</p>` : ""}
        ${facetBlocks ? `<h4 class="sec">Categories</h4>${facetBlocks}` : ""}
        ${(r.tags || []).length ? `<div class="fb"><h4>Tags</h4><div class="chips">${r.tags.map(t => `<span>${esc(t)}</span>`).join("")}</div></div>` : ""}
        ${(r.sources || []).length ? `<h4 class="sec">Sources</h4><ul class="src">${r.sources.map(s => `<li>${link(s)}</li>`).join("")}</ul>` : ""}
      </div>
      <aside class="rec-side">
        <dl>
          ${row("Country / Traditional Owners", esc(r.country_to))}
          ${row("Location", esc(r.location_text || place(r)))}
          ${row("Architect", esc(r.architect))}
          ${row("Landscape architect", esc(r.landscape_architect))}
          ${row("Artists", esc(r.artists))}
          ${row("First Peoples collaborators", esc(r.first_peoples_collaborators))}
          ${row("Client", esc(r.client))}
          ${row("Other team", esc(r.other_team))}
          ${row("Scale", esc(r.scale))}
          ${row("Awards", esc(r.awards))}
          ${row("Used in Greenshoot projects", esc((r.used_in || []).join(", ")))}
          ${r.sensitive ? row("Sensitive", esc(r.sensitive_note || "Not for client material")) : ""}
        </dl>
        <div class="attrib">
          <p>Sent by <b>${esc(r.added_by)}</b>, approved by <b>${esc(r.approved_by)}</b>, ${fmtDate(r.added)}</p>
          ${(r.history || []).filter(h => !/^added/.test(h.what)).reverse().slice(0, 6).map(h => `<p>${fmtDate(h.date)}: ${/from inbox/.test(h.what) ? `new material from <b>${esc((h.what.match(/sent by ([^)]+)/) || [])[1] || h.by)}</b>, approved by <b>${esc(h.by)}</b>` : `edited by <b>${esc(h.by)}</b>`}</p>`).join("")}
        </div>
      </aside>
    </div>
  </article>`;
  if (imgs.length) gallery(view.querySelector("#gal"), imgs, Math.max(0, imgs.indexOf(p)));
  view.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { st.filters = { [b.dataset.filter]: [b.dataset.v] }; st.q = ""; st.ask = null; location.hash = "#/library"; });
  view.querySelectorAll("[data-q]").forEach(a => a.onclick = e => { e.preventDefault(); st.filters = {}; st.q = a.dataset.q; st.ask = null; location.hash = "#/library"; });
  document.getElementById("similar").onclick = () => runAsk({ similar: r.id }, `Similar to ${r.name}`);
  document.getElementById("edit").onclick = () => openEditor({ record: structuredClone(r), targetId: r.id });
  document.getElementById("addto").onclick = () => openAddTo(r);
}

// "Add to this precedent": a link, photos and a note for a precedent that's already in the library. It goes to the
// inbox like everything else, marked for this precedent, and opens there so Groundwork can propose what to add.
function openAddTo(r) {
  const m = document.getElementById("modal"), card = document.getElementById("modal-card");
  card.innerHTML = `<div class="modal-h"><h2>Add to ${esc(r.id)} ${esc(r.name)}</h2><button class="link" id="mclose">Cancel</button></div>
    <form id="addto-form" class="addto-form">
      <p class="muted">New photos, a web page with more about it, or just context in a note. Groundwork reads it alongside the existing entry and suggests what to add; you check it in the inbox.</p>
      <div class="urlrow"><label class="fl long"><span>Web page <em>optional</em></span><input name="url" type="url" id="at-url" placeholder="https://..."></label><button type="button" class="btn" id="at-get">Get images</button></div>
      <div class="ipick" id="at-imgs" hidden></div>
      <label class="drop" id="at-drop"><input type="file" accept="image/*" multiple hidden id="at-files"><span><b>Drop photos here</b>, paste (Cmd/Ctrl+V), or click to choose <em>optional, up to 8</em></span></label>
      <div class="drop-list" id="at-list"></div>
      <label class="fl long"><span>Note or context <em>optional</em></span><textarea name="note" rows="3" placeholder="e.g. Photos from our site visit, Nov 2026. The panels were designed with Wurundjeri women Elders..."></textarea></label>
      <div class="rf-actions"><span></span><button class="btn primary" id="at-send">Send and review</button></div>
      <p class="msg" id="at-msg" role="status"></p>
    </form>`;
  m.hidden = false; document.body.classList.add("noscroll");
  document.getElementById("mclose").onclick = closeModal;
  const pick = photoPicker(document.getElementById("at-drop"), document.getElementById("at-files"), document.getElementById("at-list"));
  const web = imagePicker(document.getElementById("at-imgs")), urlIn = document.getElementById("at-url");
  let loaded = "";
  const getImages = () => { const u = urlIn.value.trim(); if (!/^https?:\/\//.test(u)) { urlIn.reportValidity(); return; } if (u !== loaded) { loaded = u; web.load(u); } };
  document.getElementById("at-get").onclick = getImages;
  urlIn.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); getImages(); } };
  urlIn.onpaste = () => setTimeout(getImages, 0);   // paste a link and the images appear
  document.getElementById("addto-form").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target), url = String(fd.get("url") || "").trim(), note = String(fd.get("note") || "").trim();
    const btn = document.getElementById("at-send"), msg = document.getElementById("at-msg");
    if (!url && !note && !pick.count()) { msg.className = "msg bad"; msg.textContent = "Add a link, some photos or a note."; return; }
    btn.disabled = true; msg.className = "msg"; msg.textContent = "Sending...";
    try {
      const pg = url && url === loaded ? web.page() : null;
      const item = await sendToInbox({ url, note, target: r.id, title: pg?.title || (url ? "" : `More for ${r.name}`), site: pg?.site || "" },
        pick.files(), [...pick.webImgs(), ...(pg ? web.selected() : [])]);
      pick.stop(); closeModal(); await loadInbox();
      location.hash = `#/inbox/${item.id}`;
    } catch (err) { msg.className = "msg bad"; msg.textContent = `Couldn't send: ${err.message}`; btn.disabled = false; }
  };
}

// Send something to the inbox. Photos are shrunk and go up in batches under 3.5 MB (Netlify refuses requests over
// about 6 MB). Returns the inbox item.
async function sendToInbox(body, files = [], webImgs = []) {
  const batches = [[]]; let size = 0;
  for (const f of files) {
    const up = { data: await toBase64(await shrink(f, 1600, 0.8)), type: "image/jpeg", name: f.name, taken: new Date(f.lastModified).toISOString() };
    if (size + up.data.length > 3_500_000 && batches.at(-1).length) { batches.push([]); size = 0; }
    batches.at(-1).push(up); size += up.data.length;
  }
  const { item } = await api("/api/inbox", { method: "POST", body: { ...body, from: files.length && !body.url ? "upload" : body.from || "web", uploads: batches[0], images: webImgs } });
  for (const b of batches.slice(1)) await api("/api/inbox", { method: "PATCH", body: { id: item.id, uploads: b } });
  return item;
}

// A photo drop zone: files, pasted screenshots and images dragged from other web pages (up to 8 in all).
function photoPicker(drop, input, list, onChange) {
  let files = [], webImgs = [];
  const show = () => { setTimeout(() => onChange?.(), 0); list.innerHTML = files.map(f => `<span>${esc(f.name || "pasted image")}</span>`).join("") + webImgs.map(u => `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer">`).join(""); };
  const add = fl => { files = [...files, ...[...fl].filter(f => f.type.startsWith("image/"))].slice(0, 20 - webImgs.length); show(); };
  input.onchange = () => add(input.files);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => {
    e.preventDefault(); drop.classList.remove("over");
    const dt = e.dataTransfer;
    if ([...dt.files].some(f => f.type.startsWith("image/"))) return add(dt.files);
    // An image dragged from another web page arrives as its address.
    const html = dt.getData("text/html"), m = html && html.match(/<img[^>]+src=["']([^"']+)/i);
    const u = (m && m[1]) || dt.getData("text/uri-list").split("\n").find(l => /^https?:/.test(l.trim())) || "";
    if (/^https?:/.test(u.trim())) { webImgs = [...new Set([...webImgs, u.trim()])].slice(0, 20 - files.length); show(); }
    else toast("That didn't come through as an image. Try saving it and dropping the file.");
  };
  const onPaste = e => { if (!document.body.contains(drop)) return stop(); const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); add(f); } };
  const stop = () => document.removeEventListener("paste", onPaste);
  document.addEventListener("paste", onPaste);
  return { files: () => files, webImgs: () => webImgs, count: () => files.length + webImgs.length, stop, clear() { files = []; webImgs = []; show(); } };
}

// A precedent's images, seen three ways (the choice is remembered): Carousel (one large, ‹ › or arrow keys, a strip of
// every image below), Grid (all at once; click one to see it large) or List (each large, with its caption).
function gallery(box, imgs, cur = 0) {
  let mode = "carousel";
  try { mode = localStorage.getItem("gp_gallery") || "carousel"; } catch {}
  const cap = i => `${i.image_type ? `<b>${esc(i.image_type)}</b> ` : ""}${esc(i.caption)}${i.credit ? ` <span class="muted">Image: ${esc(i.credit)}</span>` : ""}`;
  const big = i => imgSrc(i.key), small = i => imgSrc(i.thumb_key || i.key);
  const draw = () => {
    const n = imgs.length, i = imgs[cur];
    const bar = `<div class="gal-bar"><span class="muted">${n} image${n === 1 ? "" : "s"}</span>${n > 1 ? `<div class="seg" role="group" aria-label="Show images as">
      ${[["carousel", "Carousel"], ["grid", "Grid"], ["list", "List"]].map(([k, t]) => `<button type="button" data-mode="${k}" class="${mode === k ? "on" : ""}">${t}</button>`).join("")}</div>` : ""}</div>`;
    if (mode === "grid" && n > 1) {
      box.innerHTML = bar + `<div class="gal-grid">${imgs.map((x, k) => `<button type="button" data-go="${k}" title="${esc(x.caption || x.image_type)}"><img src="${esc(small(x))}" alt="${esc(x.caption)}" loading="lazy"><span>${esc(x.image_type)}</span></button>`).join("")}</div>`;
    } else if (mode === "list" && n > 1) {
      box.innerHTML = bar + `<div class="gal-list">${imgs.map((x, k) => `<figure><img src="${esc(big(x))}" alt="${esc(x.caption)}" loading="lazy" data-full="${k}"><figcaption><span class="muted">${k + 1} of ${n}</span> ${cap(x)}</figcaption></figure>`).join("")}</div>`;
    } else {
      box.innerHTML = bar + `<div class="gal-car">
        <figure class="g-main"><img src="${esc(big(i))}" alt="${esc(i.caption)}" data-full="${cur}">
          ${n > 1 ? `<button type="button" class="gnav prev" data-step="-1" title="Previous (←)">‹</button><button type="button" class="gnav next" data-step="1" title="Next (→)">›</button><span class="gcount">${cur + 1} / ${n}</span>` : ""}
          <figcaption>${cap(i)}</figcaption></figure>
        ${n > 1 ? `<div class="g-strip">${imgs.map((x, k) => `<button type="button" data-go="${k}" class="${k === cur ? "on" : ""}" title="${esc(x.image_type)}"><img src="${esc(small(x))}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}</div>`;
      box.querySelector(".g-strip .on")?.scrollIntoView({ block: "nearest", inline: "center" });
    }
    box.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { mode = b.dataset.mode; try { localStorage.setItem("gp_gallery", mode); } catch {} draw(); });
    box.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { cur = +b.dataset.go; mode = "carousel"; draw(); if (b.closest(".gal-grid")) box.scrollIntoView({ block: "start", behavior: "smooth" }); });
    box.querySelectorAll("[data-step]").forEach(b => b.onclick = () => step(+b.dataset.step));
    box.querySelectorAll("[data-full]").forEach(im => im.onclick = () => window.open(big(imgs[+im.dataset.full]), "_blank", "noopener"));
  };
  const step = d => { cur = (cur + d + imgs.length) % imgs.length; draw(); };
  // Arrow keys go through the images while this precedent is open (not while typing or with a window open).
  const onKey = e => {
    if (!document.body.contains(box)) return document.removeEventListener("keydown", onKey);
    if (mode !== "carousel" || imgs.length < 2 || e.target.closest("input, textarea, select") || document.querySelector("#modal:not([hidden])")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  };
  document.addEventListener("keydown", onKey);
  draw();
}

// Image picker: reads a web page and shows every photo on it in a grid; tick the ones you want. Tiny images (icons,
// logos) are hidden behind "show small ones". Images a site won't show directly are loaded through the site's proxy.
function imagePicker(box) {
  let page = null, urls = [], sel = new Set(), small = new Set(), broken = new Set(), showSmall = false;
  const proxied = u => `/api/proxy-image?url=${encodeURIComponent(u)}&t=${st.cfg.token}`;
  const visible = () => urls.filter(u => !broken.has(u) && (showSmall || !small.has(u)));
  const head = () => {
    const v = visible(), hid = urls.filter(u => small.has(u) && !broken.has(u)).length;
    box.querySelector(".ip-head").innerHTML = `<span><b>${v.length}</b> image${v.length === 1 ? "" : "s"} on ${esc(page.site || "the page")} · <b>${sel.size}</b> ticked</span>
      <span><button type="button" class="link" data-ip="all">Tick all</button> · <button type="button" class="link" data-ip="none">None</button>${hid ? ` · <button type="button" class="link" data-ip="small">${showSmall ? "Hide" : "Show"} ${hid} small</button>` : ""}</span>`;
    box.querySelectorAll("[data-ip]").forEach(b => b.onclick = () => {
      if (b.dataset.ip === "all") visible().forEach(u => sel.add(u));
      if (b.dataset.ip === "none") sel.clear();
      if (b.dataset.ip === "small") showSmall = !showSmall;
      cells();
    });
  };
  const cells = () => {
    box.querySelectorAll(".ip-cell").forEach(c => {
      const u = c.dataset.u;
      c.hidden = broken.has(u) || (!showSmall && small.has(u));
      c.classList.toggle("on", sel.has(u));
      c.querySelector("input").checked = sel.has(u);
    });
    head();
  };
  const draw = () => {
    if (!urls.length) { box.innerHTML = `<p class="msg">No photos found on that page. Try the Precedents button in your browser on the page itself, or save the images and drop them in.</p>`; return; }
    box.innerHTML = `<div class="ip-head"></div><div class="ip-grid">${urls.map(u => `<label class="ip-cell" data-u="${esc(u)}"><img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(u)}"><input type="checkbox"><span class="ip-size"></span></label>`).join("")}</div>`;
    box.querySelectorAll(".ip-cell").forEach(c => {
      const u = c.dataset.u, im = c.querySelector("img");
      im.onload = () => {
        c.querySelector(".ip-size").textContent = `${im.naturalWidth}×${im.naturalHeight}`;
        if (im.naturalWidth < 300 && im.naturalHeight < 300) { small.add(u); sel.delete(u); cells(); }
      };
      im.onerror = () => { if (!im.dataset.p) { im.dataset.p = 1; im.src = proxied(u); } else { broken.add(u); sel.delete(u); cells(); } };
      c.querySelector("input").onchange = e => { e.target.checked ? sel.add(u) : sel.delete(u); cells(); };
    });
    cells();
  };
  return {
    async load(url) {
      box.hidden = false;
      box.innerHTML = `<p class="muted small">Looking for images on the page...</p>`;
      try { page = await api(`/api/page-images?url=${encodeURIComponent(url)}`); }
      catch (e) {
        page = null;
        box.innerHTML = `<p class="msg bad">${esc(e.message)}.${e.status === 502 ? " Open the page and use the Precedents button in your browser instead: it can send images from any page you can see." : ""}</p>`;
        return null;
      }
      urls = page.images || []; sel = new Set(); small = new Set(); broken = new Set(); showSmall = false;
      draw();
      return page;
    },
    page: () => page,
    selected: () => urls.filter(u => sel.has(u) && !broken.has(u)),
    clear() { page = null; urls = []; sel = new Set(); box.innerHTML = ""; box.hidden = true; },
  };
}

// ---------- inbox ----------
function inboxThumb(i) {
  if (i.uploads?.length) return img(i.uploads[0].key);
  const u = i.draft?.images?.find(x => x.url)?.url || i.images?.[0];
  return u ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(u)}">` : `<span class="noimg">${i.url ? "Page" : "Text"}</span>`;
}

function renderInbox(id) {
  const items = st.inbox.filter(i => i.status === "new");
  const done = st.inbox.filter(i => i.status !== "new").slice(0, 12);
  const cur = id ? st.inbox.find(i => i.id === id) : null;
  const li = i => `<a class="ib ${i.id === id ? "on" : ""}" href="#/inbox/${i.id}">
      <div class="ib-ph">${inboxThumb(i)}</div>
      <div class="ib-t"><b>${i.target ? `+ ${esc(i.target)} ${esc(byId(i.target)?.name || "")}` : esc(i.draft?.record?.name || i.title || i.site || (i.uploads?.length ? `${i.uploads.length} photo${i.uploads.length > 1 ? "s" : ""}` : "Untitled"))}</b>
      <span>${esc(i.by)} · ${ago(i.created)}${i.status === "approved" ? ` · <em class="ok">${i.merged ? "merged into" : "new"} ${esc(i.record_id || "")}</em>` : i.status === "discarded" ? " · discarded" : i.draft ? " · drafted" : ""}</span></div></a>`;
  view.innerHTML = `
  <div class="inbox">
    <aside class="ib-list">
      <h2>Inbox <span class="muted">${items.length} to review</span></h2>
      ${items.length ? items.map(li).join("") : `<p class="muted small pad">Nothing waiting. Send precedents in with the extension or bookmark button, or from <a href="#/add">Add</a>.</p>`}
      ${done.length ? `<h3 class="muted small">Recently done</h3>${done.map(li).join("")}` : ""}
    </aside>
    <section class="ib-main" id="ib-main">${cur ? "" : `<div class="empty">Choose something on the left to review it.<br><span class="muted small">Groundwork drafts the record and checks for duplicates; you check it and approve. Anyone on the team can approve.</span></div>`}</section>
  </div>`;
  if (cur) openReview(cur);
}

async function openReview(item) {
  const box = document.getElementById("ib-main");
  if (item.status !== "new") {
    box.innerHTML = `<div class="empty">${item.status === "approved" ? `${item.merged ? "Merged into" : "Added to the library as"} <a href="#/p/${item.record_id}">${esc(item.record_id)}</a> by ${esc(item.status_by)}.` : `Discarded by ${esc(item.status_by)}.`}
      <p><button class="btn" id="reopen">Put back in the inbox</button> <button class="btn danger" id="del">Delete for good</button></p></div>`;
    document.getElementById("reopen").onclick = async () => { await api("/api/inbox", { method: "PATCH", body: { id: item.id, status: "new" } }); await loadInbox(); route(); };
    document.getElementById("del").onclick = async () => { await api(`/api/inbox?id=${item.id}`, { method: "DELETE" }); await loadInbox(); location.hash = "#/inbox"; };
    return;
  }
  if (!item.draft) {
    box.innerHTML = `${sourceStrip(item)}<div class="drafting"><div class="spinner"></div><p><b>Groundwork is drafting the record</b><br><span class="muted">Reading the page and images, choosing categories, checking for duplicates...</span></p></div>`;
    try {
      const out = await api("/api/draft", { method: "POST", body: { id: item.id } });
      Object.assign(item, out.item);
    } catch (e) {
      box.innerHTML = `${sourceStrip(item)}<div class="empty"><p class="bad">Couldn't draft it: ${esc(e.message)}</p><button class="btn" id="blank">Fill it in by hand</button> <button class="btn" id="retry">Try again</button></div>`;
      document.getElementById("retry").onclick = () => openReview(item);
      document.getElementById("blank").onclick = () => { item.draft = { record: { name: item.title || "", sources: item.url ? [`${item.title || item.url}, ${item.url}`] : [], facets: {} }, images: [], duplicates: [] }; openReview(item); };
      return;
    }
    if (!location.hash.endsWith(item.id)) return;   // moved on while drafting
  }
  const d = item.draft;
  const dupes = (d.duplicates || []).filter(x => byId(x.id));
  box.innerHTML = `${sourceStrip(item)}
    ${dupes.length ? `<div class="dupes"><b>Possibly already in the library:</b> ${dupes.map(x => `<span><a href="#/p/${x.id}" target="_blank">${x.id} ${esc(byId(x.id).name)}</a> <em>(${esc(x.why)})</em> <button class="link" data-merge="${x.id}">Add to this one instead</button></span>`).join(" ")}</div>` : ""}
    <div class="addto-row"><button class="btn" id="pick-existing">Add to an existing precedent...</button><span class="muted small">If this is already in the library, choose it: Groundwork reads both and proposes what to add.</span>
      <button class="link" id="redraft" title="Throw this draft away and have Groundwork draft it again">Draft again</button></div>
    ${d.notes || d.confidence === "low" ? `<div class="note-box"><b>Check:</b> ${esc(d.notes || "Groundwork wasn't confident about this draft.")}</div>` : ""}
    <div id="form-host"></div>`;
  const form = editorForm({ record: d.record, draftImages: d.images, item });
  document.getElementById("form-host").append(form.el);
  box.querySelectorAll("[data-merge]").forEach(b => b.onclick = () => form.mergeWith(b.dataset.merge));
  document.getElementById("redraft").onclick = () => { if (!confirm("Draft this again from scratch? Changes you've made here will be lost.")) return; item.draft = null; item.checked = false; openReview(item); };
  document.getElementById("pick-existing").onclick = async () => {
    const id = await pickPrecedent(d.record);
    if (id) form.mergeWith(id);
  };
  if (item.target && byId(item.target)) form.mergeWith(item.target);   // sent with "Add to this precedent"
  // Sent as just an image (no page, no text): Groundwork tries to identify the project online straight away.
  else if (!item.url && !item.text && !item.checked) { item.checked = true; form.fill({ auto: true }); }
}

// Choose a precedent from the library (searchable list). Resolves with its id, or null.
function pickPrecedent(hint = {}) {
  return new Promise(resolve => {
    const m = document.getElementById("modal"), card = document.getElementById("modal-card");
    const done = id => { closeModal(); resolve(id); };
    card.innerHTML = `<div class="modal-h"><h2>Add to an existing precedent</h2><button class="link" id="mclose">Cancel</button></div>
      <input id="pick-q" type="search" placeholder="Search by name, place or designer" autocomplete="off">
      <div class="pick-list" id="pick-list"></div>`;
    const words = String(hint.name || "").toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const score = r => words.filter(w => haystack(r).includes(w)).length;
    const show = q => {
      const qs = q.toLowerCase().split(/\s+/).filter(Boolean);
      const list = st.records.filter(r => qs.every(w => haystack(r).includes(w)))
        .sort((a, b) => (q ? 0 : score(b) - score(a)) || a.name.localeCompare(b.name)).slice(0, 60);
      document.getElementById("pick-list").innerHTML = list.length ? list.map(r => `<button class="pick" data-id="${r.id}">
        <span class="pick-ph">${primary(r) ? img(primary(r).thumb_key) : ""}</span>
        <span><b>${esc(r.name)}</b><br><span class="muted small">${r.id} · ${esc(place(r))}${designers(r) ? ` · ${esc(designers(r))}` : ""}</span></span></button>`).join("")
        : `<p class="muted pad">No precedents match.</p>`;
      card.querySelectorAll(".pick").forEach(b => b.onclick = () => done(b.dataset.id));
    };
    m.hidden = false; document.body.classList.add("noscroll");
    document.getElementById("mclose").onclick = () => done(null);
    const q = document.getElementById("pick-q");
    q.oninput = () => show(q.value.trim());
    show(""); q.focus();
  });
}

function sourceStrip(i) {
  return `<div class="srcstrip">
    <div><span class="muted">Sent by</span> <b>${esc(i.by)}</b> <span class="muted">${ago(i.created)}${i.from === "extension" ? " from the browser extension" : i.from === "upload" ? " (uploaded)" : i.from === "mac" ? " from the Mac" : ""}</span></div>
    ${i.url ? `<div class="u"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title || i.url)}</a> <span class="muted">${esc(i.site)}</span></div>` : ""}
    ${i.note ? `<div class="nt">“${esc(i.note)}”</div>` : ""}
    ${i.text ? `<details><summary>Highlighted text</summary><p class="pre small">${esc(i.text.slice(0, 3000))}</p></details>` : ""}
  </div>`;
}

// ---------- the record form (inbox review and edit) ----------
function editorForm({ record, draftImages = [], item = null, targetId = null }) {
  const el = document.createElement("form");
  el.className = "rf";
  let rec = record, target = targetId;
  // New list values Groundwork suggested while drafting (shown above the categories, one click to add).
  let suggest = (!targetId && item?.draft?.suggest) || [];
  // Images: existing ones on the record (keys) plus candidates from the inbox item (inbox upload keys or web urls).
  let pics = [], extra = [];   // extra: images added here with "Add images from a link"
  const setPics = () => {
    pics = [...(rec.images || []).map(i => ({ ...i, existing: true, keep: true })),
      ...draftImages.map(i => ({ ...i, existing: false })), ...extra];
    if (!pics.some(p => p.primary && p.keep)) { const f = pics.find(p => p.keep); if (f) f.primary = true; }
  };
  setPics();
  const c = st.cfg;
  const src = p => p.existing ? imgSrc(p.thumb_key) : p.key ? imgSrc(p.key) : p.url;
  const hintOf = f => (f.key === "summary" && rec.depth === "short" ? "one or two plain sentences: what, where, by whom, key material" : f.hint);
  const field = f => `<label class="fl ${f.long ? "long" : ""}"><span>${esc(f.label)}${hintOf(f) ? ` <em>${esc(hintOf(f))}</em>` : ""}</span>${f.long
    ? `<textarea name="${f.key}" rows="${f.key === "description" ? 6 : 3}">${esc(rec[f.key] || "")}</textarea>`
    : `<input name="${f.key}" value="${esc(rec[f.key] || "")}">`}</label>`;
  const short = c.fields.filter(x => !x.long);

  const draw = () => {
    el.innerHTML = `
    ${target ? `<div class="target">${item ? "Adding to" : "Saving to"} <b>${esc(target)}</b> ${esc(byId(target)?.name || "")}${item ? ` <button type="button" class="link" id="unmerge">Make it a new precedent instead</button>` : ""}</div>` : ""}
    <div id="prop-top"></div>
    <div class="fill-top" id="fill-top" hidden></div>
    <div class="rf-sec"><h3>Images <span class="muted small">Untick any to leave out. ★ is the main image.</span></h3>
      ${pics.length ? `<div class="pics">${pics.map((p, n) => `<div class="pic ${p.keep ? "" : "off"}">
        <div class="pic-img"><img alt="" referrerpolicy="no-referrer" src="${esc(src(p))}"><label class="keep"><input type="checkbox" data-keep="${n}" ${p.keep ? "checked" : ""}></label><button type="button" class="star ${p.primary ? "on" : ""}" data-star="${n}" title="Main image">★</button></div>
        <select data-itype="${n}">${c.imageTypes.map(t => `<option ${t === p.image_type ? "selected" : ""}>${t}</option>`).join("")}</select>
        <input data-credit="${n}" placeholder="Credit" value="${esc(p.credit || "")}">
      </div>`).join("")}</div>` : `<p class="muted small">No images yet.</p>`}
      <div class="addlink"><button type="button" class="btn" id="al-open">+ Add images from a link</button>
        <div id="al" hidden><div class="urlrow"><label class="fl long"><span>Web page with photos of this project</span><input type="url" id="al-url" placeholder="https://..."></label><button type="button" class="btn" id="al-get">Get images</button></div>
        <div class="ipick" id="al-imgs" hidden></div>
        <div class="al-actions"><button type="button" class="link" id="al-cancel">Cancel</button><span></span><button type="button" class="btn primary" id="al-add">Add ticked images</button></div></div></div>
    </div>
    <div class="rf-sec"><h3>Details
        <span class="seg depth" role="group" aria-label="How much to write"><button type="button" data-depth="short" class="${rec.depth === "short" ? "on" : ""}">Short record</button><button type="button" data-depth="full" class="${rec.depth !== "short" ? "on" : ""}">Full write-up</button></span></h3>
      <p class="muted small depth-note">${rec.depth === "short" ? "Short: the facts, a sentence or two, images, categories and materials. For general design precedents." : "Full: summary, why it matters for Greenshoot and a description. For Greenshoot projects and First Peoples precedents."}</p>
      <div class="fl-grid">${short.map(field).join("")}
        <label class="fl"><span>Status</span><select name="status">${c.status.map(s => `<option ${s === rec.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <label class="fl"><span>Scale</span><select name="scale"><option value=""></option>${c.scale.map(s => `<option ${s === rec.scale ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      </div>
      ${field(c.fields.find(x => x.key === "summary"))}
      ${rec.depth === "short"
        ? `<details class="more-write"${rec.why_it_matters || rec.description ? " open" : ""}><summary>Why it matters and description (optional for a short record)</summary>${c.fields.filter(x => x.long && x.key !== "summary").map(field).join("")}</details>`
        : c.fields.filter(x => x.long && x.key !== "summary").map(field).join("")}
      <div class="fillrow"><button type="button" class="btn" id="fill" ${fillRun ? "disabled" : ""}>✦ Check and fill online</button><span class="muted small" id="fill-msg">${esc(fillMsg || "Groundwork searches the web, then checks every field against what it finds and the record's own text. You choose which changes to keep.")}</span></div>
      <div id="fill-out"></div>
    </div>
    <div class="rf-sec"><h3>Categories <span class="muted small">Pick all that apply. These drive the library's filters. Missing one? + Add to the list.</span></h3>
      ${suggest.length ? `<div class="suggest">${suggest.map((x, n) => `<div><span>✦ Groundwork suggests a new ${esc(c.facets.find(f => f.key === x.facet)?.label || x.facet)} value: <b>${esc(x.value)}</b>. <span class="muted">${esc(x.reason)}</span></span>
        <button type="button" class="btn" data-sug="${n}">Add it to the list</button><button type="button" class="link" data-nosug="${n}">Not needed</button></div>`).join("")}</div>` : ""}
      ${c.facets.map(f => `<div class="facet"><h4>${esc(f.label)} <em>${esc(f.hint)}</em></h4><div class="tog">${f.values.map(v => `<label><input type="checkbox" name="f:${f.key}" value="${esc(v)}" ${(rec.facets?.[f.key] || []).includes(v) ? "checked" : ""}><span>${esc(v)}</span></label>`).join("")}<button type="button" class="addval" data-addval="${f.key}" title="Add a value to ${esc(f.label)} for everyone">+ Add</button></div>
        ${f.key === "materials" ? `<label class="fl long mdet"><span>Specific materials <em>the exact materials and finishes, separated by commas (anything: "Corten steel, Spotted gum, Bluestone")</em></span><input name="material_details" list="mdet-list" value="${esc((rec.material_details || []).join(", "))}"><datalist id="mdet-list">${[...new Set(st.records.flatMap(r => r.material_details || []))].sort().map(d => `<option value="${esc(d)}">`).join("")}</datalist></label>` : ""}</div>`).join("")}
      <label class="fl long"><span>Tags <em>anything the categories don't cover, separated by commas</em></span><input name="tags" value="${esc((rec.tags || []).join(", "))}"></label>
    </div>
    <div class="rf-sec"><h3>Sources and Greenshoot use</h3>
      <label class="fl long"><span>Sources <em>one per line, "Title, url"</em></span><textarea name="sources" rows="3">${esc((rec.sources || []).join("\n"))}</textarea></label>
      <div class="fl-grid">
        <label class="check"><input type="checkbox" name="greenshoot_project" ${rec.greenshoot_project ? "checked" : ""}> A Greenshoot project</label>
        <label class="fl"><span>Used in Greenshoot projects <em>comma separated</em></span><input name="used_in" value="${esc((rec.used_in || []).join(", "))}"></label>
        <label class="check"><input type="checkbox" name="sensitive" ${rec.sensitive ? "checked" : ""}> Culturally sensitive: not for client material</label>
        <label class="fl"><span>Sensitivity note</span><input name="sensitive_note" value="${esc(rec.sensitive_note || "")}"></label>
      </div>
    </div>
    <div class="rf-actions">
      ${item ? `<button type="button" class="btn danger" id="discard">Discard</button>` : `<button type="button" class="btn" id="cancel">Cancel</button>`}
      <span class="muted small">${item ? `Sent by ${esc(item.by)} · you're approving as ${esc(getAuth().name)}` : `Editing as ${esc(getAuth().name)}`}</span>
      <button class="btn primary" id="save">${item ? (target ? `Approve and update ${target}` : "Approve and add to library") : "Save changes"}</button>
    </div>
    <p class="msg" id="rf-msg" role="status"></p>`;

    el.querySelectorAll("[data-keep]").forEach(x => x.onchange = () => { sync(); pics[+x.dataset.keep].keep = x.checked; if (!x.checked && pics[+x.dataset.keep].primary) { pics[+x.dataset.keep].primary = false; const f = pics.find(p => p.keep); if (f) f.primary = true; } keepScroll(draw); });
    el.querySelectorAll("[data-star]").forEach(x => x.onclick = () => { sync(); pics.forEach((p, n) => { p.primary = n === +x.dataset.star; if (p.primary) p.keep = true; }); keepScroll(draw); });
    el.querySelectorAll("[data-itype]").forEach(x => x.onchange = () => { pics[+x.dataset.itype].image_type = x.value; });
    el.querySelectorAll("[data-credit]").forEach(x => x.oninput = () => { pics[+x.dataset.credit].credit = x.value; });
    el.querySelector("#discard")?.addEventListener("click", async () => {
      await api("/api/inbox", { method: "PATCH", body: { id: item.id, status: "discarded" } });
      await loadInbox(); toast("Discarded"); location.hash = "#/inbox";
    });
    el.querySelector("#cancel")?.addEventListener("click", closeModal);
    el.querySelector("#unmerge")?.addEventListener("click", () => { rec = item.draft.record; target = null; topHTML = ""; topAns = null; setPics(); draw(); });
    if (topHTML) { el.querySelector("#prop-top").innerHTML = topHTML; wireProposals(el.querySelector("#prop-top"), topAns); }
    el.querySelector("#fill").onclick = () => fillGaps();
    if (fillRun || fillAns || (fillAuto && fillMsg)) setFill(fillMsg, true);   // keep the check's progress and results after a redraw
    wireAddLink();
    el.querySelectorAll("[data-depth]").forEach(b => b.onclick = () => { sync(); rec = { ...rec, depth: b.dataset.depth }; keepScroll(draw); });
    el.querySelectorAll("[data-addval]").forEach(b => b.onclick = () => addValue(b.dataset.addval));
    el.querySelectorAll("[data-sug]").forEach(b => b.onclick = () => { const x = suggest[+b.dataset.sug]; suggest = suggest.filter(y => y !== x); addValue(x.facet, x.value); });
    el.querySelectorAll("[data-nosug]").forEach(b => b.onclick = () => { sync(); suggest = suggest.filter((_, n) => n !== +b.dataset.nosug); keepScroll(draw); });
    // Flag images too small to use well (under 800 px both ways), so a better copy can be found before approving.
    el.querySelectorAll(".pic-img img").forEach(im => { const flag = () => { if (im.naturalWidth && im.naturalWidth < 800 && im.naturalHeight < 800) im.insertAdjacentHTML("afterend", `<span class="lowres" title="${im.naturalWidth}×${im.naturalHeight} px">Low res</span>`); }; im.complete ? flag() : im.addEventListener("load", flag, { once: true }); });
  };
  // Add a value to a category list for everyone (e.g. a new Materials group), and tick it on this record.
  async function addValue(facet, value) {
    const f = c.facets.find(x => x.key === facet);
    if (value == null) value = prompt(`New value for ${f.label} (for everyone).\nCheck the list first: is it really missing?`);
    if (!value || !value.trim()) return;
    sync();
    try {
      const out = await api("/api/categories", { method: "POST", body: { facet, value: value.trim() } });
      st.cfg.facets = out.facets;
      rec = { ...rec, facets: { ...rec.facets, [facet]: [...new Set([...(rec.facets?.[facet] || []), out.value])] } };
      keepScroll(draw);
      toast(`"${out.value}" is in the ${f.label} list now, and ticked here.`);
    } catch (e) { toast(`Couldn't add it: ${e.message}`); }
  }
  // Keep what's been typed when the form redraws.
  const sync = () => { if (el.querySelector("[name=name]")) rec = { ...rec, ...read() }; };

  // "Add images from a link": read a page, tick photos, and they join the images above (saved when you approve or save).
  function wireAddLink() {
    const box = el.querySelector("#al"), urlIn = el.querySelector("#al-url"), web = imagePicker(el.querySelector("#al-imgs"));
    let loaded = "";
    const get = () => { const u = urlIn.value.trim(); if (!/^https?:\/\//.test(u)) { urlIn.reportValidity(); return; } if (u !== loaded) { loaded = u; web.load(u); } };
    el.querySelector("#al-open").onclick = () => {
      box.hidden = false; el.querySelector("#al-open").hidden = true;
      // Start from the page this came from, or the record's first source.
      urlIn.value = item?.url || (rec.sources || []).map(x => (x.match(/https?:\/\/\S+/) || [])[0]).find(Boolean) || "";
      if (urlIn.value) get(); else urlIn.focus();
    };
    el.querySelector("#al-get").onclick = get;
    urlIn.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); get(); } };
    urlIn.onpaste = () => setTimeout(get, 0);
    el.querySelector("#al-cancel").onclick = () => { web.clear(); box.hidden = true; el.querySelector("#al-open").hidden = false; };
    el.querySelector("#al-add").onclick = () => {
      const pg = web.page(), have = new Set(pics.map(p => p.url).filter(Boolean)), urls = web.selected().filter(u => !have.has(u));
      if (!pg || !urls.length) { toast("Tick some images first."); return; }
      sync();
      const add = urls.map(u => ({ url: u, image_type: "Photo", caption: "", credit: pg.site || "", keep: true, existing: false, source_url: pg.url }));
      extra.push(...add); pics.push(...add);
      if (!pics.some(p => p.primary && p.keep)) { const f = pics.find(p => p.keep); if (f) f.primary = true; }
      if (!(rec.sources || []).some(x => x.includes(pg.url))) rec = { ...rec, sources: [...(rec.sources || []), `${pg.title || pg.site}, ${pg.url}`] };
      keepScroll(draw);
      toast(`${add.length} image${add.length === 1 ? "" : "s"} added. Set their types below, then ${item ? "approve" : "save"}.`);
    };
  }
  const keepScroll = fn => { const y = window.scrollY, m = document.getElementById("modal-card"), my = m?.scrollTop; fn(); window.scrollTo(0, y); if (m) m.scrollTop = my; };

  const read = () => {
    const fd = new FormData(el), o = {};
    o.depth = rec.depth === "short" ? "short" : "full";
    o.material_details = String(fd.get("material_details") || "").split(",").map(s => s.trim()).filter(Boolean);
    for (const f of c.fields) o[f.key] = (fd.has(f.key) ? fd.get(f.key) : rec[f.key] || "").trim();
    o.status = fd.get("status"); o.scale = fd.get("scale");
    o.facets = Object.fromEntries(c.facets.map(f => [f.key, fd.getAll("f:" + f.key)]));
    o.tags = String(fd.get("tags") || "").split(",").map(s => s.trim()).filter(Boolean);
    o.sources = String(fd.get("sources") || "").split("\n").map(s => s.trim()).filter(Boolean);
    o.used_in = String(fd.get("used_in") || "").split(",").map(s => s.trim()).filter(Boolean);
    o.greenshoot_project = !!fd.get("greenshoot_project"); o.sensitive = !!fd.get("sensitive");
    o.sensitive_note = (fd.get("sensitive_note") || "").trim();
    return o;
  };

  // Check and fill online. Its progress and results are kept here (not only on the page), so they survive the form
  // redrawing, and a run that started by itself (a photo with nothing else to go on) shows at the top of the form too.
  let fillRun = false, fillMsg = "", fillAns = null, fillAuto = false;
  const setFill = (m, done) => {
    fillMsg = m;
    const msg = el.querySelector("#fill-msg"); if (msg) msg.textContent = m;
    const btn = el.querySelector("#fill"); if (btn) btn.disabled = fillRun;
    const top = el.querySelector("#fill-top");
    if (top && fillAuto) {
      top.hidden = false;
      const n = fillAns ? fillAns.changes.length + Object.values(fillAns.add_facets || {}).flat().length + (fillAns.add_material_details || []).length : 0;
      top.innerHTML = fillRun ? `<span class="spinner sm"></span> <span><b>Checking online for more details</b> <span class="muted">${esc(m)}</span></span>`
        : n ? `<span>✦ <b>Check and fill online found ${n} thing${n === 1 ? "" : "s"} to add.</b></span> <button type="button" class="btn" id="fill-jump">See them</button>`
        : `<span>✦ ${esc(m)}</span>`;
      top.querySelector("#fill-jump")?.addEventListener("click", () => el.querySelector("#fill-out")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    if (done) {
      const box = el.querySelector("#fill-out");
      if (box) { box.innerHTML = fillAns ? proposalsHTML(fillAns, false) : ""; if (fillAns) wireProposals(box, fillAns); }
    }
  };
  async function fillGaps(opts = {}) {
    if (fillRun) return;
    fillAuto = !!opts.auto; fillRun = true; fillAns = null;
    setFill("Searching the web...", true);
    const record = read();
    const images = pics.filter(p => p.keep).slice(0, 3).map(p => (p.existing ? { key: p.key } : p.key ? { key: p.key } : { url: p.url }));
    let notes = "", searchNote = "";
    const search = async quick => {
      const res = await api("/api/research", { method: "POST", body: { record, images, quick }, raw: true });
      return readWebStream(res, n => setFill(`Searching the web (${n} search${n === 1 ? "" : "es"})...`));
    };
    try {
      let r = await search(false);
      // Netlify stops it after about 30 seconds: with nothing written yet, one quicker try.
      if (!r.text) { setFill("The web search ran out of time, trying a quicker one..."); r = await search(true); }
      notes = r.text;
      if (!notes) searchNote = "Groundwork couldn't find this online in time (add a name, place or link and run it again for more). ";
    } catch (e) { searchNote = `The web search didn't work (${e.message}), so this check uses the record's own text only. `; }
    setFill("Checking every field...");
    try {
      const res = await api("/api/check", { method: "POST", body: { record, notes }, raw: true });
      const { value: raw, complete } = await readJSONAnswer(res);
      fillAns = tidyCheck(raw, record);
      fillRun = false;
      setFill(searchNote + (complete ? fillAns.summary || "Checked." : "Groundwork ran out of time partway (the site stops after about 30 seconds), so this is the first part of the check. Use what's here, then run it again for the rest."), true);
    } catch (e) { fillRun = false; setFill(`Couldn't check: ${e.message}`, true); }
  }

  // Proposed changes (Check and fill, or adding to an existing precedent): a table of changes with ticks.
  let topAns = null, topHTML = "";
  function proposalsHTML(ans, tickAll) {
    const label = k => c.fields.find(f => f.key === k)?.label || (k === "status" ? "Status" : k === "scale" ? "Scale" : k);
    const facetLabel = k => c.facets.find(f => f.key === k)?.label || k;
    const addF = Object.entries(ans.add_facets || {});
    const urlIn = s => (String(s).match(/https?:\/\/\S+/) || [])[0];
    const any = ans.changes.length || addF.length || ans.add_tags.length || ans.add_sources.length || (ans.add_material_details || []).length;
    if (!any) return `<p class="muted small">${ans.caveats ? esc(ans.caveats) : "Nothing to add or change."}</p>`;
    return `<div class="fill-box">
      ${ans.changes.length ? `<table class="chg"><thead><tr><th></th><th>Field</th><th>Now</th><th>Suggested</th><th>Why</th></tr></thead><tbody>
        ${ans.changes.map((ch, n) => `<tr><td><input type="checkbox" data-chg="${n}" ${tickAll || !ch.current ? "checked" : ""}></td><td><b>${esc(label(ch.field))}</b></td>
          <td class="${ch.current ? "" : "muted"}">${esc((ch.current || "empty").slice(0, 160))}${ch.current.length > 160 ? "..." : ""}</td><td>${esc(ch.value.slice(0, 600))}${ch.value.length > 600 ? "..." : ""}</td>
          <td class="small">${esc(ch.reason)} ${urlIn(ch.source) ? `<a href="${esc(urlIn(ch.source))}" target="_blank" rel="noopener">source</a>` : `<span class="muted">(${esc(ch.source)})</span>`}</td></tr>`).join("")}
      </tbody></table>` : ""}
      ${addF.map(([k, vs]) => `<div><b>Add to ${esc(facetLabel(k))}:</b> ${vs.map(v => `<label class="inl"><input type="checkbox" data-fac="${esc(k)}" value="${esc(v)}" checked> ${esc(v)}</label>`).join(" ")}</div>`).join("")}
      ${(ans.add_material_details || []).length ? `<div><b>Add specific materials:</b> ${ans.add_material_details.map(t => `<label class="inl"><input type="checkbox" data-mdet value="${esc(t)}" checked> ${esc(t)}</label>`).join(" ")}</div>` : ""}
      ${ans.add_tags.length ? `<div><b>Add tags:</b> ${ans.add_tags.map(t => `<label class="inl"><input type="checkbox" data-tag value="${esc(t)}" checked> ${esc(t)}</label>`).join(" ")}</div>` : ""}
      ${ans.add_sources.length ? `<div><b>Add sources:</b> ${ans.add_sources.map(s => `<label class="inl"><input type="checkbox" data-src value="${esc(s)}" checked> ${esc(s)}</label>`).join(" ")}</div>` : ""}
      ${ans.caveats ? `<div class="muted">${esc(ans.caveats)}</div>` : ""}
      <p class="small muted">${tickAll ? "Everything is ticked. Untick anything you don't want to bring in." : "Ticked: new information for empty fields. Unticked: changes to things already filled in. Tick what you want to keep."}</p>
      <p><button type="button" class="btn primary" data-use>Use selected</button> <button type="button" class="btn" data-nouse>Leave it</button></p></div>`;
  }
  function wireProposals(box, ans) {
    box.querySelector("[data-use]")?.addEventListener("click", () => {
      const cur = read();
      box.querySelectorAll("[data-chg]:checked").forEach(x => { const ch = ans.changes[+x.dataset.chg]; cur[ch.field] = ch.value; });
      box.querySelectorAll("[data-fac]:checked").forEach(x => { cur.facets[x.dataset.fac] = [...new Set([...(cur.facets[x.dataset.fac] || []), x.value])]; });
      box.querySelectorAll("[data-tag]:checked").forEach(x => { if (!cur.tags.includes(x.value)) cur.tags.push(x.value); });
      box.querySelectorAll("[data-mdet]:checked").forEach(x => { if (!cur.material_details.some(d => d.toLowerCase() === x.value.toLowerCase())) cur.material_details.push(x.value); });
      box.querySelectorAll("[data-src]:checked").forEach(x => { if (!cur.sources.includes(x.value)) cur.sources.push(x.value); });
      if (box.id === "prop-top") topHTML = ""; else { fillAns = null; fillAuto = false; }
      rec = { ...rec, ...cur }; keepScroll(draw); toast("Changes added. Check them over before saving.");
    });
    box.querySelector("[data-nouse]")?.addEventListener("click", () => { box.innerHTML = ""; if (box.id === "prop-top") topHTML = ""; else { fillAns = null; el.querySelector("#fill-top")?.setAttribute("hidden", ""); } });
  }

  // Add this inbox item to a precedent already in the library: start from the existing record (its images kept,
  // the new ones offered), and have Groundwork propose what the new material adds.
  async function mergeWith(id) {
    const existing = byId(id);
    if (!existing) return;
    rec = structuredClone(existing); target = id; setPics();
    pics.filter(p => !p.existing).forEach(p => { p.primary = false; });
    topHTML = `<div class="drafting small-pad"><div class="spinner"></div><p><b>Reading ${esc(id)} and the new material</b><br><span class="muted">Working out what to add...</span></p></div>`;
    draw();
    el.querySelector("#prop-top").scrollIntoView({ block: "nearest" });
    try {
      const res = await api("/api/merge", { method: "POST", raw: true, body: { target: existing, incoming: item?.draft?.record || {}, note: item?.note || "", text: item?.text || "", url: item?.url || "" } });
      const { value: raw, complete } = await readJSONAnswer(res);
      if (target !== id) return;   // changed their mind while it was working
      const ans = tidyCheck(raw, existing);
      if (item?.url && !(existing.sources || []).some(x => x.includes(item.url)) && !ans.add_sources.some(x => x.includes(item.url))) ans.add_sources.push(`${item.title || item.site || "Web page"}, ${item.url}`);
      topAns = ans;
      topHTML = `<div class="prop-h"><b>What the new material adds to ${esc(id)}</b> <span class="muted">${esc(complete ? ans.summary : "Groundwork ran out of time partway, so this is part of it: use what's here, then Check and fill online for the rest.")}</span></div>` + proposalsHTML(ans, true);
    } catch (e) {
      topHTML = `<p class="bad small">Couldn't work out the changes: ${esc(e.message)}. You can still edit the fields by hand, then approve.</p>`;
    }
    keepScroll(draw);
  }

  el.onsubmit = async e => {
    e.preventDefault();
    const msg = el.querySelector("#rf-msg"), btn = el.querySelector("#save");
    const r = read();
    if (!r.name) { msg.className = "msg bad"; msg.textContent = "Give it a name first."; return; }
    btn.disabled = true; msg.className = "msg"; msg.textContent = "Preparing images...";
    try {
      const kept = pics.filter(p => p.keep);
      r.images = kept.filter(p => p.existing).map(p => ({ ...p }));
      const newImages = [], todo = kept.filter(p => !p.existing);
      for (const [n, p] of todo.entries()) {
        msg.textContent = `Uploading images (${n + 1} of ${todo.length})...`;
        try {
          const blob = p.key
            ? await (await fetch(imgSrc(p.key))).blob()
            : await api(`/api/proxy-image?url=${encodeURIComponent(p.url)}`, { raw: true }).then(x => x.blob());
          const [big, thumb] = await Promise.all([shrink(blob, 1800, 0.82), shrink(blob, 560, 0.78)]);
          const up = await api("/api/upload", { method: "POST", body: { data: await toBase64(big), thumb: await toBase64(thumb) } });
          newImages.push({ key: up.key, thumb_key: up.thumb_key, image_type: p.image_type, caption: p.caption || "", credit: p.credit || "", source_url: p.source_url || "", primary: !!p.primary });
        } catch (err) { console.warn("image skipped", err); }
      }
      if (newImages.length < kept.filter(p => !p.existing).length) toast("Some images couldn't be downloaded and were left out.");
      r.images.forEach(i => { i.primary = !!i.primary && !newImages.some(n => n.primary); });
      msg.textContent = "Saving to the library...";
      const out = await api("/api/save", { method: "POST", body: { record: r, inboxId: item?.id, targetId: target, newImages } });
      await Promise.all([loadLibrary(), item ? loadInbox() : null]);
      closeModal();
      toast(`${out.record.id} ${out.record.name} ${item ? (target ? "updated" : "added to the library") : "saved"}`);
      if (location.hash === `#/p/${out.record.id}`) route(); else location.hash = `#/p/${out.record.id}`;
    } catch (err) {
      msg.className = "msg bad"; msg.textContent = `Couldn't save: ${err.message}`; btn.disabled = false;
    }
  };

  draw();
  return { el, read, fill: fillGaps, mergeWith };
}

// Check and fill's answer, tidied: no changes that change nothing, one change per field, only listed categories.
function tidyCheck(out, record) {
  const c = st.cfg, same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const fieldKeys = [...c.fields.map(f => f.key), "status", "scale"];
  const changes = (out.changes || [])
    .filter(ch => fieldKeys.includes(ch.field) && ch.value && !same(ch.value, record[ch.field]))
    .filter(ch => (ch.field === "status" ? c.status.includes(ch.value) : ch.field === "scale" ? c.scale.includes(ch.value) : true))
    .filter((ch, i, a) => a.findIndex(x => x.field === ch.field) === i)
    .map(ch => ({ reason: "", source: "", ...ch, current: record[ch.field] || "" }));
  const add_facets = {};
  for (const f of c.facets) {
    const have = record.facets?.[f.key] || [];
    const add = [...new Set(out.add_facets?.[f.key] || [])].filter(v => f.values.includes(v) && !have.includes(v));
    if (add.length) add_facets[f.key] = add;
  }
  const add_tags = [...new Set((out.add_tags || []).map(t => String(t).toLowerCase().trim()))].filter(t => t && !(record.tags || []).includes(t));
  const add_sources = [...new Set(out.add_sources || [])].filter(x => x && !(record.sources || []).includes(x));
  const haveM = (record.material_details || []).map(d => d.toLowerCase());
  const add_material_details = [...new Set(out.add_material_details || [])].filter(d => d && !haveM.includes(String(d).toLowerCase()));
  return { summary: out.summary || "", changes, add_facets, add_tags, add_sources, add_material_details, caveats: out.caveats || "" };
}

function openEditor({ record, targetId }) {
  const m = document.getElementById("modal"), card = document.getElementById("modal-card");
  card.innerHTML = `<div class="modal-h"><h2>Edit ${esc(targetId)}</h2><button class="link" id="mclose">Close</button></div>`;
  card.append(editorForm({ record, targetId }).el);
  m.hidden = false; document.body.classList.add("noscroll");
  document.getElementById("mclose").onclick = closeModal;
}
function closeModal() { document.getElementById("modal").hidden = true; document.body.classList.remove("noscroll"); }
document.addEventListener("keydown", e => { if (e.key === "Escape" && !document.getElementById("modal").hidden) closeModal(); });

// ---------- add ----------
function renderAdd() {
  view.innerHTML = `
  <div class="page add">
    <h1>Add a precedent</h1>
    <p class="muted">Everything goes to the <a href="#/inbox">inbox</a> first. Groundwork drafts the record and its categories, then anyone on the team checks and approves it.</p>
    <div class="add-cols">
      <form class="panel" id="by-link">
        <h2>From a web page</h2>
        <label class="fl long"><span>Web address</span><input name="url" type="url" placeholder="https://www.archdaily.com/..." required></label>
        <label class="fl long"><span>Note <em>optional</em></span><input name="note" placeholder="e.g. good example of a weaving-pattern screen"></label>
        <button class="btn primary">Send to the inbox</button>
        <p class="muted small">Quicker: use the browser extension or the bookmark button on the page itself. See <a href="start.html" target="_blank">Get started</a>.</p>
      </form>
      <form class="panel" id="by-photos">
        <h2>Photos and images</h2>
        <label class="drop" id="drop"><input type="file" accept="image/*" multiple hidden id="files"><span><b>Drop photos or images here</b>, paste a screenshot (Cmd/Ctrl+V), or click to choose<br><em>Drag images straight from another web page too. Up to 20 at a time. Works from a phone.</em></span></label>
        <div class="drop-list" id="drop-list"></div>
        <div class="split" id="split" hidden></div>
        <label class="fl long"><span>Which project is this? <em>optional: a descriptive file name ("Project Name - Designer.jpg") works too</em></span><input name="note" placeholder="e.g. Bunjil Place forecourt, Narre Warren. Site visit Nov 2026"></label>
        <button class="btn primary">Send to the inbox</button>
      </form>
    </div>
    <div class="panel bm">
      <h2>Bookmark button</h2>
      <p>Drag this to your browser's bookmarks bar. On any web page, highlight text if you like, then click it to send the page and its images to the inbox.</p>
      <p><a class="btn primary bm-btn" href="${bookmarklet(location.origin)}" onclick="return false">Send to Precedents</a></p>
    </div>
  </div>`;
  document.getElementById("by-link").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/inbox", { method: "POST", body: { url: fd.get("url"), title: "", note: fd.get("note"), from: "web" } });
      await loadInbox(); toast("Sent to the inbox"); e.target.reset();
    } catch (err) { toast(`Couldn't send: ${err.message}`); }
  };
  // Photos named after different projects ("Granite Island Causeway - TRACT.webp", "Mount Archer Treetop
  // Boardwalk.jpeg") are offered as separate precedents, one per name.
  const splitBox = document.getElementById("split");
  const groups = () => {
    const g = new Map();
    for (const f of pick.files()) { const n = nameFromFile(f.name); const k = n.toLowerCase(); if (!g.has(k)) g.set(k, { name: n, files: [] }); g.get(k).files.push(f); }
    return [...g.values()];
  };
  const showSplit = () => {
    const g = groups(), ok = g.length > 1 && g.every(x => x.name) && !pick.webImgs().length;
    splitBox.hidden = !ok;
    if (ok) splitBox.innerHTML = `<label class="check"><input type="checkbox" id="split-on" checked> Send as ${g.length} separate precedents, one per file name</label>
      <ul>${g.map(x => `<li>${esc(x.name)} <span class="muted">${x.files.length} photo${x.files.length > 1 ? "s" : ""}</span></li>`).join("")}</ul>`;
  };
  const pick = photoPicker(document.getElementById("drop"), document.getElementById("files"), document.getElementById("drop-list"), showSplit);
  document.getElementById("by-photos").onsubmit = async e => {
    e.preventDefault();
    if (!pick.count()) return toast("Add some photos or images first");
    const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Sending...";
    try {
      const note = new FormData(e.target).get("note") || "";
      const g = groups();
      if (!splitBox.hidden && document.getElementById("split-on")?.checked) {
        for (const [n, x] of g.entries()) { btn.textContent = `Sending ${n + 1} of ${g.length}...`; await sendToInbox({ note, title: x.name }, x.files, []); }
        await loadInbox(); toast(`${g.length} precedents sent to the inbox`);
      } else {
        await sendToInbox({ note, title: note }, pick.files(), pick.webImgs());
        await loadInbox(); toast("Photos sent to the inbox");
      }
      pick.clear(); e.target.reset(); showSplit();
    } catch (err) { toast(`Couldn't send: ${err.message}`); }
    btn.disabled = false; btn.textContent = "Send to the inbox";
  };
}

// ---------- categories (#/categories): the lists, and adding to them ----------
async function renderCategories() {
  view.innerHTML = `<div class="page"><p class="muted">Loading the lists...</p></div>`;
  try { st.cfg.facets = (await api("/api/categories")).facets; } catch (e) { toast(e.message); }
  const used = (k, v) => st.records.filter(r => (r.facets?.[k] || []).includes(v)).length;
  const details = {};
  st.records.forEach(r => (r.material_details || []).forEach(d => { details[d] = (details[d] || 0) + 1; }));
  view.innerHTML = `<div class="page cats">
    <a class="link" href="#/library">← Library</a>
    <h1>Categories</h1>
    <p class="muted">The lists every precedent is sorted by. Anyone can add a value when something genuinely doesn't fit
      (Groundwork also suggests new ones while drafting). Keep values broad and in the same style: the exact material or
      technique goes in the precedent's specific materials or tags. A value you added can be removed while no precedent uses it.</p>
    ${st.cfg.facets.map(f => `<section class="cat"><h3>${esc(f.label)} <em class="muted small">${esc(f.hint)}</em></h3>
      <div class="chips">${f.values.map(v => { const a = (f.added || []).find(x => x.value === v), n = used(f.key, v);
        return `<span class="chip ${a ? "added" : ""}" title="${a ? `Added by ${esc(a.by || "someone")}${a.at ? `, ${fmtDate(a.at)}` : ""}` : "In the base list"}">${esc(v)} <span class="muted">${n}</span>${a && !n ? ` <button type="button" class="x" data-del="${f.key}" data-v="${esc(v)}" title="Remove">×</button>` : ""}</span>`; }).join("")}</div>
      <form class="addv" data-facet="${f.key}"><input placeholder="New ${esc(f.label.toLowerCase())} value" maxlength="60"><button class="btn">Add</button></form>
      ${f.key === "materials" && Object.keys(details).length ? `<p class="small"><b>Specific materials in use:</b> ${Object.entries(details).sort((a, b) => a[0].localeCompare(b[0])).map(([d, n]) => `${esc(d)} <span class="muted">${n}</span>`).join(" · ")}</p>` : ""}
    </section>`).join("")}
  </div>`;
  view.querySelectorAll(".addv").forEach(fm => fm.onsubmit = async e => {
    e.preventDefault();
    const v = fm.querySelector("input").value.trim();
    if (!v) return;
    try { const out = await api("/api/categories", { method: "POST", body: { facet: fm.dataset.facet, value: v } }); st.cfg.facets = out.facets; toast(`Added "${out.value}"`); renderCategories(); }
    catch (err) { toast(err.message); }
  });
  view.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    try { const out = await api("/api/categories", { method: "DELETE", body: { facet: b.dataset.del, value: b.dataset.v } }); st.cfg.facets = out.facets; toast("Removed"); renderCategories(); }
    catch (err) { toast(err.message); }
  });
}

// ---------- admin (#/admin): image storage ----------
async function renderAdmin() {
  view.innerHTML = `<div class="page"><h1>Image storage</h1><p class="muted">Loading...</p></div>`;
  let s0;
  try { s0 = await api("/api/move-images"); } catch (e) { view.innerHTML = `<div class="page"><p class="bad">${esc(e.message)}</p></div>`; return; }
  view.innerHTML = `<div class="page admin">
    <h1>Image storage</h1>
    <p>${s0.remote ? "<b>Cloudflare is set up.</b> New images are stored there, and everyone views and downloads them straight from Cloudflare (no Netlify traffic)." : "<b>Images are in Netlify.</b> Set up Cloudflare (see <code>cloudflare/README.md</code> in the code) to store and serve them there."}</p>
    <div class="panel"><h2>Key for the Cloudflare Worker</h2>
      <p class="muted">The Worker's <b>IMAGE_TOKEN</b> secret must be exactly this. It comes from the team password, so if you change the password, update it in Cloudflare too.</p>
      <p><code class="tok">${esc(s0.imageToken)}</code> <button class="btn" id="copytok">Copy</button></p></div>
    <div class="panel"><h2>Copy existing images to Cloudflare</h2>
      <p class="muted">${s0.total} image file${s0.total === 1 ? "" : "s"} (with thumbnails) in Netlify. Copying is safe to repeat and deletes nothing.</p>
      <p><button class="btn primary" id="move" ${s0.remote && s0.total ? "" : "disabled"}>Copy images to Cloudflare</button></p>
      <p class="msg" id="move-msg"></p></div>
  </div>`;
  document.getElementById("copytok").onclick = () => navigator.clipboard.writeText(s0.imageToken).then(() => toast("Copied"));
  document.getElementById("move").onclick = async e => {
    const btn = e.target, msg = document.getElementById("move-msg");
    btn.disabled = true;
    let after = "", done = false;
    try {
      while (!done) {
        const r = await api("/api/move-images", { method: "POST", body: { after } });
        after = r.next; done = r.done;
        msg.textContent = `Copied ${r.position} of ${r.total}...`;
      }
      msg.textContent = `Done: all ${s0.total} image files are at Cloudflare.`;
      await loadLibrary();
    } catch (err) { msg.className = "msg bad"; msg.textContent = `Stopped: ${err.message}. Click again to carry on.`; btn.disabled = false; }
  };
}

start();
export const _test = { st };
