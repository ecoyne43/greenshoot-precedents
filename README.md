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
- **Images**: Netlify Blobs, store `images` (`PR-0001/img_xxx.jpg` plus `_t.jpg` thumbnail), shrunk in the browser
  before upload. Record images are listed on each record.
- **Inbox**: Netlify Blobs, stores `inbox` (items) and `inbox-files` (uploaded site photos and screenshots).
- **Categories**: `netlify/lib/vocab.mjs`. The eight facets, status, scale and image types. The form, the filters
  and Groundwork's drafting all read from this file.
- **House rules for Groundwork**: `netlify/lib/prompts.mjs` (drafting, Ask, Find similar, Fill gaps online).

| Function | What it does |
|---|---|
| `/api/config` | category lists, image token |
| `/api/library` | all records |
| `/api/inbox` | add, list, change status, delete inbox items |
| `/api/draft` | Groundwork drafts a record from an inbox item (reads the page and images, checks for duplicates) |
| `/api/save` | approve an inbox item (new record or added to an existing one) or save an edit: one commit |
| `/api/ask` | Ask Groundwork, Find similar, find precedents for a brief |
| `/api/research` | Fill gaps online (Claude with web search, streamed) |
| `/api/img`, `/api/proxy-image` | serve stored images; fetch web images for the browser to shrink |

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
   - optional `CLAUDE_MODEL` (default `claude-sonnet-5-5`), `DATA_PATH` (default `precedents.json`), `GITHUB_BRANCH`
4. Send the team the site's `/start.html` link and the password.

## Testing locally
```
npm install
python3 dev/seed.py                 # made-up SAMPLE records and placeholder images in dev/run
node dev/mock-server.mjs 8899       # password: test; fakes GitHub, Blobs and Claude
python3 dev/e2e_test.py http://localhost:8899 <screenshot folder> dev/run
```
Re-seed before each test run (the test adds PR-0010).

## Changing the categories
Edit `netlify/lib/vocab.mjs`. Adding a value is safe. Renaming or removing one: existing records keep the old value
until they are edited (it is dropped on save), so rename it in `precedents.json` too in the same change.

## Rules
- Never use em dashes (the server turns any into commas). Say "First Peoples", not "Aboriginal".
- New precedents always go through the inbox. Anyone can approve; every record shows who sent and who approved it.
