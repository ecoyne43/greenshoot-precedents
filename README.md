# Groundworked Precedents (Greenshoot)

Greenshoot's shared library of built-project precedents. The team sends precedents in from the web, Groundwork
drafts each record (fields, categories, image types, duplicate check), anyone on the team checks and approves it, and
everyone can search the library by category, keyword or plain-language question (Ask Groundwork, Find similar).

A separate app from the Groundwork map tool (`groundwork-app`). It copies a few of Groundwork's working pieces (page
reading, the bookmark button, Blobs storage, the GitHub data file, Claude calls) but shares no code with it, so
changes here can never break the live map tool.

## How it fits together
- **Data**: `precedents.json` in a private GitHub repo (`ecoyne43/greenshoot-precedents-data`), `{ records: [...] }`.
  Every approval or edit is one commit, so there is a full history of who changed what.
- **Images**: at Cloudflare R2 behind a Worker once set up (`cloudflare/`, `netlify/lib/imagestore.mjs`), otherwise
  Netlify Blobs store `images`. Keys `PR-0001/img_xxx.jpg` or `up/img_xxx.jpg` plus `_t.jpg` thumbnails, shrunk in the
  browser before upload. Admin page `/#/admin`: storage status, the Worker's key, copy existing images across. Record images are listed on each record.
- **Inbox**: Netlify Blobs, stores `inbox` (items) and `inbox-files` (uploaded site photos and screenshots).
- **Categories**: `netlify/lib/vocab.mjs`. The eight facets, status, scale and image types. The form, the filters
  and Groundwork's drafting all read from this file.
- **House rules for Groundwork**: `netlify/lib/prompts.mjs` (drafting, Ask, Find similar, Check and fill online).

| Function | What it does |
|---|---|
| `/api/config` | category lists, image token |
| `/api/library` | all records |
| `/api/inbox` | add, list, change status, delete inbox items |
| `/api/draft` | Groundwork drafts a record from an inbox item (reads the page and images, checks for duplicates) |
| `/api/save` | approve an inbox item (new record or added to an existing one) or save an edit: one commit |
| `/api/ask` | Ask Groundwork, Find similar, find precedents for a brief |
| `/api/research` | Check and fill online, step 1: web search for the precedent (can look at its images), streamed notes |
| `/api/check` | Check and fill online, step 2: compares every field with the notes and the record's own text, proposes changes with reasons and sources |
| `/api/page-images` | every likely photo on a web page, for the image picker ("Get images", "Add images from a link") |
| `/api/img`, `/api/proxy-image` | serve stored images; fetch web images for the browser to shrink |

Browser extension: `public/extension/` (Chrome and Edge, Manifest V3). The Get started page zips it with the
site's address written in (`zip.js`); the team unzips it and uses Load unpacked. Toolbar button sends the page;
right-click sends an image, the page or a screenshot. All sends open `capture.html`. The toolbar button opens
`popup.html`: search the library (cached in extension storage, refreshed on open), Ask Groundwork, open a precedent
and download its images (`chrome.downloads`, saved as `Precedents/<id> <name>/NN <type>.jpg`), or send the page.
On an Instagram post it switches to `instagram.js`: steps through the carousel, collects each slide at full size,
downloads them straight away (Instagram's image links expire) and sends them as files credited to the account.
Design preview without the extension: `/dev/popup-preview.html` on the mock server. Test: `dev/extension_test.py`.

Pages: `index.html` + `app.js` (library, record, inbox review, add), `capture.html` (the bookmark button's window),
`start.html` (Get started page to send the team).

## Setting it up (once)
1. GitHub: create private repos `greenshoot-precedents` (this code) and `greenshoot-precedents-data` (empty, or
   with `{"records": []}` in `precedents.json`).
2. GitHub: a fine-grained token with Contents read/write on `greenshoot-precedents-data` only.
3. Netlify: new site from the `greenshoot-precedents` repo. Environment variables:
   - `APP_PASSWORD` the team password
   - `ANTHROPIC_API_KEY` (web search must be allowed for the key, for Fill gaps online)
   - `GITHUB_TOKEN`, `GITHUB_REPO=ecoyne43/greenshoot-precedents-data`
   - optional `IMAGES_URL`, `IMAGES_UPLOAD_SECRET`: images at Cloudflare R2 behind a Worker (see `cloudflare/README.md`),
     so viewing and downloading images uses no Netlify traffic. Without them, images stay in Netlify Blobs.
   - optional `GOOGLE_VISION_KEY`: Google Cloud Vision API key, for reverse image search when a precedent arrives
     as just an image (first 1,000 a month free, then US$3.50 per 1,000, Nov 2026)
   - optional `CLAUDE_MODEL` (default `claude-sonnet-5-5`), `DATA_PATH` (default `precedents.json`), `GITHUB_BRANCH`
4. Send the team the site's `/start.html` link and the password.

## Testing locally
```
npm install
python3 dev/seed.py                 # made-up SAMPLE records and placeholder images in dev/run
node dev/mock-server.mjs 8899       # password: test; fakes GitHub, Blobs and Claude
python3 dev/e2e_test.py http://localhost:8899 <screenshot folder> dev/run
python3 dev/extension_test.py http://localhost:8899 <screenshot folder>
```
Re-seed before each test run (the test adds PR-0010).

## Changing the categories
Edit `netlify/lib/vocab.mjs`. Adding a value is safe. Renaming or removing one: existing records keep the old value
until they are edited (it is dropped on save), so rename it in `precedents.json` too in the same change.

## Rules
- Never use em dashes (the server turns any into commas). Say "First Peoples", not "Aboriginal".
- New precedents always go through the inbox. Anyone can approve; every record shows who sent and who approved it.
