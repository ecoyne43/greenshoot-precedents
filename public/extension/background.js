// Send to Precedents: the toolbar button sends the page; right-click sends an image, the page or a screenshot.
// Everything opens the site's small capture window (capture.html), where the sender ticks images, adds a note and
// sends it to the inbox. The password and name are the ones saved when they signed in to the site.
import { SITE } from "./config.js";

const MENU = [
  { id: "image", title: "Send this image to Precedents", contexts: ["image"] },
  { id: "page", title: "Send this page to Precedents", contexts: ["page", "selection", "link"] },
  { id: "shot", title: "Send a screenshot of this page to Precedents", contexts: ["page", "selection", "image", "link"] },
];
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => MENU.forEach(m => chrome.contextMenus.create(m)));
});

// Runs inside the web page: highlighted text, page details and the biggest images (same as the bookmark button).
function collect() {
  const g = n => { const e = document.querySelector(`meta[property="${n}"],meta[name="${n}"]`); return e ? e.content : ""; };
  const sel = getSelection(), text = String(sel || "").trim().slice(0, 15000);
  let im = [];
  try { if (sel.rangeCount) sel.getRangeAt(0).cloneContents().querySelectorAll("img").forEach(i => { const s = i.getAttribute("src"); if (s) im.push(new URL(s, location.href).href); }); } catch (e) { /* ignore */ }
  const og = g("og:image"); if (og) try { im.push(new URL(og, location.href).href); } catch (e) { /* ignore */ }
  [...document.images].filter(i => i.naturalWidth >= 400 && i.naturalHeight >= 260)
    .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight).slice(0, 10)
    .forEach(i => im.push(i.currentSrc || i.src));
  im = [...new Set(im)].filter(u => /^https?:/.test(u)).slice(0, 12);
  return { url: location.href, title: document.title, site: g("og:site_name"), author: g("author") || g("article:author"), date: g("article:published_time"), text, images: im };
}

async function pageData(tab) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collect });
    if (r?.result) return r.result;
  } catch (e) { /* pages the browser protects (settings, web store) */ }
  return { url: tab.url, title: tab.title, site: "", text: "", images: [] };
}

// Opens the capture window, then hands it the page details (and screenshot) once it has loaded. Nothing goes in
// the window's address: some posts (Instagram) carry very long image links that break sign-in redirects.
async function openCapture(data, shot) {
  const win = await chrome.windows.create({ url: `${SITE}/capture.html`, type: "popup", width: 600, height: 840 });
  const tabId = win.tabs[0].id;
  const payload = { ...data, from: "extension", shot: !!shot };
  for (let n = 0; n < 60; n++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", args: [payload, shot || ""],
        func: (d, s) => { if (!window.gpData) return false; window.gpData(d, s); return true; } });
      if (r?.result) break;
    } catch (e) { /* page still loading */ }
  }
  return win;
}

export async function send(kind, tab, info = {}) {
  if (kind === "shot" || (kind === "image" && /^data:image\//.test(info.srcUrl || ""))) {
    const shot = kind === "shot" ? await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 }) : info.srcUrl;
    const d = await pageData(tab);
    return openCapture({ ...d, images: [] }, shot);
  }
  const d = await pageData(tab);
  if (kind === "image" && info.srcUrl) {
    d.images = [info.srcUrl, ...(d.images || []).filter(u => u !== info.srcUrl)].slice(0, 12);
    d.pick = info.srcUrl;
  }
  return openCapture(d);
}

chrome.action.onClicked.addListener(tab => send("page", tab));
chrome.contextMenus.onClicked.addListener((info, tab) => send(info.menuItemId, tab, info));
self.gpSend = send;   // for tests
