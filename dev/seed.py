"""Seed dev/run with made-up SAMPLE precedents and placeholder images, for local testing and screenshots only.
None of these projects are real. Run: python3 dev/seed.py [run_dir]"""
import json, os, random, sys, urllib.parse
from PIL import Image, ImageDraw, ImageFilter

RUN = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "run")
DATA, BLOBS, SITE = os.path.join(RUN, "data"), os.path.join(RUN, "blobs", "images"), os.path.join(RUN, "fake-site")
for d in (DATA, BLOBS, SITE): os.makedirs(d, exist_ok=True)

PALETTES = [((196, 214, 224), (120, 132, 104), (92, 64, 44)), ((232, 214, 190), (166, 120, 82), (70, 52, 40)),
            ((210, 222, 214), (86, 112, 96), (180, 150, 110)), ((40, 44, 70), (20, 22, 34), (240, 170, 80)),
            ((220, 226, 230), (150, 156, 160), (60, 70, 78)), ((206, 196, 170), (124, 110, 84), (196, 92, 60))]

def picture(seed, kind, w=1600, h=1200):
    r = random.Random(seed)
    sky, ground, accent = PALETTES[seed % len(PALETTES)]
    im = Image.new("RGB", (w, h), sky)
    d = ImageDraw.Draw(im)
    for y in range(h):   # sky gradient
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(sky[i] * (1 - .25 * t)) for i in range(3)))
    hz = int(h * r.uniform(.52, .66))
    d.rectangle([0, hz, w, h], fill=ground)
    if kind == "aerial":
        im = Image.new("RGB", (w, h), ground); d = ImageDraw.Draw(im)
        for _ in range(26):
            x, y, s = r.randint(0, w), r.randint(0, h), r.randint(40, 260)
            d.ellipse([x - s, y - s // 2, x + s, y + s // 2], fill=tuple(min(255, c + r.randint(-24, 30)) for c in ground))
        d.line([(0, r.randint(0, h)), (w, r.randint(0, h))], fill=(140, 170, 190), width=70)
        d.line([(r.randint(0, w), 0), (r.randint(0, w), h)], fill=accent, width=14)
    elif kind == "screen":
        for x in range(0, w, 46):
            d.line([(x, 0), (x + r.randint(-120, 120), h)], fill=accent, width=r.randint(8, 18))
    else:
        x0, x1 = int(w * r.uniform(.12, .3)), int(w * r.uniform(.7, .9))
        top = int(hz - h * r.uniform(.18, .3))
        d.polygon([(x0 - 60, top + 40), ((x0 + x1) // 2, top - r.randint(0, 120)), (x1 + 60, top + 40), (x1 + 60, top + 70), (x0 - 60, top + 70)], fill=accent)
        for x in range(x0, x1, r.randint(40, 70)):
            d.rectangle([x, top + 70, x + 12, hz + 10], fill=tuple(max(0, c - 30) for c in accent))
        if kind == "boardwalk":
            d.polygon([(w * .45, h), (w * .55, h), (w * .52, hz), (w * .49, hz)], fill=(170, 140, 100))
    im = im.filter(ImageFilter.GaussianBlur(1.2))
    return im

def save(im, key, size):
    im = im.copy(); im.thumbnail((size, size))
    im.save(os.path.join(BLOBS, urllib.parse.quote(key, safe="")), "JPEG", quality=82)

F = lambda **k: {f: k.get(f, []) for f in ["project_type", "design_element", "cultural_expression", "dwc_themes", "environment", "materials", "programme", "involvement"]}
S = [
    ("Riverbend Gathering Pavilion", "Melbourne", "VIC", "Australia", "Wurundjeri Woi-wurrung", "2021", "Sample Architects", "pavilion",
     F(project_type=["Park + Open Space", "Civic + Cultural"], design_element=["Shelter + Pavilion", "Roof + Ceiling + Soffit"], dwc_themes=["Gathering Place", "Ceremony"], materials=["Timber"], programme=["Public Programs + Events"], involvement=["Co-designed with Traditional Owners"]), True),
    ("Saltmarsh Learning Centre", "Geelong", "VIC", "Australia", "", "2019", "Coastline Studio", "pavilion",
     F(project_type=["Education"], dwc_themes=["Learning on Country", "Knowledge Systems"], environment=["Wetlands", "WSUD"], materials=["Timber", "Recycled + Reclaimed"], involvement=["Consulted"]), False),
    ("Wetland Boardwalk Loop", "Ballarat", "VIC", "Australia", "", "2022", "Field Landscape", "boardwalk",
     F(project_type=["Waterway + Wetland", "Park + Open Space"], design_element=["Boardwalk + Path"], cultural_expression=["Wayfinding + Interpretive Signage", "Naming + Language"], environment=["Wetlands", "Flora + Fauna + Habitat"], materials=["Timber"], involvement=["Co-designed with Traditional Owners"]), False),
    ("Weave Screen House", "Brisbane", "QLD", "Australia", "", "2020", "Northfold Architects", "screen",
     F(project_type=["Residential"], design_element=["Screen", "Facade"], cultural_expression=["Pattern + Graphics"], materials=["Fibre + Weaving", "Steel"], involvement=["First Peoples artist commission"]), False),
    ("Ironbark Library Forecourt", "Bendigo", "VIC", "Australia", "", "2023", "Civic Landscape Co", "pavilion",
     F(project_type=["Civic + Cultural", "Streetscape + Urban Design"], design_element=["Ground Plane + Paving", "Furniture"], cultural_expression=["Public Art", "Acknowledgement of Country"], dwc_themes=["Truth Telling"], materials=["Stone"], involvement=["First Peoples artist commission"]), True),
    ("Moonlight Projection Laneway", "Wellington", "", "New Zealand", "", "2018", "Lumen Collective", "screen",
     F(project_type=["Streetscape + Urban Design"], cultural_expression=["Light + Projection", "Soundscape"], dwc_themes=["Identity + Significant Figures"], programme=["Performing Arts"], involvement=["First Peoples-led design"]), False),
    ("Stringybark Sports Pavilion", "Shepparton", "VIC", "Australia", "", "2024", "Sample Architects", "pavilion",
     F(project_type=["Sport + Stadium"], design_element=["Roof + Ceiling + Soffit", "Skylight"], dwc_themes=["Cultural Safety", "Relationships + Community Involvement"], environment=["Sustainable Design"], materials=["Timber", "Steel"], programme=["Sport"], involvement=["Consulted"]), False),
    ("Basalt Plains Memorial Garden", "Werribee", "VIC", "Australia", "", "2017", "Field Landscape", "aerial",
     F(project_type=["Memorial + Commemorative", "Park + Open Space"], design_element=["Planting"], dwc_themes=["Truth Telling", "Healing + Wellbeing"], environment=["Flora + Fauna + Habitat"], materials=["Stone"], involvement=["Co-designed with Traditional Owners"]), False),
    ("Eel Trap Playspace", "Portland", "VIC", "Australia", "", "2022", "Playground Studio", "boardwalk",
     F(project_type=["Playspace"], design_element=["Furniture"], cultural_expression=["Artefact + Display"], dwc_themes=["Learning on Country"], environment=["Nature Play"], materials=["Timber", "Fibre + Weaving"], involvement=["First Peoples artist commission"]), False),
]
records = []
for n, (name, city, state, country, to, year, arch, kind, facets, gs) in enumerate(S, 1):
    rid = f"PR-{n:04d}"
    imgs = []
    for k, (kd, typ) in enumerate([(kind, "Photo"), ("aerial", "Aerial"), ("screen" if kind != "screen" else "pavilion", "Detail")][: 1 + n % 3]):
        im = picture(n * 10 + k, kd)
        key = f"{rid}/img_s{n}{k}.jpg"
        save(im, key, 1600); save(im, key.replace(".jpg", "_t.jpg"), 560)
        imgs.append({"id": f"img_s{n}{k}", "key": key, "thumb_key": key.replace(".jpg", "_t.jpg"), "image_type": typ,
                     "caption": f"{name}, {typ.lower()}", "credit": "Sample image", "source_url": "", "primary": k == 0})
    records.append({
        "id": rid, "name": name, "also_known_as": "", "location_text": f"{city} {state}".strip(), "city": city, "state": state,
        "country": country, "country_to": to, "year_completed": year, "architect": arch, "landscape_architect": "", "artists": "",
        "first_peoples_collaborators": "", "client": "", "other_team": "", "awards": "",
        "summary": f"SAMPLE RECORD for testing. A made-up {facets['project_type'][0].lower()} project in {city}, used to show how the library looks and filters.",
        "why_it_matters": "Sample text: what the project does well and what Greenshoot could take from it.",
        "description": "", "status": "Built", "scale": "Building", "facets": facets, "tags": ["sample"], "sources": [],
        "greenshoot_project": gs, "used_in": [], "sensitive": False, "sensitive_note": "", "images": imgs,
        "added_by": ["Ed", "Jez", "Kirsten"][n % 3], "approved_by": ["Theo", "Ed"][n % 2], "added": f"2026-10-{10 + n:02d}", "updated": f"2026-10-{10 + n:02d}",
        "history": [],
    })
json.dump({"records": records}, open(os.path.join(DATA, "precedents.json"), "w"), indent=1)
for k, (kd, s) in enumerate([("pavilion", 91), ("aerial", 92), ("screen", 93)]):
    picture(s, kd, 1200, 800).save(os.path.join(SITE, "abc"[k] + ".jpg"), "JPEG", quality=80)
Image.new("RGB", (1200, 800), (250, 250, 250)).save(os.path.join(SITE, "d.jpg"), "JPEG")
# A gallery page's photos (srcset, lazy loading, links to full size, script data) and a small logo for the image picker.
for k, (kd, sd) in enumerate([("pavilion", 81), ("screen", 82), ("aerial", 83), ("pavilion", 84), ("screen", 85)], 1):
    picture(sd, kd, 1600, 1067).save(os.path.join(SITE, f"g{k}.jpg"), "JPEG", quality=80)
    picture(sd, kd, 1600, 1067).resize((400, 267)).save(os.path.join(SITE, f"g{k}-400.jpg"), "JPEG", quality=70)
Image.new("RGB", (120, 40), (30, 30, 30)).save(os.path.join(SITE, "logo.jpg"), "JPEG")
# Big, detailed photos (random noise compresses badly), for testing Netlify's 6 MB request limit.
import numpy as np
for k in range(1, 7):
    arr = np.random.default_rng(k).integers(0, 255, (1500, 2000, 3), dtype=np.uint8)
    Image.fromarray(arr).save(os.path.join(SITE, f"big{k}.jpg"), "JPEG", quality=80)
print(f"Seeded {len(records)} sample records in {RUN}")
