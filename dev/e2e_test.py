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

def r2_on():
    return json.load(urllib.request.urlopen(urllib.request.Request(BASE + "/api/move-images", headers={"x-app-password": "test"})))["remote"]

# Images in Netlify Blobs (the seed) copied to Cloudflare, as the admin page does after setup.
if r2_on():
    after, done = "", False
    while not done:
        r = post("/api/move-images", {"after": after}); after, done = r["next"], r["done"]
    check(r["position"] == r["total"] and r["total"] > 0, f"existing images copied to Cloudflare ({r['total']})")

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    pg.on("pageerror", lambda e: errors.append(f"page error: {e}"))
    pg.goto(BASE + "/")
    pg.fill("#login-pw", "test"); pg.fill("#login-name", "Ed"); pg.click("#login-form button[type=submit]")
    pg.wait_for_selector(".card")
    check(pg.locator(".card").count() == 9, "library shows 9 sample records")
    if r2_on():
        srcs = pg.eval_on_selector_all(".card img", "els => els.map(e => [e.src, e.naturalWidth])")
        check(all("/fake-r2/" in u for u, w in srcs) and all(w > 0 for u, w in srcs), "library images load straight from Cloudflare")
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
                "site": "Sample Architecture News", "text": "Example Studio has completed a timber pavilion...", "note": "Great woven roof screen (co-design test)",
                "from": "extension"})["item"]   # no images ticked, so Groundwork takes the page's own
    check(item["by"] == "Jez", "inbox item credited to the sender")
    pg.goto(BASE + "/#/inbox"); pg.wait_for_selector(".ib")
    check(pg.locator("#inbox-count").inner_text() == "1", "inbox badge shows 1")
    pg.goto(BASE + f"/#/inbox/{item['id']}")
    pg.wait_for_selector(".rf", timeout=20000)
    check(pg.locator(".pic").count() == 4, f"draft has the page's 4 images (got {pg.locator('.pic').count()})")
    check(pg.locator(".pic.off").count() == 1, "the logo image is left out")
    check(pg.locator('input[name="f:materials"][value="Timber"]').is_checked(), "draft ticks Timber")
    pg.screenshot(path=f"{OUT}/5_review.png", full_page=True)

    # check and fill online: every field, from the web notes and the record's own text
    pg.click("#fill"); pg.wait_for_selector("#fill-out [data-use]")
    check(pg.locator("[data-chg]").count() == 3, f"3 field changes proposed (got {pg.locator('[data-chg]').count()})")
    check(pg.locator("[data-chg]:checked").count() == 2, "new info ticked, change to a filled field unticked")
    pg.screenshot(path=f"{OUT}/11_check.png", full_page=True)
    pg.click("#fill-out [data-use]")
    check("Sample Architecture Award" in pg.input_value('input[name="awards"]'), "check adds the award from the web")
    check("Greenshoot" in pg.input_value('input[name="first_peoples_collaborators"]'), "check fills a field from the record's own text")
    check(pg.input_value('input[name="architect"]') == "Example Studio", "unticked change to the architect not applied")
    check(pg.locator('input[name="f:environment"][value="Climate + Resilience"]').is_checked(), "check adds a category")

    # approve
    pg.click("#save"); pg.wait_for_selector(".rec-h h1", timeout=20000)
    check("Tidewater" in pg.locator(".rec-h h1").inner_text(), "approved record opens")
    check(pg.locator(".g-strip button").count() == 3, f"3 images saved (got {pg.locator('.g-strip button').count()})")
    attrib = pg.locator(".attrib").inner_text()
    check("Sent by Jez" in attrib and "approved by Ed" in attrib, "attribution: sent by Jez, approved by Ed")
    if r2_on():
        puts = [l for l in json.load(urllib.request.urlopen(BASE + "/__r2")) if l.startswith("PUT 201 /up/")]
        check(len(puts) >= 6, f"approved images stored at Cloudflare ({len(puts)} files)")
        check(all("/fake-r2/" in u for u in pg.eval_on_selector_all(".g-strip img", "els => els.map(e => e.src)")), "new images shown from Cloudflare")
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
    pg.goto(BASE + "/#/inbox"); pg.wait_for_selector(".ib")
    labels = pg.locator(".ib-t span").all_inner_texts()
    check(any("merged into PR-0010" in t for t in labels) and any("new PR-0010" in t for t in labels), "inbox shows one new and one merged send")
    pg.goto(BASE + "/#/p/PR-0010"); pg.wait_for_selector("#edit")

    # edit
    pg.click("#edit"); pg.wait_for_selector("#modal .rf")
    pg.fill('#modal input[name="year_completed"]', "2025")
    pg.click("#modal #save"); pg.wait_for_selector("#modal", state="hidden")
    check("2025" in pg.locator(".sub").inner_text(), "edit saves")
    check("Edit PR-0010" in open(f"{RUN}/data/_commits.log").read(), "edit commit message")

    # "Add to this precedent" from a record page: link + photo + note, reviewed in the inbox as an addition
    pg.goto(BASE + "/#/p/PR-0001"); pg.wait_for_selector("#addto")
    n_before = len([r for r in json.load(open(f"{RUN}/data/precedents.json"))["records"] if r["id"] == "PR-0001"][0]["images"])
    pg.click("#addto"); pg.wait_for_selector("#addto-form")
    pg.fill('#addto-form input[name="url"]', BASE + "/fake-site/project.html")
    pg.set_input_files("#at-files", [f"{RUN}/fake-site/a.jpg"])
    pg.fill('#addto-form textarea[name="note"]', "Photos from our site visit")
    pg.click("#at-send")
    try: pg.wait_for_selector("#prop-top [data-chg]", timeout=60000)
    except Exception:
        print("DEBUG url", pg.url, "|", pg.inner_text("body")[:900].replace("\n", " | ")); raise
    check("Adding to PR-0001" in pg.locator(".target").inner_text(), "addition opens in the inbox, aimed at PR-0001")
    check(pg.locator("#prop-top [data-chg]:checked").count() == 2, "Groundwork proposes what the new material adds, all ticked")
    pg.screenshot(path=f"{OUT}/12_add_to.png", full_page=True)
    pg.click("#prop-top [data-use]")
    check("Added context" in pg.input_value('textarea[name="description"]'), "new context goes into the description")
    check("Approve and update PR-0001" in pg.locator("#save").inner_text(), "approving updates PR-0001")
    pg.click("#save"); pg.wait_for_selector(".rec-h h1:has-text('Riverbend')", timeout=60000)
    rec1 = [r for r in json.load(open(f"{RUN}/data/precedents.json"))["records"] if r["id"] == "PR-0001"][0]
    check(len(rec1["images"]) > n_before and rec1["awards"] == "Sample Award 2026", "PR-0001 has the new photos and details")
    check(len(json.load(open(f"{RUN}/data/precedents.json"))["records"]) == 10, "no new record made")
    check("new material from" in pg.locator(".attrib").inner_text(), "record shows who added material")

    # "Add to this precedent" with a link: Get images shows every photo on the page; the ticked ones all come through
    recs = lambda: {r["id"]: r for r in json.load(open(f"{RUN}/data/precedents.json"))["records"]}
    n3 = len(recs()["PR-0003"]["images"])
    pg.goto(BASE + "/#/p/PR-0003"); pg.wait_for_selector("#addto"); pg.click("#addto"); pg.wait_for_selector("#addto-form")
    pg.fill("#at-url", BASE + "/fake-site/gallery.html"); pg.click("#at-get")
    pg.wait_for_function("document.querySelectorAll('#at-imgs .ip-cell:not([hidden])').length === 5 && [...document.querySelectorAll('#at-imgs .ip-size')].filter(x => x.textContent).length >= 5", timeout=20000)
    shown = pg.eval_on_selector_all("#at-imgs .ip-cell:not([hidden])", "els => els.map(e => e.dataset.u.split('/').pop())")
    check(sorted(shown) == ["g1.jpg", "g2.jpg", "g3.jpg", "g4.jpg", "g5.jpg"], f"Get images finds the full-size photos, hides the logo ({shown})")
    pg.click("#at-imgs [data-ip=all]")
    pg.locator("#at-imgs .ip-cell:not([hidden])").nth(4).click()   # untick one
    check("4</b> ticked" in pg.inner_html("#at-imgs .ip-head"), "ticking counts")
    pg.screenshot(path=f"{OUT}/14_get_images.png")
    pg.click("#at-send")
    pg.wait_for_selector(".target:has-text('PR-0003')", timeout=60000)
    n_rev = pg.locator("#form-host .pic input[data-keep]:checked").count()
    check(n_rev == n3 + 4, f"existing images plus all 4 ticked ones in the review ({n_rev})")
    pg.click("#save"); pg.wait_for_selector(".rec-h h1", timeout=60000)
    check(len(recs()["PR-0003"]["images"]) == n3 + 4, "the 4 images are added to PR-0003")

    # the record's images: Carousel (‹ › and arrow keys, a strip of all), Grid (all at once), List; the choice is kept
    pg.goto(BASE + "/#/p/PR-0003"); pg.wait_for_selector("#gal .g-main")
    n_all = len(recs()["PR-0003"]["images"])
    check(pg.locator(".g-strip button").count() == n_all, f"the strip shows all {n_all} images")
    pg.keyboard.press("ArrowRight"); pg.keyboard.press("ArrowRight")
    check(pg.inner_text(".gcount") == f"3 / {n_all}", "arrow keys step through the images")
    pg.click(".gnav.prev"); check(pg.inner_text(".gcount") == f"2 / {n_all}", "‹ goes back")
    pg.click("[data-mode=grid]"); check(pg.locator(".gal-grid button").count() == n_all, "Grid shows every image")
    pg.screenshot(path=f"{OUT}/16_gallery_grid.png", full_page=True)
    pg.locator(".gal-grid button").nth(n_all - 1).click()
    check(pg.inner_text(".gcount") == f"{n_all} / {n_all}", "clicking one in the grid opens it large")
    pg.click("[data-mode=list]"); check(pg.locator(".gal-list figure").count() == n_all, "List shows every image large")
    pg.reload(); pg.wait_for_selector("#gal .gal-list")
    check(True, "the chosen view is remembered")
    pg.click("[data-mode=carousel]")
    pg.screenshot(path=f"{OUT}/17_gallery_carousel.png")

    # Edit (or inbox review): "Add images from a link" right in the form
    n4 = len(recs()["PR-0004"]["images"])
    pg.goto(BASE + "/#/p/PR-0004"); pg.wait_for_selector("#edit"); pg.click("#edit"); pg.wait_for_selector("#modal .rf")
    pg.fill('#modal input[name="architect"]', "Typed before adding images")
    pg.click("#al-open"); pg.fill("#al-url", BASE + "/fake-site/gallery.html"); pg.click("#al-get")
    pg.wait_for_function("document.querySelectorAll('#al-imgs .ip-cell:not([hidden])').length === 5", timeout=20000)
    cells = pg.locator("#al-imgs .ip-cell:not([hidden])"); cells.nth(0).click(); cells.nth(2).click()
    pg.screenshot(path=f"{OUT}/15_add_from_link.png", full_page=True)
    before = pg.locator("#modal .pic").count()
    pg.click("#al-add")
    check(pg.locator("#modal .pic").count() == before + 2, "two images join the form")
    check(pg.input_value('#modal input[name="architect"]') == "Typed before adding images", "typing survives adding images")
    check("gallery.html" in pg.input_value('#modal textarea[name="sources"]'), "the page is added to sources")
    pg.click("#modal #save"); pg.wait_for_selector("#modal", state="hidden", timeout=60000)
    r4 = recs()["PR-0004"]
    check(len(r4["images"]) == n4 + 2 and r4["architect"] == "Typed before adding images", "saved with the new images")

    # a site that won't be read gets a helpful message
    pg.goto(BASE + "/#/p/PR-0003"); pg.wait_for_selector("#addto"); pg.click("#addto"); pg.wait_for_selector("#addto-form")
    pg.fill("#at-url", BASE + "/fake-site/missing.html"); pg.click("#at-get")
    pg.wait_for_selector("#at-imgs .msg.bad")
    check("browser" in pg.inner_text("#at-imgs"), "blocked page suggests the browser button")
    pg.fill("#at-url", "https://www.instagram.com/p/ABC123/"); pg.click("#at-get")
    pg.wait_for_selector("#at-imgs .msg.bad:has-text('Instagram')")
    check("collects every slide" in pg.inner_text("#at-imgs"), "Instagram link explains to use the browser button")
    pg.click("#mclose")

    # in the inbox: Groundwork spots a match across the library; or choose one by hand
    item5 = post("/api/inbox", {"url": BASE + "/fake-site/project.html", "title": "Another angle", "note": "riverbend test", "from": "web"})["item"]
    pg.goto(BASE + f"/#/inbox/{item5['id']}"); pg.wait_for_selector(".srcstrip:has-text('riverbend test') ~ #form-host .rf", timeout=60000)
    check("PR-0001" in pg.locator(".dupes").inner_text(), "Groundwork spots it's already in the library (different name)")
    pg.click("#pick-existing"); pg.wait_for_selector("#pick-q")
    pg.fill("#pick-q", "saltmarsh"); pg.click(".pick")
    pg.wait_for_selector("#prop-top [data-chg]", timeout=60000)
    check("Adding to PR-0002" in pg.locator(".target").inner_text(), "picked precedent becomes the target")
    pg.screenshot(path=f"{OUT}/13_picker_merge.png", full_page=True)
    pg.click("#unmerge")
    check(pg.locator(".target").count() == 0 and pg.locator("#prop-top [data-chg]").count() == 0, "can switch back to a new precedent")
    pg.click("#discard"); pg.wait_for_selector("#toast:has-text('Discarded')")

    # sent as just an image: Groundwork suggests the online check; clicked, it identifies the project
    item3 = post("/api/inbox", {"images": [BASE + "/fake-site/c.jpg"], "from": "upload"})["item"]
    pg.goto(BASE + f"/#/inbox/{item3['id']}")
    pg.wait_for_selector("#fill-now", timeout=60000); pg.click("#fill-now")
    try: pg.wait_for_selector("#fill-out [data-use]", timeout=30000)
    except Exception:
        print("DEBUG", pg.url, pg.inner_text("#ib-main")[:700].replace("\n", " | ")); raise
    log = json.load(urllib.request.urlopen(BASE + "/__claude"))
    check(any(x["kind"] == "research" and x["nImages"] == 1 for x in log), "image sent to the web research step")
    check(any(x["kind"] == "research" and "REVERSE IMAGE SEARCH" in x["text"] for x in log), "reverse image search leads passed on")
    pg.click("#fill-out [data-use]")
    check(pg.input_value('input[name="name"]') == "Tidewater Weaving Pavilion", "image-only item gets identified")

    # many big photos: must not hit Netlify's 6 MB request limit when approving
    big = [BASE + f"/fake-site/big{k}.jpg" for k in range(1, 7)]
    item4 = post("/api/inbox", {"url": BASE + "/fake-site/project.html", "title": "Big photos", "images": big, "from": "extension", "text": "Big photo test"})["item"]
    pg.goto(BASE + f"/#/inbox/{item4['id']}"); pg.wait_for_selector(".srcstrip:has-text('Big photos') ~ #form-host .rf", timeout=60000)
    pg.fill('input[name="name"]', "Big Photo Pavilion")
    n_pics = pg.locator("#form-host .pic input[data-keep]:checked").count()
    pg.click("#save"); pg.wait_for_selector(".rec-h h1", timeout=60000)
    n_saved = pg.locator(".g-strip button").count()
    check(n_saved == n_pics and n_pics >= 6, f"all {n_pics} big photos saved ({n_saved})")
    data = json.load(open(f"{RUN}/data/precedents.json"))
    check(sum(len(r["images"]) for r in data["records"] if r["name"] == "Big Photo Pavilion") == n_pics, "big photos on the record")

    # add page and site photos
    pg.goto(BASE + "/#/add"); pg.wait_for_selector("#by-photos")
    pg.evaluate("""() => { const dt = new DataTransfer(); dt.setData('text/uri-list', location.origin + '/fake-site/b.jpg');
      document.getElementById('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""")
    check(pg.locator("#drop-list img").count() == 1, "image dragged from a web page is picked up")
    pg.set_input_files("#files", [f"{RUN}/fake-site/a.jpg", f"{RUN}/fake-site/c.jpg"] + [f"{RUN}/fake-site/big{k}.jpg" for k in range(1, 7)])
    pg.fill('#by-photos input[name="note"]', "Riverside shelter, site visit")
    pg.screenshot(path=f"{OUT}/7_add.png")
    pg.click("#by-photos button.primary"); pg.wait_for_selector("#toast:has-text('Photos sent'), #toast:has-text('send')")
    check("Photos sent" in pg.locator("#toast").inner_text(), "site photos sent: " + pg.locator("#toast").inner_text())
    newest = json.load(urllib.request.urlopen(urllib.request.Request(BASE + "/api/inbox", headers={"x-app-password": "test"})))["items"][0]
    check(len(newest.get("uploads", [])) == 8 and len(newest.get("images", [])) == 1, f"8 photos (in parts) and the dragged web image arrived ({len(newest.get('uploads', []))})")

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

    # admin page
    pg.goto(BASE + "/#/admin"); pg.wait_for_selector(".admin")
    check(("Cloudflare is set up" if r2_on() else "Images are in Netlify") in pg.inner_text(".admin") and len(pg.inner_text("code.tok")) == 32, "admin page shows storage and the Worker key")

    # a general precedent: a SHORT record (no write-up), specific materials, and a new list value Groundwork suggests
    item7 = post("/api/inbox", {"url": BASE + "/fake-site/project.html", "note": "suggest test, a shell screen", "from": "web"})["item"]
    post("/api/draft", {"id": item7["id"]})
    pg.goto(BASE + f"/#/inbox/{item7['id']}"); pg.wait_for_selector("#form-host .rf", timeout=60000)
    check(pg.locator("[data-depth=short].on").count() == 1, "no First Peoples involvement: drafted as a short record")
    check(pg.locator(".more-write[open]").count() == 0 and pg.input_value('textarea[name="description"]') == "", "short: no description, write-up tucked away")
    check(pg.input_value('input[name="material_details"]') == "Spotted Gum, Woven sedge", "specific materials drafted")
    check(pg.locator(".suggest > div").count() == 1 and "Shell + Bone" in pg.inner_text(".suggest"), "Groundwork suggests a new Materials value (not a duplicate)")
    pg.screenshot(path=f"{OUT}/18_short_record.png", full_page=True)
    pg.click("[data-sug='0']"); pg.wait_for_selector("input[name='f:materials'][value='Shell + Bone']")
    check(pg.locator("input[name='f:materials'][value='Shell + Bone']").is_checked(), "added to the list and ticked")
    cats = json.load(open(f"{RUN}/data/categories.json"))
    check(any(x["value"] == "Shell + Bone" and x["by"] == "Ed" for x in cats["added"]["materials"]), "saved to categories.json, with who added it")
    pg.fill('input[name="material_details"]', "Spotted Gum, Woven sedge, Abalone shell")
    pg.click("[data-depth=full]"); check(pg.locator('textarea[name="why_it_matters"]').is_visible(), "switching to Full shows the write-up fields")
    check(pg.input_value('input[name="material_details"]').endswith("Abalone shell"), "typing survives the switch")
    pg.click("[data-depth=short]")
    pg.click("#save"); pg.wait_for_selector(".rec-h h1", timeout=60000)
    newest = [r for r in recs().values() if r["name"] == "Tidewater Weaving Pavilion"][-1]
    check(newest["depth"] == "short" and "Shell + Bone" in newest["facets"]["materials"] and "Abalone shell" in newest["material_details"], "saved short, with the new value and specific materials")
    check("Abalone shell" in pg.inner_text(".rec"), "specific materials shown on the precedent")
    # old values renamed: Steel is now Metal, with Steel kept as a specific material
    r1 = [r for r in json.load(urllib.request.urlopen(urllib.request.Request(BASE + "/api/library", headers={"x-app-password": "test"})))["records"] if "Metal" in r["facets"].get("materials", [])]
    check(r1 and all("Steel" in r["material_details"] for r in r1), f"Steel read as Metal, Steel kept as a specific material ({len(r1)})")
    # the Categories page: see the lists, add a value, remove an unused one
    pg.goto(BASE + "/#/categories"); pg.wait_for_selector(".cats .cat")
    check("Medium + technique" in pg.inner_text(".cats") and pg.locator(".chip.added:has-text('Shell + Bone')").count() == 1, "Categories page lists everything, added values marked")
    pg.locator(".addv[data-facet=medium] input").fill("Neon"); pg.locator(".addv[data-facet=medium] button").click()
    pg.wait_for_selector(".chip.added:has-text('Neon')")
    pg.locator(".chip:has-text('Neon') .x").click(); pg.wait_for_timeout(600)
    check(pg.locator(".chip:has-text('Neon')").count() == 0, "an unused added value can be removed")
    check(pg.locator(".chip:has-text('Shell + Bone') .x").count() == 0, "a value in use can't be removed")
    pg.screenshot(path=f"{OUT}/19_categories.png", full_page=True)

    # photos named after their projects: one precedent per name, titled from the file name, and Groundwork reads it
    a = open(f"{RUN}/fake-site/a.jpg", "rb").read(); bimg = open(f"{RUN}/fake-site/b.jpg", "rb").read()
    pg.goto(BASE + "/#/add"); pg.wait_for_selector("#by-photos")
    before = len(json.load(urllib.request.urlopen(urllib.request.Request(BASE + "/api/inbox", headers={"x-app-password": "test"})))["items"])
    pg.set_input_files("#files", [
        {"name": "Granite island Causeway - TRACT.jpg", "mimeType": "image/jpeg", "buffer": a},
        {"name": "Granite island Causeway - TRACT 2.jpg", "mimeType": "image/jpeg", "buffer": bimg},
        {"name": "Mount Archer Treetop Boardwalk.jpeg", "mimeType": "image/jpeg", "buffer": a}])
    pg.wait_for_selector("#split:not([hidden])")
    check("2 separate precedents" in pg.inner_text("#split") and "Granite island Causeway - TRACT 2 photos" in pg.inner_text("#split").replace("\n", " "), "offers one precedent per file name (numbered copies grouped)")
    pg.screenshot(path=f"{OUT}/20_split.png")
    pg.click("#by-photos button.primary"); pg.wait_for_selector("#toast:has-text('2 precedents sent')", timeout=30000)
    items = json.load(urllib.request.urlopen(urllib.request.Request(BASE + "/api/inbox", headers={"x-app-password": "test"})))["items"]
    new_items = items[:len(items) - before]
    titles = sorted(i["title"] for i in new_items)
    check(titles == ["Granite island Causeway - TRACT", "Mount Archer Treetop Boardwalk"] and sorted(len(i["uploads"]) for i in new_items) == [1, 2], f"two inbox items, titled from the file names ({titles})")
    # one photo sent with no title (e.g. from the Mac panel): the server takes the title from its file name
    one = post("/api/inbox", {"from": "mac", "uploads": [{"data": __import__("base64").b64encode(a).decode(), "type": "image/jpeg", "name": "Jock Marshall Reserve Nature Walk - Urban Initiatives.jpeg"}]})["item"]
    check(one["title"] == "Jock Marshall Reserve Nature Walk - Urban Initiatives", "server titles a photo from its file name")
    cam = post("/api/inbox", {"from": "mac", "uploads": [{"data": __import__("base64").b64encode(a).decode(), "type": "image/jpeg", "name": "IMG_4821.jpg"}]})["item"]
    check(cam["title"] == "", "camera file names are ignored")
    post("/api/draft", {"id": one["id"]})
    log = json.load(urllib.request.urlopen(BASE + "/__claude"))
    check('IMAGE FILE NAMES' in log[-1]["text"] and "Jock Marshall Reserve Nature Walk - Urban Initiatives" in log[-1]["text"], "Groundwork is given the file name when drafting")
    pub = open("public/filename.js").read(); srv = open("netlify/lib/filename.mjs").read().split("\n", 1)[1]
    check(pub == srv, "the site's and the server's file-name rules are the same")

    # Check and fill cut off partway (Netlify's time limit): what arrived is still offered
    pg.goto(BASE + "/#/p/PR-0002"); pg.wait_for_selector("#edit"); pg.click("#edit"); pg.wait_for_selector("#modal .rf")
    pg.fill('#modal input[name="name"]', "Cutoff test pavilion"); pg.fill('#modal input[name="architect"]', ""); pg.fill('#modal input[name="year_completed"]', "")
    pg.click("#modal #fill"); pg.wait_for_selector("#modal #fill-out .fill-box, #modal #fill-msg:has-text('Couldn')", timeout=30000)
    check("ran out of time" in pg.inner_text("#modal #fill-msg"), "a cut-off check says so: " + pg.inner_text("#modal #fill-msg")[:80])
    rows = pg.locator("#modal .chg tbody tr").count()
    check(rows >= 1 and "Cutoff Studio" in pg.inner_text("#modal .chg"), f"the changes that arrived are offered ({rows})")
    pg.click("#mclose")

    # a photo with nothing else: Check and fill runs by itself, shown at the top, and survives the form redrawing;
    # a search cut off before any notes gets one quicker try
    a2 = open(f"{RUN}/fake-site/a.jpg", "rb").read()
    ph = post("/api/inbox", {"from": "upload", "uploads": [{"data": __import__("base64").b64encode(a2).decode(), "type": "image/jpeg", "name": "Slow search test pavilion.jpg"}]})["item"]
    pg.goto(BASE + f"/#/inbox/{ph['id']}"); pg.wait_for_selector("#form-host .rf", timeout=60000)
    pg.wait_for_selector("#fill-top:not([hidden]) #fill-now")
    n_search = len([x for x in json.load(urllib.request.urlopen(BASE + "/__claude")) if x.get("max_uses")])
    pg.wait_for_timeout(800)
    check(len([x for x in json.load(urllib.request.urlopen(BASE + "/__claude")) if x.get("max_uses")]) == n_search, "a photo-only item suggests the online check but doesn't run it")
    pg.screenshot(path=f"{OUT}/22_suggest_check.png")
    pg.click("#fill-now")
    pg.click("[data-depth=full]")   # redraw while it runs
    pg.wait_for_selector("#fill-top:has-text('found')", timeout=30000)
    check(pg.locator("#form-host #fill-out .fill-box").count() == 1, "results shown below even after the form redrew: " + pg.inner_text("#form-host #fill-msg")[:80])
    check(pg.locator("#form-host #fill").is_enabled(), "finished, button usable again")
    log = json.load(urllib.request.urlopen(BASE + "/__claude"))
    uses = [x.get("max_uses") for x in log if x.get("max_uses")]
    check(uses[-2:] == [5, 3], f"cut-off search tried again, quicker ({uses[-2:]})")
    pg.screenshot(path=f"{OUT}/21_auto_check.png")
    pg.click("#fill-jump"); pg.wait_for_timeout(400)
    check(pg.locator("#form-host #fill-out .fill-box").is_visible(), "See them jumps to the changes")

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
