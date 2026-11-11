# Precedents for Mac

**The Precedents tab** sits on the right edge of the screen while the app runs. Click it to open the search panel
beside it; drag it up or down to move it; drop images on it to send them to the inbox. Hide or show it from the menu
bar icon (Show the Precedents tab). In the panel, click an image to see it large, then ‹ › or the arrow keys go
through that precedent's images.

A small Mac app for Greenshoot's Precedents library. Separate from Groundwork Capture (the mapping tools' widget).

- **Control-Option-P** (or the menu bar icon > Find a precedent): a search panel appears over whatever you're working
  in. Type anything: name, place, designer, Traditional Owners, category, tag. Arrow keys and Return open a result.
  ✦ Ask (or Command-Return) asks Groundwork in plain words.
- Open a precedent to see its images. **Drag an image straight into InDesign, PowerPoint, Keynote or Finder**, or
  hover it to **copy** (then paste anywhere) or **download** it. **Download all** saves the lot to
  `Downloads/Precedents/<id> <name>/`. Click an image to see it larger.
- **Pin** keeps the panel open while you work (it pins itself when you drag an image out). Unpinned, it hides when
  you click elsewhere or press Esc. Drag the dark header to move it.
- **Control-Option-O**: take a screenshot of anything (drag over the area) and send it to the Precedents inbox, with
  a note and the page or app it came from.
- **Drop image files onto the panel** (from Finder, the desktop or another app), or paste one with Command-V, to send
  them to the inbox too.
- First time: sign in on the panel with the team password and your name (kept on this Mac).

## Building and installing
Double-click `build.command`. It builds the app into `~/Applications/Precedents.app` and starts it. The first time,
macOS may ask to install Apple's Command Line Tools, and later to allow access to Downloads (for saving images) and to
your browser (to note which page a screenshot came from). Turn on Start at login from the menu bar icon.
To give it to a colleague: zip `~/Applications/Precedents.app` and send it; they right-click > Open the first time
(it isn't signed with an Apple developer certificate).

## How it works
- `main.swift`: the floating panel (a borderless window with a web view), shortcuts (Carbon hot keys, no permission
  needed), dragging files out (images are fetched into `~/Library/Caches/au.greenshoot.precedents/images` when a
  precedent is opened, so the drag is a real file), copying, downloads, screenshots (`screencapture -i`).
- `../public/desk.html`, `desk.css`, `desk.js`: the panel itself, built into the app and loaded as if from the site
  (so it can search the library and keep the sign-in). Design changes need a rebuild. To try changes live without
  rebuilding: `defaults write au.greenshoot.precedents pageURL https://<site>/desk.html` (delete it to go back).
- The site address: `defaults write au.greenshoot.precedents siteURL https://...` (default: the live Precedents site).
- Page to app messages (`webkit.messageHandlers.pr`): ready, hide, pin, move, open, download, prefetch, drag, copy,
  reveal, screenshot. App to page: `pr.focus()`, `pr.setPinned(b)`, `pr.shot(item)`, `pr.downloaded(n, folder)`,
  `pr.copied()`, `pr.note(text)`.
- Preview without a Mac: `/dev/desk-preview.html` on the mock server.
