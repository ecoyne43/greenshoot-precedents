// Small shared helpers for the pages.
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ls = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
let mem = { pw: ls.get("gp_pw"), name: ls.get("gp_name") };
export const getAuth = () => ({ ...mem });
export function setAuth(pw, name) { mem = { pw, name }; ls.set("gp_pw", pw); ls.set("gp_name", name); }

// fetch with the team password and the person's name. { body } is sent as JSON; { raw: true } returns the Response.
export async function api(path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "x-app-password": mem.pw, "x-user-name": encodeURIComponent(mem.name || ""), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).error || `error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return raw ? res : res.json();
}

let tt;
export function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 3600);
}

// Shrink an image (File or Blob) to at most `max` px on its long side, as a JPEG Blob.
export async function shrink(blob, max, quality) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error("Image could not be converted"))), "image/jpeg", quality));
}

export const toBase64 = blob => new Promise((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1]);
  r.onerror = () => bad(r.error);
  r.readAsDataURL(blob);
});

// Read a streamed Claude answer (server-sent events): returns its text. onSearch(n) is called as searches run.
export async function readWebText(res, onSearch = () => {}) { return (await readWebStream(res, onSearch)).text; }

// The same, plus whether the answer finished (Netlify can stop it after about 30 seconds).
export async function readWebStream(res, onSearch = () => {}) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "", searches = 0, complete = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
      if (!data) continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === "content_block_start" && ev.content_block?.type === "server_tool_use") onSearch(++searches);
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") text += ev.delta.text;
      if (ev.type === "error") throw new Error(ev.error?.message || "Search failed");
      if (ev.type === "message_stop") complete = true;
    }
  }
  return { text: text.trim(), complete, searches };
}

// Groundwork's JSON answer from a stream, even when the stream stopped early (Netlify ends a function after about
// 30 seconds, so a long check can be cut off mid-answer). Returns { value, complete }: complete is false when only
// the part that arrived could be used (everything up to the last whole item). Throws if nothing usable arrived.
export async function readJSONAnswer(res) {
  const text = await readWebText(res);
  try { return { value: JSON.parse(text), complete: true }; } catch { /* cut off: use what arrived */ }
  const stack = [], cuts = [];
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") { stack.pop(); cuts.push([i + 1, stack.slice().reverse().join("")]); }
    else if (ch === ",") cuts.push([i, stack.slice().reverse().join("")]);
  }
  for (let k = cuts.length - 1; k >= 0; k--) {
    try { const value = JSON.parse(text.slice(0, cuts[k][0]) + cuts[k][1]); if (value && typeof value === "object") return { value, complete: false }; } catch { /* try an earlier point */ }
  }
  throw new Error("Groundwork's answer was cut off before anything useful arrived (the site stops after about 30 seconds). Try again");
}
