// Groundworked Precedents: the library, the inbox review and the Add page. One page, views chosen by the address
// (#/library, #/p/PR-0001, #/inbox, #/inbox/<id>, #/add). Records come from /api/library; nothing is saved until
// someone approves (inbox) or saves an edit, which commits to the data repo.
import { esc, api, setAuth, getAuth, toast, shrink, toBase64, readWebText } from "./util.js";
import { bookmarklet } from "./bookmarklet.js";

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
  renderLibrary();
}
window.addEventListener("hashchange", route);

// ---------- helpers ----------
const img = (key, cls = "") => key ? `<img class="${cls}" loading="lazy" alt="" src="/api/img?k=${encodeURIComponent(key)}&t=${st.cfg.token}">` : "";
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
  r.description, ...allFacetValues(r), ...(r.tags || []), ...(r.used_in || [])].join(" ").toLowerCase();

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
  const facetBlocks = st.cfg.facets.filter(f => (r.facets?.[f.key] || []).length).map(f =>
    `<div class="fb"><h4>${esc(f.label)}</h4><div class="chips big">${r.facets[f.key].map(v => `<button data-filter="${f.key}" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div></div>`).join("");
  const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : "");
  const link = s => { const m = String(s).match(/^(.*?),?\s*(https?:\/\/\S+)\s*$/); return m ? `<a href="${esc(m[2])}" target="_blank" rel="noopener">${esc(m[1] || m[2])}</a>` : esc(s); };
  view.innerHTML = `
  <article class="rec">
    <div class="rec-top"><a class="link" href="#/library">← Library</a>
      <div class="rec-actions">
        <button class="btn" id="similar">Find similar</button>
        <button class="btn" id="edit">Edit</button>
      </div></div>
    <header class="rec-h">
      <div class="cid">${r.id}${r.greenshoot_project ? ` · <span class="gs-inline">Greenshoot project</span>` : ""}${r.sensitive ? ` · <span class="sens">Sensitive</span>` : ""}</div>
      <h1>${esc(r.name)}</h1>
      <p class="sub">${esc(place(r))}${r.year_completed ? ` · ${esc(r.year_completed)}` : ""}${r.status && r.status !== "Built" ? ` · ${esc(r.status)}` : ""}</p>
    </header>
    ${imgs.length ? `<div class="gallery">
      <figure class="g-main">${img(p.key)}<figcaption>${esc(p.caption)}${p.credit ? ` <span class="muted">Image: ${esc(p.credit)}</span>` : ""}</figcaption></figure>
      ${imgs.length > 1 ? `<div class="g-thumbs">${imgs.map((i, n) => `<button data-img="${n}" class="${i === p ? "on" : ""}" title="${esc(i.image_type)}">${img(i.thumb_key)}<span>${esc(i.image_type)}</span></button>`).join("")}</div>` : ""}
    </div>` : ""}
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
          ${r.edited_by ? `<p>Last edited by <b>${esc(r.edited_by)}</b>, ${fmtDate(r.updated)}</p>` : ""}
        </div>
      </aside>
    </div>
  </article>`;
  view.querySelectorAll("[data-img]").forEach(b => b.onclick = () => {
    const i = imgs[+b.dataset.img];
    view.querySelector(".g-main").innerHTML = `${img(i.key)}<figcaption>${esc(i.caption)}${i.credit ? ` <span class="muted">Image: ${esc(i.credit)}</span>` : ""}</figcaption>`;
    view.querySelectorAll("[data-img]").forEach(x => x.classList.toggle("on", x === b));
  });
  view.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { st.filters = { [b.dataset.filter]: [b.dataset.v] }; st.q = ""; st.ask = null; location.hash = "#/library"; });
  document.getElementById("similar").onclick = () => runAsk({ similar: r.id }, `Similar to ${r.name}`);
  document.getElementById("edit").onclick = () => openEditor({ record: structuredClone(r), targetId: r.id });
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
      <div class="ib-t"><b>${esc(i.draft?.record?.name || i.title || i.site || (i.uploads?.length ? `${i.uploads.length} photo${i.uploads.length > 1 ? "s" : ""}` : "Untitled"))}</b>
      <span>${esc(i.by)} · ${ago(i.created)}${i.status === "approved" ? ` · <em class="ok">added ${esc(i.record_id || "")}</em>` : i.status === "discarded" ? " · discarded" : i.draft ? " · drafted" : ""}</span></div></a>`;
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
    box.innerHTML = `<div class="empty">${item.status === "approved" ? `Added to the library as <a href="#/p/${item.record_id}">${esc(item.record_id)}</a> by ${esc(item.status_by)}.` : `Discarded by ${esc(item.status_by)}.`}
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
  box.innerHTML = `${sourceStrip(item)}
    ${d.duplicates?.length ? `<div class="dupes"><b>Possibly already in the library:</b> ${d.duplicates.map(x => `<span><a href="#/p/${x.id}" target="_blank">${x.id} ${esc(x.name)}</a> <em>(${esc(x.why)})</em> <button class="link" data-merge="${x.id}">Add to this one instead</button></span>`).join(" ")}</div>` : ""}
    ${d.notes || d.confidence === "low" ? `<div class="note-box"><b>Check:</b> ${esc(d.notes || "Groundwork wasn't confident about this draft.")}</div>` : ""}
    <div id="form-host"></div>`;
  const form = editorForm({ record: d.record, draftImages: d.images, item });
  document.getElementById("form-host").append(form.el);
  // Sent as just an image (no page, no text): Groundwork tries to identify the project online straight away.
  if (!item.url && !item.text && !item.checked) { item.checked = true; form.fill(); }
  box.querySelectorAll("[data-merge]").forEach(b => b.onclick = () => {
    const target = byId(b.dataset.merge);
    const merged = mergeInto(structuredClone(target), form.read());
    form.reset(merged, b.dataset.merge);
    toast(`Merged into ${target.id}. Check the fields, then approve.`);
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

// When a sent precedent is already in the library: keep the existing record and add what is new.
function mergeInto(target, add) {
  for (const f of st.cfg.fields) if (!target[f.key] && add[f.key]) target[f.key] = add[f.key];
  for (const f of st.cfg.facets) target.facets[f.key] = [...new Set([...(target.facets[f.key] || []), ...(add.facets[f.key] || [])])];
  target.tags = [...new Set([...(target.tags || []), ...add.tags])];
  target.sources = [...new Set([...(target.sources || []), ...add.sources])];
  return target;
}

// ---------- the record form (inbox review and edit) ----------
function editorForm({ record, draftImages = [], item = null, targetId = null }) {
  const el = document.createElement("form");
  el.className = "rf";
  let rec = record, target = targetId;
  // Images: existing ones on the record (keys) plus candidates from the inbox item (inbox upload keys or web urls).
  let pics = [];
  const setPics = () => {
    pics = [...(rec.images || []).map(i => ({ ...i, existing: true, keep: true })),
      ...draftImages.map(i => ({ ...i, existing: false }))];
    if (!pics.some(p => p.primary && p.keep)) { const f = pics.find(p => p.keep); if (f) f.primary = true; }
  };
  setPics();
  const c = st.cfg;
  const src = p => p.existing ? `/api/img?k=${encodeURIComponent(p.thumb_key)}&t=${c.token}` : p.key ? `/api/img?k=${encodeURIComponent(p.key)}&t=${c.token}` : p.url;
  const field = f => `<label class="fl ${f.long ? "long" : ""}"><span>${esc(f.label)}${f.hint ? ` <em>${esc(f.hint)}</em>` : ""}</span>${f.long
    ? `<textarea name="${f.key}" rows="${f.key === "description" ? 6 : 3}">${esc(rec[f.key] || "")}</textarea>`
    : `<input name="${f.key}" value="${esc(rec[f.key] || "")}">`}</label>`;
  const short = c.fields.filter(x => !x.long);

  const draw = () => {
    el.innerHTML = `
    ${target ? `<div class="target">Saving to <b>${esc(target)}</b> ${esc(byId(target)?.name || "")}${item ? ` <button type="button" class="link" id="unmerge">Make it a new precedent instead</button>` : ""}</div>` : ""}
    <div class="rf-sec"><h3>Images <span class="muted small">Untick any to leave out. ★ is the main image.</span></h3>
      ${pics.length ? `<div class="pics">${pics.map((p, n) => `<div class="pic ${p.keep ? "" : "off"}">
        <div class="pic-img"><img alt="" referrerpolicy="no-referrer" src="${esc(src(p))}"><label class="keep"><input type="checkbox" data-keep="${n}" ${p.keep ? "checked" : ""}></label><button type="button" class="star ${p.primary ? "on" : ""}" data-star="${n}" title="Main image">★</button></div>
        <select data-itype="${n}">${c.imageTypes.map(t => `<option ${t === p.image_type ? "selected" : ""}>${t}</option>`).join("")}</select>
        <input data-credit="${n}" placeholder="Credit" value="${esc(p.credit || "")}">
      </div>`).join("")}</div>` : `<p class="muted small">No images. You can add some later by sending the page again.</p>`}
    </div>
    <div class="rf-sec"><h3>Details</h3>
      <div class="fl-grid">${short.map(field).join("")}
        <label class="fl"><span>Status</span><select name="status">${c.status.map(s => `<option ${s === rec.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <label class="fl"><span>Scale</span><select name="scale"><option value=""></option>${c.scale.map(s => `<option ${s === rec.scale ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      </div>
      ${c.fields.filter(x => x.long).map(field).join("")}
      <div class="fillrow"><button type="button" class="btn" id="fill">✦ Check and fill online</button><span class="muted small" id="fill-msg">Groundwork searches the web, then checks every field against what it finds and the record's own text. You choose which changes to keep.</span></div>
      <div id="fill-out"></div>
    </div>
    <div class="rf-sec"><h3>Categories <span class="muted small">Pick all that apply. These drive the library's filters.</span></h3>
      ${c.facets.map(f => `<div class="facet"><h4>${esc(f.label)} <em>${esc(f.hint)}</em></h4><div class="tog">${f.values.map(v => `<label><input type="checkbox" name="f:${f.key}" value="${esc(v)}" ${(rec.facets?.[f.key] || []).includes(v) ? "checked" : ""}><span>${esc(v)}</span></label>`).join("")}</div></div>`).join("")}
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

    el.querySelectorAll("[data-keep]").forEach(x => x.onchange = () => { pics[+x.dataset.keep].keep = x.checked; if (!x.checked && pics[+x.dataset.keep].primary) { pics[+x.dataset.keep].primary = false; const f = pics.find(p => p.keep); if (f) f.primary = true; } keepScroll(draw); });
    el.querySelectorAll("[data-star]").forEach(x => x.onclick = () => { pics.forEach((p, n) => { p.primary = n === +x.dataset.star; if (p.primary) p.keep = true; }); keepScroll(draw); });
    el.querySelectorAll("[data-itype]").forEach(x => x.onchange = () => { pics[+x.dataset.itype].image_type = x.value; });
    el.querySelectorAll("[data-credit]").forEach(x => x.oninput = () => { pics[+x.dataset.credit].credit = x.value; });
    el.querySelector("#discard")?.addEventListener("click", async () => {
      await api("/api/inbox", { method: "PATCH", body: { id: item.id, status: "discarded" } });
      await loadInbox(); toast("Discarded"); location.hash = "#/inbox";
    });
    el.querySelector("#cancel")?.addEventListener("click", closeModal);
    el.querySelector("#unmerge")?.addEventListener("click", () => { rec = item.draft.record; target = null; setPics(); draw(); });
    el.querySelector("#fill").onclick = fillGaps;
  };
  const keepScroll = fn => { const y = window.scrollY, m = document.getElementById("modal-card"), my = m?.scrollTop; fn(); window.scrollTo(0, y); if (m) m.scrollTop = my; };

  const read = () => {
    const fd = new FormData(el), o = {};
    for (const f of c.fields) o[f.key] = (fd.get(f.key) || "").trim();
    o.status = fd.get("status"); o.scale = fd.get("scale");
    o.facets = Object.fromEntries(c.facets.map(f => [f.key, fd.getAll("f:" + f.key)]));
    o.tags = String(fd.get("tags") || "").split(",").map(s => s.trim()).filter(Boolean);
    o.sources = String(fd.get("sources") || "").split("\n").map(s => s.trim()).filter(Boolean);
    o.used_in = String(fd.get("used_in") || "").split(",").map(s => s.trim()).filter(Boolean);
    o.greenshoot_project = !!fd.get("greenshoot_project"); o.sensitive = !!fd.get("sensitive");
    o.sensitive_note = (fd.get("sensitive_note") || "").trim();
    return o;
  };

  async function fillGaps() {
    const btn = el.querySelector("#fill"), msg = el.querySelector("#fill-msg"), out = el.querySelector("#fill-out");
    btn.disabled = true; out.innerHTML = ""; msg.textContent = "Searching the web...";
    const record = read();
    const images = pics.filter(p => p.keep).slice(0, 3).map(p => (p.existing ? { key: p.key } : p.key ? { key: p.key } : { url: p.url }));
    let notes = "", searchNote = "";
    try {
      const res = await api("/api/research", { method: "POST", body: { record, images }, raw: true });
      notes = await readWebText(res, n => { msg.textContent = `Searching the web (${n} search${n === 1 ? "" : "es"})...`; });
    } catch (e) { searchNote = `The web search didn't work (${e.message}), so this check uses the record's own text only. `; }
    msg.textContent = "Checking every field...";
    try {
      const ans = await api("/api/check", { method: "POST", body: { record, notes } });
      const label = k => c.fields.find(f => f.key === k)?.label || (k === "status" ? "Status" : k === "scale" ? "Scale" : k);
      const facetLabel = k => c.facets.find(f => f.key === k)?.label || k;
      const addF = Object.entries(ans.add_facets || {});
      const srcLink = s => /^https?:\/\//.test(s) ? `<a href="${esc(s)}" target="_blank" rel="noopener">source</a>` : esc(s);
      const urlIn = s => (String(s).match(/https?:\/\/\S+/) || [])[0];
      msg.textContent = searchNote + (ans.summary || "Checked.");
      const any = ans.changes.length || addF.length || ans.add_tags.length || ans.add_sources.length;
      out.innerHTML = any ? `<div class="fill-box">
        ${ans.changes.length ? `<table class="chg"><thead><tr><th></th><th>Field</th><th>Now</th><th>Suggested</th><th>Why</th></tr></thead><tbody>
          ${ans.changes.map((ch, n) => `<tr><td><input type="checkbox" data-chg="${n}" ${ch.current ? "" : "checked"}></td><td><b>${esc(label(ch.field))}</b></td>
            <td class="${ch.current ? "" : "muted"}">${esc((ch.current || "empty").slice(0, 160))}</td><td>${esc(ch.value.slice(0, 400))}</td>
            <td class="small">${esc(ch.reason)} ${urlIn(ch.source) ? srcLink(urlIn(ch.source)) : `<span class="muted">(${esc(ch.source)})</span>`}</td></tr>`).join("")}
        </tbody></table>` : ""}
        ${addF.map(([k, vs]) => `<div><b>Add to ${esc(facetLabel(k))}:</b> ${vs.map(v => `<label class="inl"><input type="checkbox" data-fac="${esc(k)}" value="${esc(v)}" checked> ${esc(v)}</label>`).join(" ")}</div>`).join("")}
        ${ans.add_tags.length ? `<div><b>Add tags:</b> ${ans.add_tags.map(t => `<label class="inl"><input type="checkbox" data-tag value="${esc(t)}" checked> ${esc(t)}</label>`).join(" ")}</div>` : ""}
        ${ans.add_sources.length ? `<div><b>Add sources:</b> ${ans.add_sources.map(s => `<label class="inl"><input type="checkbox" data-src value="${esc(s)}" checked> ${esc(s)}</label>`).join(" ")}</div>` : ""}
        ${ans.caveats ? `<div class="muted">${esc(ans.caveats)}</div>` : ""}
        <p class="small muted">Ticked: new information for empty fields. Unticked: changes to things already filled in. Tick what you want to keep.</p>
        <p><button type="button" class="btn primary" id="use">Use selected</button> <button type="button" class="btn" id="nouse">Leave it</button></p></div>`
        : `<p class="muted small">Everything checks out: nothing to add or change.</p>`;
      el.querySelector("#use")?.addEventListener("click", () => {
        const cur = read();
        out.querySelectorAll("[data-chg]:checked").forEach(x => { const ch = ans.changes[+x.dataset.chg]; cur[ch.field] = ch.value; });
        out.querySelectorAll("[data-fac]:checked").forEach(x => { cur.facets[x.dataset.fac] = [...new Set([...(cur.facets[x.dataset.fac] || []), x.value])]; });
        out.querySelectorAll("[data-tag]:checked").forEach(x => { if (!cur.tags.includes(x.value)) cur.tags.push(x.value); });
        out.querySelectorAll("[data-src]:checked").forEach(x => { if (!cur.sources.includes(x.value)) cur.sources.push(x.value); });
        rec = { ...rec, ...cur }; keepScroll(draw); toast("Changes added. Check them over before saving.");
      });
      el.querySelector("#nouse")?.addEventListener("click", () => { out.innerHTML = ""; });
    } catch (e) { msg.textContent = `Couldn't check: ${e.message}`; }
    btn.disabled = false;
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
      const newImages = [];
      for (const p of kept.filter(p => !p.existing)) {
        try {
          const blob = p.key
            ? await (await fetch(`/api/img?k=${encodeURIComponent(p.key)}&t=${c.token}`)).blob()
            : await api(`/api/proxy-image?url=${encodeURIComponent(p.url)}`, { raw: true }).then(x => x.blob());
          const [big, thumb] = await Promise.all([shrink(blob, 1800, 0.82), shrink(blob, 560, 0.78)]);
          newImages.push({ data: await toBase64(big), thumb: await toBase64(thumb), image_type: p.image_type, caption: p.caption || "", credit: p.credit || "", source_url: p.source_url || "", primary: !!p.primary });
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
  return { el, read, fill: fillGaps, reset(newRec, newTarget) { rec = newRec; target = newTarget; setPics(); draw(); } };
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
        <label class="drop" id="drop"><input type="file" accept="image/*" multiple hidden id="files"><span><b>Drop photos or images here</b>, paste a screenshot (Cmd/Ctrl+V), or click to choose<br><em>Drag images straight from another web page too. Up to 8 at a time. Works from a phone.</em></span></label>
        <div class="drop-list" id="drop-list"></div>
        <label class="fl long"><span>Which project is this? <em>optional: if you leave it blank, Groundwork tries to identify it online</em></span><input name="note" placeholder="e.g. Bunjil Place forecourt, Narre Warren. Site visit Nov 2026"></label>
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
  let files = [], webImgs = [];
  const list = document.getElementById("drop-list"), input = document.getElementById("files"), drop = document.getElementById("drop");
  const show = () => { list.innerHTML = files.map(f => `<span>${esc(f.name || "pasted image")}</span>`).join("") + webImgs.map(u => `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer">`).join(""); };
  const add = fl => { files = [...files, ...[...fl].filter(f => f.type.startsWith("image/"))].slice(0, 8 - webImgs.length); show(); };
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
    if (/^https?:/.test(u.trim())) { webImgs = [...new Set([...webImgs, u.trim()])].slice(0, 8 - files.length); show(); }
    else toast("That didn't come through as an image. Try saving it and dropping the file.");
  };
  const onPaste = e => { if (!document.getElementById("by-photos")) return document.removeEventListener("paste", onPaste); const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); add(f); } };
  document.addEventListener("paste", onPaste);
  document.getElementById("by-photos").onsubmit = async e => {
    e.preventDefault();
    if (!files.length && !webImgs.length) return toast("Add some photos or images first");
    const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Sending...";
    try {
      const uploads = [];
      for (const f of files) uploads.push({ data: await toBase64(await shrink(f, 1600, 0.8)), type: "image/jpeg", name: f.name, taken: new Date(f.lastModified).toISOString() });
      const note = new FormData(e.target).get("note") || "";
      await api("/api/inbox", { method: "POST", body: { note, from: "upload", uploads, images: webImgs, title: note } });
      await loadInbox(); toast("Photos sent to the inbox"); files = []; webImgs = []; list.innerHTML = ""; e.target.reset();
    } catch (err) { toast(`Couldn't send: ${err.message}`); }
    btn.disabled = false; btn.textContent = "Send to the inbox";
  };
}

start();
export const _test = { st };
