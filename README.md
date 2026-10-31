# Prompted Feed

Prompted Feed is an unpacked Manifest V3 Chrome extension that filters the X/Twitter Home timeline with an OpenAI model. An opaque custom center column covers X's original feed and renders only matching posts using snapshots of X's own tweet markup. The native feed stays rendered and measurable behind it, allowing X's virtualized loader to operate without making the visible feed flicker.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `src/` directory of this repository.
4. The settings page opens automatically. Add your feed preference and an OpenAI API key, leave `gpt-5.6-luna` selected, then click **Save & test**.
5. Enable filtering and open `https://x.com/home` (or `https://twitter.com/home`).

No X/Twitter cookie is required. The content script runs in the page you are already signed into, reads rendered post text, and does not request Chrome cookie access.

## Behavior

- Filters the Home timeline only; profiles, search, lists, and individual post pages are unchanged.
- Preserves X's native tweet typography, spacing, media grids, quoted posts, link
  cards, badges, and action-count layout. Native links continue to work. Like and
  bookmark controls are forwarded to the live mounted tweet when available;
  reply, repost, and fallback actions use X's authenticated intent pages.
- Expands X's live tweet text before snapshotting so accepted long posts do not
  retain a broken detached **Show more** control.
- Supports normal click, middle-click, and Command/Ctrl-click navigation to the
  live tweet. Share uses the system share sheet when available and otherwise
  copies the tweet URL.
- Materializes live video sources and posters into accepted snapshots and enables
  native video controls.
- Removes X's right sidebar while filtering and expands the accepted feed up to
  900 pixels when space is available.
- Batches up to 12 posts per API call to reduce repeated prompt tokens and request overhead.
- Uses the OpenAI Responses API with structured outputs and `reasoning.effort: "none"`.
- Caches decisions for the current page session, including posts React renders again while scrolling.
- Defaults to fail-closed: posts that cannot be classified remain hidden. This can be changed in Settings.
- The covered X timeline advances to its native bottom sentinel in bounded
  chunks until the custom feed has a
  buffer of matching posts. A **Scan more posts** button appears when a chunk is
  exhausted without finding enough matches.
- A bottom-left debug panel shows how many unique posts were loaded, allowed,
  filtered, pending, or affected by API errors. The toolbar badge shows the
  number filtered during the current page session.
- The debug panel stores and graphs hourly filter hit rate for the last 90 days,
  along with lifetime accepted/total counts. History is kept in local extension
  storage and is not sent anywhere.
- Clicking the background of any accepted tweet opens its live X post. Existing
  links inside the native tweet layout keep their original destinations.

## Privacy and key handling

Post author text, post text, and useful media alt text are sent directly to the OpenAI API. Requests use `credentials: "omit"`, `store: false`, and never contain X/Twitter cookies.

The OpenAI key is stored in `chrome.storage.local`, not sync storage. This is convenient for a personal unpacked extension, but a browser extension is still client-side software. Do not publish or distribute a copy with a key embedded in it. For a multi-user release, replace the direct API call with a small authenticated backend so users never receive a shared API credential.

## Project structure

```
src/                      Extension root (load this directory unpacked)
  manifest.json
  background/             Service worker: OpenAI calls, badge, history storage
  content/                Content script and styles injected into x.com
  lib/                    Shared modules (also loaded by the Node tests)
  popup/                  Toolbar popup
  options/                Settings page
  styles/ui.css           Shared popup/options styles
  icons/                  icon.svg source and rendered PNGs (16/32/48/128)
test/                     node:test unit tests for src/lib
scripts/                  Icon rendering and packaging helpers
```

## Development

```bash
npm test          # run unit tests (Node 20+, no dependencies)
npm run icons     # re-render src/icons/*.png from icon.svg with headless Chrome
npm run package   # zip src/ into dist/prompted-feed-<version>.zip
```

The version lives in `src/manifest.json`. After editing files, click the reload
button for the extension on `chrome://extensions`.

The X/Twitter DOM changes occasionally. The implementation intentionally relies on the relatively stable `article[data-testid="tweet"]`, `tweetText`, and `User-Name` accessibility/test hooks and falls back to the article's visible text for image- or link-only posts.
