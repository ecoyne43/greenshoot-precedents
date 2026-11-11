"""Tests the Mac panel page (public/desk.html) in a browser, without the Mac app: search, keyboard, opening a
precedent, and the screenshot send form (the app's part is faked with window.pr.shot).
python3 dev/desk_test.py <base_url>"""
import base64, json, sys, urllib.request
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]
errors = []
def check(cond, what):
    print(("PASS " if cond else "FAIL ") + what)
    if not cond: errors.append(what)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 600, "height": 660})
    pg.on("pageerror", lambda e: errors.append(f"page error: {e}"))
    pg.goto(BASE + "/desk.html")
    pg.wait_for_selector("#pw"); pg.fill("#pw", "wrong"); pg.fill("#nm", "Ed"); pg.click("#set button")
    pg.wait_for_selector("#smsg.bad"); check("Wrong password" in pg.inner_text("#smsg"), "wrong password is caught")
    pg.fill("#pw", "test"); pg.click("#set button"); pg.wait_for_selector(".res")
    check(pg.evaluate("document.activeElement.id") == "q", "search box has focus")
    pg.keyboard.type("basalt"); pg.wait_for_timeout(150)
    check(pg.locator(".res").count() == 1, "typing filters")
    pg.keyboard.press("Enter"); pg.wait_for_selector(".im")
    check(pg.locator(".im").count() == 3, "Enter opens the precedent with its images")
    pg.keyboard.press("Escape"); check(pg.locator(".im").count() == 0, "Esc closes it")
    pg.keyboard.press("Escape"); check(pg.input_value("#q") == "", "Esc again clears the search")
    pg.keyboard.press("ArrowDown"); pg.keyboard.press("ArrowDown")
    check(pg.locator(".res.sel").get_attribute("data-i") == "2", "arrow keys move the selection")
    # screenshot send form (the Mac app calls pr.shot with the image and where it came from)
    jpg = base64.b64encode(open("dev/run/fake-site/a.jpg", "rb").read()).decode()
    pg.evaluate("item => pr.shot(item)", {"app": "Google Chrome", "url": "https://example.org/proj", "title": "A project", "image": {"data": jpg, "type": "image/jpeg"}})
    pg.fill("#sn", "Forecourt paving"); pg.click("#sendshot .btn.primary"); pg.wait_for_selector("#toast:has-text('Sent')")
    req = urllib.request.Request(BASE + "/api/inbox", headers={"x-app-password": "test"})
    it = json.load(urllib.request.urlopen(req))["items"][0]
    check(it["from"] == "mac" and it["url"] == "https://example.org/proj" and len(it["uploads"]) == 1 and it["note"] == "Forecourt paving", "screenshot sent to the inbox with its source")
    # images dropped onto the panel go to the inbox too
    pg.goto(BASE + "/desk.html"); pg.wait_for_selector(".res")
    pg.evaluate("""async () => { const blob = await (await fetch('/fake-site/b.jpg')).blob();
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'site photo.jpg', { type: 'image/jpeg' })); dt.items.add(new File([blob], 'site photo 2.jpg', { type: 'image/jpeg' }));
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""")
    pg.wait_for_selector("#sendshot"); check(pg.locator(".shotprev").count() == 2, "dropped images offered for sending")
    pg.fill("#sn", "Site visit"); pg.click("#sendshot .btn.primary"); pg.wait_for_selector("#toast:has-text('Sent')")
    it = json.load(urllib.request.urlopen(req))["items"][0]
    check(len(it["uploads"]) == 2 and it["note"] == "Site visit", "dropped images sent to the inbox")

    # adding images to an existing precedent: drop them onto it in the list, or name it in the note
    drop_js = """async (sel) => { const blob = await (await fetch('/fake-site/b.jpg')).blob();
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'fire dish 1.jpg', { type: 'image/jpeg' })); dt.items.add(new File([blob], 'fire dish 2.jpg', { type: 'image/jpeg' }));
      const el = document.querySelector(sel);
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }"""
    pg.goto(BASE + "/desk.html"); pg.wait_for_selector(".res")
    pg.fill("#q", "basalt"); pg.wait_for_timeout(150)
    pg.evaluate(drop_js, ".res .rt")
    pg.wait_for_selector("#sendshot")
    check("Basalt Plains Memorial Garden" in pg.inner_text("#tg") and "Add these 2 images to a precedent" in pg.inner_text("#shhead"), "dropped onto a precedent: adding to it")
    pg.click("#shsend"); pg.wait_for_selector("#toast:has-text('added to')")
    it = json.load(urllib.request.urlopen(req))["items"][0]
    check(it.get("target") == "PR-0008" and len(it["uploads"]) == 2, "inbox item will add to PR-0008")
    pg.goto(BASE + "/desk.html"); pg.wait_for_selector(".res")
    pg.evaluate(drop_js, "#list")
    pg.wait_for_selector("#sendshot")
    check("A new precedent" in pg.inner_text("#tg"), "dropped elsewhere: new precedent")
    pg.fill("#sn", "add these to the Ironbark library forecourt please"); pg.wait_for_timeout(100)
    check("Ironbark Library Forecourt" in pg.inner_text("#tg") and "from your note" in pg.inner_text("#tg"), "the note picks the precedent")
    pg.screenshot(path=sys.argv[2] + "/desk_addto.png") if len(sys.argv) > 2 else None
    pg.click("#tchg"); pg.fill("#tq", "eel trap"); pg.click(".topt")
    check("Eel Trap Playspace" in pg.inner_text("#tg"), "or choose it by hand")
    pg.fill("#sn", "the Ironbark one actually"); pg.wait_for_timeout(100)
    check("Eel Trap Playspace" in pg.inner_text("#tg"), "a hand choice isn't overridden by the note")
    pg.click("#shsend"); pg.wait_for_selector("#toast:has-text('added to')")
    it = json.load(urllib.request.urlopen(req))["items"][0]
    check(it.get("target") == "PR-0009", "sent to add to the chosen precedent")

    # the side panel (opened from the tab on the right edge): tall and narrow
    sp = b.new_page(viewport={"width": 440, "height": 880})
    sp.on("pageerror", lambda e: errors.append(f"page error (side): {e}"))
    sp.goto(BASE + "/desk.html"); sp.evaluate("localStorage.setItem('gp_pw','test'); localStorage.setItem('gp_name','Ed')")
    sp.goto(BASE + "/desk.html?mode=side"); sp.wait_for_selector(".res")
    check(sp.evaluate("document.body.classList.contains('side')"), "side layout on")
    sp.fill("#q", "stone"); sp.wait_for_timeout(150)
    check(sp.locator(".res").count() == 2, f"a material finds its precedents ({sp.locator('.res').count()})")
    sp.fill("#q", "woven fibre screen with steel frame"); sp.wait_for_timeout(150)
    check("close" in sp.inner_text(".meta") and sp.locator(".res").count() >= 1, "a description shows close matches")
    check(sp.locator(".res").first.locator("b").first.inner_text() == "Weave Screen House", "closest first")
    sp.fill("#q", "boardwalk"); sp.wait_for_timeout(150); sp.keyboard.press("Enter") if False else sp.click(".row")
    sp.wait_for_selector(".im"); check(sp.locator(".im").count() == 5, "opened: its images, two across")
    sp.screenshot(path=sys.argv[2] + "/desk_side.png") if len(sys.argv) > 2 else None
    sp.locator(".im img").first.click(); sp.wait_for_selector(".big")
    check("1 of 5" in sp.inner_text(".big .bhead"), "big view shows 1 of 5")
    sp.keyboard.press("ArrowRight"); check("2 of 5" in sp.inner_text(".big .bhead"), "arrow key goes to the next image")
    sp.click("#bp"); sp.click("#bp"); check("5 of 5" in sp.inner_text(".big .bhead"), "previous wraps round")
    sp.screenshot(path=sys.argv[2] + "/desk_side_big.png") if len(sys.argv) > 2 else None
    sp.evaluate("pr.setMode('top')"); check(not sp.evaluate("document.body.classList.contains('side')"), "the app can switch it back to the top panel")
    b.close()
print("\n" + ("ALL PASSED" if not errors else f"{len(errors)} FAILED: " + "; ".join(errors)))
sys.exit(1 if errors else 0)
