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
    b.close()
print("\n" + ("ALL PASSED" if not errors else f"{len(errors)} FAILED: " + "; ".join(errors)))
sys.exit(1 if errors else 0)
