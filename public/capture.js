// The small window opened by the "Send to Precedents" bookmark button (and the browser extension). Shows what was
// collected from the page, lets the sender pick images and add a note, and sends it all to the inbox.
import { esc, api, getAuth, setAuth, shrink, toBase64 } from "./util.js";

const main = document.getElementById("main");
// The page details arrive in the address (bookmark button) or from the browser extension just after the window opens.
let data = {}, shot = "";
const hadHash = location.hash.length > 1;
try { data = JSON.parse(decodeURIComponent(location.hash.slice(1)) || "{}"); } catch { data = {}; }
history.replaceState(null, "", location.pathname);   // keep the captured text out of the address bar and history
window.gpData = (d, s) => { data = d || {}; shot = s || ""; start(); };
window.gpShot = s => { shot = s; render(); };

function render() {
  const { pw, name } = getAuth();
  const imgs = data.images || [], files = data.files || [];
  const pre = new Set(data.pick ? [data.pick] : imgs.slice(0, 4));
  main.innerHTML = `
    <div class="cap-h"><span class="mark">G</span><div><h1>Send to Precedents</h1><p class="muted small">${esc(data.site || "")}${data.site ? " · " : ""}${esc(data.url || "")}</p></div></div>
    <form id="f">
      <label class="fl long"><span>Page</span><input id="title" value="${esc(data.title || "")}"></label>
      ${data.shot ? `<div class="fl long"><span>Screenshot</span>${shot ? `<div class="cap-imgs one"><label><input type="checkbox" id="use-shot" checked><img src="${shot}" alt=""></label></div>` : `<p class="muted small">Waiting for the screenshot...</p>`}</div>` : ""}
      ${imgs.length ? `<div class="fl long"><span>Images <em>tick the ones worth keeping</em></span><div class="cap-imgs">
        ${imgs.map((u, n) => `<label><input type="checkbox" name="img" value="${esc(u)}" ${pre.has(u) ? "checked" : ""}><img src="${esc(u)}" alt="" referrerpolicy="no-referrer"></label>`).join("")}
      </div></div>` : ""}
      ${files.length ? `<div class="fl long"><span>${data.site === "Instagram" ? `Instagram post <em>${files.length === 1 ? "1 image" : `all ${files.length} slides`}, saved now so they won't expire</em>` : "Images"}</span>
        <div class="cap-imgs">${files.map((f, n) => `<label><input type="checkbox" name="file" value="${n}" checked><img src="${f.data}" alt=""></label>`).join("")}</div>
        ${data.found > files.length ? `<p class="muted small">${data.found - files.length} couldn't be downloaded.</p>` : ""}</div>` : ""}
      <label class="fl long"><span>${data.site === "Instagram" ? "Caption" : "Highlighted text"} <em>optional</em></span><textarea id="text" rows="5" placeholder="Nothing highlighted. That's fine: Groundwork reads the page.">${esc(data.text || "")}</textarea></label>
      <label class="fl long"><span>Note <em>optional</em></span><input id="note" placeholder="Why it's a good precedent, or which project it's for"></label>
      ${pw ? "" : `<label class="fl long"><span>Team password</span><input id="pw" type="password" autocomplete="current-password" required></label>`}
      ${name ? "" : `<label class="fl long"><span>Your name</span><input id="name" autocomplete="name" required></label>`}
      <div class="rf-actions"><button type="button" class="btn" id="cancel">Cancel</button><span></span><button class="btn primary" id="send">Send to the inbox</button></div>
      <p class="msg" id="msg" role="status"></p>
    </form>`;
  document.getElementById("cancel").onclick = () => window.close();
  document.getElementById("f").onsubmit = send;
}

async function send(e) {
  e.preventDefault();
  const btn = document.getElementById("send"), msg = document.getElementById("msg");
  const a = getAuth();
  setAuth(document.getElementById("pw")?.value.trim() || a.pw, document.getElementById("name")?.value.trim() || a.name);
  const body = {
    url: data.url, site: data.site, author: data.author, date: data.date, from: data.from === "extension" ? "extension" : "web",
    title: document.getElementById("title").value.trim(),
    text: document.getElementById("text").value.trim(),
    note: document.getElementById("note").value.trim(),
    images: [...document.querySelectorAll('input[name="img"]:checked')].map(i => i.value),
  };
  btn.disabled = true; msg.className = "msg"; msg.textContent = "Sending...";
  try {
    if (shot && document.getElementById("use-shot")?.checked) {
      const blob = await (await fetch(shot)).blob();
      body.uploads = [{ data: await toBase64(await shrink(blob, 2200, 0.85)), type: "image/jpeg", name: "screenshot.jpg" }];
    }
    // Images saved in the browser (Instagram): sent as files, in batches under Netlify's request limit.
    const ups = [...(body.uploads || [])], batches = [[]];
    for (const i of document.querySelectorAll('input[name="file"]:checked')) {
      const f = data.files[+i.value];
      ups.push({ data: f.data.split(",")[1], type: "image/jpeg", name: `${data.site || "image"} ${+i.value + 1}.jpg`, credit: f.credit || "", src: f.src || "" });
    }
    let size = 0;
    for (const u of ups) { if (size + u.data.length > 3_500_000 && batches.at(-1).length) { batches.push([]); size = 0; } batches.at(-1).push(u); size += u.data.length; }
    body.uploads = batches[0];
    if (batches.length > 1) msg.textContent = `Sending (1 of ${batches.length})...`;
    const { item } = await api("/api/inbox", { method: "POST", body });
    for (const [n, b] of batches.slice(1).entries()) { msg.textContent = `Sending (${n + 2} of ${batches.length})...`; await api("/api/inbox", { method: "PATCH", body: { id: item.id, uploads: b } }); }
    main.innerHTML = `<div class="empty"><h1>Sent</h1><p>It's in the Precedents inbox. Groundwork will draft the record for whoever reviews it.</p></div>`;
    setTimeout(() => window.close(), 1800);
  } catch (err) {
    if (err.status === 401) setAuth("", getAuth().name);
    msg.className = "msg bad"; msg.textContent = `Couldn't send: ${err.message}`;
    btn.disabled = false;
    if (err.status === 401) render();
  }
}

function start() {
  if (!data.url && !data.text && !data.shot) main.innerHTML = `<div class="empty"><h1>Send to Precedents</h1><p>Open this from the bookmark button or the browser extension while on a web page.</p></div>`;
  else render();
}
if (hadHash) start();
else main.innerHTML = `<div class="empty"><p class="muted">Getting the page details... <span class="small">(an Instagram carousel takes a few seconds while each slide is collected)</span></p></div>`;
setTimeout(() => { if (!data.url && !data.text && !data.shot) start(); }, 40000);
