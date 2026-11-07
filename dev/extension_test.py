"""Browser extension test: downloads the extension from the Get started page (as the team would), loads it into
Chromium, and sends an image, a page and a screenshot through it. Run against dev/mock-server.mjs.
python3 dev/extension_test.py <base_url> <out_dir>"""
import json, os, sys, tempfile, zipfile, urllib.request
from playwright.sync_api import sync_playwright

BASE, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
errors = []
def check(cond, what):
    print(("PASS " if cond else "FAIL ") + what)
    if not cond: errors.append(what)
def inbox():
    req = urllib.request.Request(BASE + "/api/inbox", headers={"x-app-password": "test"})
    return json.load(urllib.request.urlopen(req))["items"]

tmp = tempfile.mkdtemp()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(accept_downloads=True)
    pg.goto(BASE + "/start.html")
    with pg.expect_download() as dl: pg.click("#ext")
    z = os.path.join(tmp, "ext.zip"); dl.value.save_as(z)
    zipfile.ZipFile(z).extractall(tmp)
    ext = os.path.join(tmp, "send-to-precedents")
    man = json.load(open(os.path.join(ext, "manifest.json")))
    check(man["host_permissions"] == [BASE + "/*"], "downloaded extension has this site's address built in")
    check("__SITE__" not in open(os.path.join(ext, "config.js")).read(), "config filled in")
    b.close()
    # Test only: a real right-click grants the screenshot permission (activeTab); the test can't right-click, so
    # its copy also gets <all_urls>. The downloaded extension itself is unchanged.
    man["host_permissions"].append("<all_urls>")
    json.dump(man, open(os.path.join(ext, "manifest.json"), "w"))

    ctx = p.chromium.launch_persistent_context(os.path.join(tmp, "profile"), channel="chromium", headless=True,
        args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}"], viewport={"width": 1280, "height": 900})
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
    check("background.js" in sw.url, "extension service worker running")
    site = ctx.new_page(); site.goto(BASE + "/")
    site.evaluate("localStorage.setItem('gp_pw','test'); localStorage.setItem('gp_name','Kirsten')")
    proj = ctx.new_page(); proj.goto(BASE + "/fake-site/project.html"); proj.bring_to_front()
    before = len(inbox())

    # right-click an image: "Send this image to Precedents"
    with ctx.expect_page() as newp:
        sw.evaluate("""async (src) => { const [tab] = await chrome.tabs.query({ url: '*://localhost/*' + 'fake-site/project.html' });
            await self.gpSend('image', tab, { srcUrl: src }); }""", BASE + "/fake-site/b.jpg")
    cap = newp.value; cap.wait_for_selector("#send")
    picked = cap.eval_on_selector_all('input[name="img"]:checked', "els => els.map(e => e.value)")
    check(picked == [BASE + "/fake-site/b.jpg"], f"only the right-clicked image is ticked ({picked})")
    cap.screenshot(path=f"{OUT}/ext_image.png")
    cap.click("#send"); cap.wait_for_selector("text=Sent")
    items = inbox(); new = items[0]
    check(len(items) == before + 1 and new["from"] == "extension" and new["by"] == "Kirsten", "image sent from the extension, credited")
    check(new["images"] == [BASE + "/fake-site/b.jpg"] and new["url"].endswith("project.html"), "inbox item has the image and its page")

    # toolbar button: the whole page
    with ctx.expect_page() as newp:
        sw.evaluate("""async () => { const [tab] = await chrome.tabs.query({ url: '*://localhost/*' + 'fake-site/project.html' }); await self.gpSend('page', tab); }""")
    cap = newp.value; cap.wait_for_selector("#send")
    check(cap.locator('input[name="img"]').count() >= 3, "page send offers the page's images")
    cap.close()

    # screenshot
    with ctx.expect_page() as newp:
        sw.evaluate("""async () => { const [tab] = await chrome.tabs.query({ url: '*://localhost/*' + 'fake-site/project.html' });
            await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true });
            await self.gpSend('shot', tab); }""")
    cap = newp.value; cap.wait_for_selector("#use-shot", timeout=15000)
    cap.screenshot(path=f"{OUT}/ext_shot.png")
    cap.click("#send"); cap.wait_for_selector("text=Sent")
    check(len(inbox()[0].get("uploads", [])) == 1, "screenshot uploaded to the inbox")
    ctx.close()

print("\n" + ("ALL PASSED" if not errors else f"{len(errors)} FAILED: " + "; ".join(errors)))
sys.exit(1 if errors else 0)
