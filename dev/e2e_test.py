"""End-to-end test against dev/mock-server.mjs (seeded with dev/seed.py). Saves screenshots to the out folder.
python3 dev/e2e_test.py <base_url> <out_dir> <run_dir>"""
import json, os, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE, OUT, RUN = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
errors = []

def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"content-type": "application/json", "x-app-password": "test", "x-user-name": "Jez"})
    return json.load(urllib.request.urlopen(req))

def check(cond, what):
    print(("PASS " if cond else "FAIL ") + what)
    if not cond: errors.append(what)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    pg.on("pageerror", lambda e: errors.append(f"page error: {e}"))
    pg.goto(BASE + "/")
    pg.fill("#login-pw", "test"); pg.fill("#login-name", "Ed"); pg.click("#login-form button[type=submit]")
    pg.wait_for_selector(".card")
    check(pg.locator(".card").count() == 9, "library shows 9 sample records")
    pg.screenshot(path=f"{OUT}/1_library.png")

    # filters and keyword search
    pg.click("[data-toggle=materials]")
    pg.locator("input[data-f=materials][value=Timber]").check()
    n_timber = pg.locator(".results > .grid .card").count()
    check(n_timber == 5, f"Timber filter gives 5 (got {n_timber})")
    pg.fill("#q", "wetland")
    n = pg.locator(".results > .grid .card").count()
    check(n == 2, f"Timber + 'wetland' gives 2 (got {n})")
    pg.screenshot(path=f"{OUT}/2_filtered.png")
    pg.click("#clear"); pg.fill("#q", "")

    # Ask Groundwork
    pg.fill("#q", "memorial garden with stone")
    pg.click("#ask-btn")
    pg.wait_for_selector(".askbox .card")
    check("Basalt" in pg.locator(".askbox").inner_text(), "Ask finds the memorial garden")
    pg.screenshot(path=f"{OUT}/3_ask.png")
    pg.click("#ask-clear"); pg.fill("#q", "")

    # record view and find similar
    pg.goto(BASE + "/#/p/PR-0001"); pg.wait_for_selector(".rec-h h1")
    check(pg.locator(".rec-h h1").inner_text() == "Riverbend Gathering Pavilion", "record view opens")
    pg.screenshot(path=f"{OUT}/4_record.png", full_page=True)

    # something sent from the bookmark button / extension
    item = post("/api/inbox", {"url": BASE + "/fake-site/project.html", "title": "Tidewater Weaving Pavilion / Example Studio",
                "site": "Sample Architecture News", "text": "Example Studio has completed a timber pavilion...", "note": "Great woven roof screen",
                "images": [BASE + "/fake-site/a.jpg", BASE + "/fake-site/b.jpg"], "from": "extension"})["item"]
    check(item["by"] == "Jez", "inbox item credited to the sender")
    pg.goto(BASE + "/#/inbox"); pg.wait_for_selector(".ib")
    check(pg.locator("#inbox-count").inner_text() == "1", "inbox badge shows 1")
    pg.goto(BASE + f"/#/inbox/{item['id']}")
    pg.wait_for_selector(".rf", timeout=20000)
    check(pg.locator(".pic").count() == 4, f"draft has the page's 4 images (got {pg.locator('.pic').count()})")
    check(pg.locator(".pic.off").count() == 1, "the logo image is left out")
    check(pg.locator('input[name="f:materials"][value="Timber"]').is_checked(), "draft ticks Timber")
    pg.screenshot(path=f"{OUT}/5_review.png", full_page=True)

    # fill gaps online
    pg.click("#fill"); pg.wait_for_selector("#use")
    pg.click("#use")
    check("Sample Architecture Award" in pg.input_value('input[name="awards"]'), "Fill gaps adds the award")
    check(pg.locator('input[name="f:environment"][value="Climate + Resilience"]').is_checked(), "Fill gaps adds a category")

    # approve
    pg.click("#save"); pg.wait_for_selector(".rec-h h1", timeout=20000)
    check("Tidewater" in pg.locator(".rec-h h1").inner_text(), "approved record opens")
    check(pg.locator(".g-thumbs button").count() == 3, f"3 images saved (got {pg.locator('.g-thumbs button').count()})")
    attrib = pg.locator(".attrib").inner_text()
    check("Sent by Jez" in attrib and "approved by Ed" in attrib, "attribution: sent by Jez, approved by Ed")
    data = json.load(open(f"{RUN}/data/precedents.json"))
    rec = [r for r in data["records"] if r["id"] == "PR-0010"]
    check(bool(rec) and rec[0]["added_by"] == "Jez", "PR-0010 written to the data file")
    log = open(f"{RUN}/data/_commits.log").read()
    check("Add PR-0010 Tidewater Weaving Pavilion" in log, "commit message")
    pg.screenshot(path=f"{OUT}/6_approved.png", full_page=True)

    # duplicate check: send it again
    item2 = post("/api/inbox", {"url": BASE + "/fake-site/project.html", "title": "Tidewater again", "from": "web"})["item"]
    pg.goto(BASE + f"/#/inbox/{item2['id']}"); pg.wait_for_selector(".rf", timeout=20000)
    check("PR-0010" in pg.locator(".dupes").inner_text(), "duplicate warning names PR-0010")
    pg.click("[data-merge=PR-0010]")
    check("Approve and update PR-0010" in pg.locator("#save").inner_text(), "merge switches to updating PR-0010")
    pg.locator(".pic input[data-keep]").nth(3).uncheck()
    pg.locator(".pic input[data-keep]").nth(4).uncheck()
    pg.locator(".pic input[data-keep]").nth(5).uncheck()
    pg.locator(".pic input[data-keep]").nth(6).uncheck()
    pg.click("#save"); pg.wait_for_selector(".rec-h h1", timeout=20000)
    data = json.load(open(f"{RUN}/data/precedents.json"))
    check(len(data["records"]) == 10, "merge did not add a new record")

    # edit
    pg.click("#edit"); pg.wait_for_selector("#modal .rf")
    pg.fill('#modal input[name="year_completed"]', "2025")
    pg.click("#modal #save"); pg.wait_for_selector("#modal", state="hidden")
    check("2025" in pg.locator(".sub").inner_text(), "edit saves")
    check("Edit PR-0010" in open(f"{RUN}/data/_commits.log").read(), "edit commit message")

    # add page and site photos
    pg.goto(BASE + "/#/add"); pg.wait_for_selector("#by-photos")
    pg.set_input_files("#files", [f"{RUN}/fake-site/a.jpg", f"{RUN}/fake-site/c.jpg"])
    pg.fill('#by-photos input[name="note"]', "Riverside shelter, site visit")
    pg.screenshot(path=f"{OUT}/7_add.png")
    pg.click("#by-photos button.primary"); pg.wait_for_selector("#toast:has-text('Photos sent'), #toast:has-text('send')")
    check("Photos sent" in pg.locator("#toast").inner_text(), "site photos sent: " + pg.locator("#toast").inner_text())

    # capture window from the bookmark button
    cap = b.new_page(viewport={"width": 560, "height": 780}, device_scale_factor=2)
    cap.goto(BASE + "/start.html")   # same origin, so the saved password is there
    cap.evaluate("localStorage.setItem('gp_pw','test'); localStorage.setItem('gp_name','Kirsten')")
    import urllib.parse
    d = {"url": BASE + "/fake-site/project.html", "title": "Tidewater Weaving Pavilion", "site": "Sample Architecture News",
         "text": "", "images": [BASE + "/fake-site/a.jpg", BASE + "/fake-site/b.jpg", BASE + "/fake-site/c.jpg"]}
    cap.goto(BASE + "/capture.html#" + urllib.parse.quote(json.dumps(d)))
    cap.wait_for_selector("#send")
    cap.screenshot(path=f"{OUT}/8_capture.png")
    cap.click("#send"); cap.wait_for_selector("text=Sent")
    st = b.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
    st.goto(BASE + "/start.html"); st.screenshot(path=f"{OUT}/9_start.png", full_page=True)

    # phone width
    ph = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    ph.goto(BASE + "/"); ph.evaluate("localStorage.setItem('gp_pw','test'); localStorage.setItem('gp_name','Ed')"); ph.goto(BASE + "/#/library"); ph.reload()
    ph.wait_for_selector(".card")
    sw = ph.evaluate("document.documentElement.scrollWidth")
    check(sw <= 390, f"no sideways scroll on a phone (width {sw})")
    if sw > 390: print(ph.evaluate("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>392).slice(0,8).map(e=>e.tagName+'.'+e.className+' '+Math.round(e.getBoundingClientRect().right)).join('\\n')"))
    ph.screenshot(path=f"{OUT}/10_phone.png")
    b.close()

print("\n" + ("ALL PASSED" if not errors else f"{len(errors)} FAILED: " + "; ".join(errors)))
sys.exit(1 if errors else 0)
