# Purr Review reference

Commands and paths below are relative to the repository root.

## Use

The header’s **Next TBD only** checkbox is on by default. Uncheck it to advance through every paper in the selected sort order, including existing decisions and unavailable papers. Advancing wraps at the end. Decision sorting uses the next paper’s position before the save reshuffles the list. Undo still returns to the paper just changed.

Decision sorting uses current bids, from Not Willing through Eager (or the reverse), followed by TBD and unavailable papers. Every sort breaks ties by ascending numeric Paper ID.

Download exports all loaded papers to `purr-review.csv` with Title, Abstract, Decision, Relevance, and TPMS columns. Decisions reflect confirmed bids; unbid papers are TBD and unknown bids are Unavailable. The file is generated locally.

The header counts all loaded papers with recognized bids. TBD means Not Entered, including skipped unbid papers. Unknown/conflicted bids are excluded. Counts change after confirmed decisions and undo.

| Key | Action |
| --- | --- |
| ← | Not Willing |
| ↓ | In a Pinch |
| → | Willing |
| ↑ | Eager |
| Z | Undo the most recent successful decision, restoring its previous CMT bid |
| Enter | Paper details |
| S | Skip for now, without changing the bid |
| Esc | Close an open panel; otherwise exit and return to CMT |

Drag/swipe the paper card or use the visible decision controls. On touchscreens, scroll the abstract normally and use the **Drag to decide** grip for swipes in all four directions. The sidebar lists all loaded papers with their IDs and colored bid labels. Click a paper to select it; selecting an already bid paper explicitly revisits that bid. Disabled, conflicted, or ambiguous controls remain unavailable for bidding.

Sort by Paper ID or relevance in either direction. Changing the sort preserves the selected paper. Sidebar bid labels update after confirmed decisions and undo.

**Text size** adjusts the title and abstract independently. **Auto fit** is on by default: both use the largest size from 12–20 px that fits, with a bold title. Longer content remains scrollable at 12 px. Moving either size slider switches to fixed sizes (12–36 px). Settings last for the current session.

The card footer shows track, primary and secondary subjects, relevance, and TPMS. Missing values appear as `—`.

Changes use the page’s existing controls. A decision advances only after CMT’s control reflects the requested value. This is **DOM confirmation**, not independent proof that CMT’s server persisted it. Check the ordinary CMT page after a short trial before a large session. Failures remain visible and do not advance the paper. Launching the bookmark twice reuses the active instance to preserve in-flight changes and history. Exit removes the overlay; launching again after exit starts cleanly.

Only one change runs at a time. Pressing Z while a save is pending queues one undo after CMT confirms it. If a save fails or times out, return to CMT and inspect that bid before relaunching. Esc closes an open panel first; from the main interface it exits immediately. A request CMT has already submitted can still finish afterward. History lasts only for the current Purr Review session.

## Diagnostics and validation scope

Run this in the browser console while Purr Review is open:

```js
window.__PURR_REVIEW__.diagnostics()
```

Diagnostics describe detected structures, controls, options, and rejection reasons locally. They are never uploaded automatically. If detection fails, a useful next input is a **live, rendered** bidding-table row including its headers and complete bid-control markup/options. Remove paper text or personal information before sharing. Include the local diagnostic report and any browser-console error.

The demo and tests use synthetic placeholders. No saved CMT pages or private captures are included. These tests do not establish live CMT compatibility.

The adapter waits for CMT to close its editor and reflect the requested bid, checks for errors/dialogs, and verifies the displayed bid remains stable. It never calls CMT’s private endpoints or assumes numeric option IDs.

Android single-line text editors default to a 5,000-character limit ([Android source](https://android.googlesource.com/platform/frameworks/base/+/223c8e0%5E%21/)); Chrome’s bookmark URL field uses this kind of editor. The reported cutoff near `rowConnected` matches this limit. CMT content-security-policy restrictions have not been measured on a logged-in mobile session. The build prints the script and URL-encoded bookmark sizes. If your bookmark does nothing, first check that its saved URL starts with `javascript:` and has not been truncated. Check the console for a concrete policy or script error and preserve its exact message. For browsers that truncate the full bookmark, `dist/bookmarklet-mobile.txt` is a short loader. It downloads the static app script from `https://wanshenl.me/purr-review/dist/purr-review.js` with no referrer and anonymous CORS (no cross-origin cookies). It sends no paper data. A load failure produces an alert; CMT may still block external scripts through its content-security policy. Each fresh launch adds a timestamp query parameter to avoid stale browser/CDN caches. Launching while Purr Review is already open focuses the existing instance; close it first to load an update. Previously saved loaders need to be replaced once to gain cache-busting. Android bookmark storage/launch has not been verified on a device.

## Privacy

The self-contained bookmark loads no remote scripts, fonts, assets, analytics, or services. The optional mobile loader downloads the app script from the project site; it does not add analytics or upload paper data. It does not read credentials or send paper data elsewhere. CMT’s own controls continue to make CMT’s normal authenticated requests. The bookmarklet runs only in the page where you launch it.

## Source and outputs

- `src/adapter.js`: CMT DOM discovery, extraction, bid mapping, mutation, and verification.
- `src/app.js`: state/history, serialized synchronization, input, gestures, interface, animation, and cleanup.
- `dist/purr-review.js`: readable, self-contained script used by the CDN loader and demo.
- `dist/bookmarklet.txt`: complete self-contained `javascript:` URL.
- `src/loader.js` / `dist/bookmarklet-mobile.txt`: optional short hosted loader.
- `index.html`: installation page with the auto-updating hosted bookmark and a link to the fully local alternative.
- `demo/index.html`: local simulation.

## Maintainer build (optional)

The delivered files are ready to use. Rebuilding is only needed after editing source. Use Node.js and the pinned maintainer-only minifier:

```sh
npm install --prefix /tmp/purr-review-build --no-save --package-lock=false terser@5.44.0
TERSER_MODULE=/tmp/purr-review-build/node_modules/terser node scripts/build.mjs
```

If Terser 5.44.0 is already installed where Node can resolve it, `node scripts/build.mjs` also works. The script syntax-checks both bundles, verifies URL encoding, and regenerates all production outputs and the installer from `scripts/install-template.html`. Commit generated outputs alongside source changes. No dependency is included in or downloaded by the bookmarklet.

Run the browser regression suite with a local Chrome installation:

```sh
node --test tests/*.test.mjs
```

The interactive demo and recording share a reference-inspired CMT layout with synthetic identities and paper data, including an anonymous “1 - XXX of XXX” count. The demo recording opens on this labeled simulated CMT screen, zooms into a Purr Review bookmark and clicks it, shows navigation at 2× speed, pauses for a final click on Willing and its confirmation, and closes with “Zero install. Just add a bookmark.” The browser bar is staged for the recording; its bookmark runs the actual built bookmarklet.

To regenerate the demo recording after a build, use local Chrome and ffmpeg:

```sh
node scripts/record-demo.mjs
```

These are maintainer tools; users do not need them.

These tests use Node’s built-in test runner and Chrome’s debugging protocol; no test package installation is required. They exercise simulated CMT behavior, including option ambiguity, failed and slow updates, real bid restoration, repeated keys, dialogs, and cleanup.

Independent tool; not affiliated with Microsoft. See `LICENSE`.
