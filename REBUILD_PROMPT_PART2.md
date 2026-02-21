# Mango Chrome Extension — Complete Rebuild Prompt (Part 2 of 3)

## 10. content/accessibility.js

**Global state:** `fontEnabled = false`, `hoverEnabled = false`, `simplifiedElements = []`

On load: Reads `fontEnabled` from `chrome.storage.sync`, applies font if enabled.

### Functions:

**`toggleOpenDyslexicFont(enabled)`**:
- If enabled: Injects `@font-face` style (id `opendyslexic-font-face`) pointing to `chrome.runtime.getURL('fonts/OpenDyslexic-Regular.otf')`. Injects global style (id `opendyslexic-font-style`) setting `font-family:'OpenDyslexic'` on `body, body *` with `line-height:1.5`, `letter-spacing:0.5px`, `word-spacing:3px`, all `!important`.
- If disabled: Removes both style elements.

**`applyOpenDyslexicFont()`** / **`removeOpenDyslexicFont()`**: Wrappers.

**`applySpacingAdjustments(lineSpacing, letterSpacing, wordSpacing)`**: Removes existing `#spacing-adjustments-style`, creates new `<style>` applying values to `body, body *` with `!important`.

**`applyTheme(themeName)`**: Looks up from `themes` object. Creates/updates `#theme-style`. If `default`, clears. Otherwise sets `background-color`/`color` on `html, body` and `body *` with `!important`.

**`enableHoverFeature()`**: Queries `.simplified-text` elements, adds `mouseenter`/`mouseleave` listeners.
**`disableHoverFeature()`**: Removes those listeners.

**`showOriginalText(event)`**: Creates tooltip div (class `original-text-tooltip`), positions above element via `getBoundingClientRect`, stores on `event.currentTarget._originalTextTooltip`.
**`hideOriginalText(event)`**: Removes tooltip.

**`initAccessibility()`**: Reads `selectedTheme` from sync storage, applies. Reads spacing values, applies (defaults: 1.5, 0, 0).

---

## 11. content/text-simplification.js

**Global state:** `systemPrompt = null`, `isSimplifying = false`, `aiAvailable = null`

### Functions:

**`getReadingLevel()`**: Reads `simplificationLevel` (or legacy `readingLevel`) from sync storage. Default `'3'`.

**`checkAIAvailability()`**: Sends `{ action:'checkPromptAPI' }` to background. Returns `{ available, status }`.

**`loadSystemPrompts()`**: Sends `{ action:'getSystemPrompts' }` to background.

**`simplifyTextViaBackground(text, sysPrompt)`**: Sends `{ action:'simplifyText', text, systemPrompt }` to background. Returns simplified text.

**`loadCurrentSystemPrompt()`**: Loads prompts, reads level and `optimizeFor` (default `'textClarity'`), returns `prompts[optimizeFor][readingLevel]`.

**`ensureInitialized()`**: Checks AI availability, loads system prompt.

**`showToast(msg, bgColor, duration=8000)`**: Fixed-position notification.

**`simplifyPageContent()`** — main function:
1. Guards concurrent runs
2. `ensureInitialized()`
3. If AI unavailable: toast with Chrome flags instructions (`chrome://flags/#prompt-api-for-gemini-nano`, `chrome://flags/#summarization-api-for-gemini-nano`, `chrome://flags/#optimization-guide-on-device-model`)
4. Reloads system prompt
5. **Content extraction** — tries selectors in order: `main article`, `article`, `.post-content`, `.entry-content`, `.article-body`, `[itemprop="articleBody"]`, `.content`, `#content`, `main`, `.main`, `[role="main"]`, `body`
6. Extracts: `p, h1, h2, h3, h4, h5, h6, ul, ol, dl`
7. **Filters metadata**: Skips elements inside `.author`, `.byline`, `.date`, `.meta`, `.tags`, `.social`, `.share`, `.comments`, `.sidebar`, `.nav`, `.footer`, `.header`, `.ad`, `.advertisement`, `.related`, `.recommended`
8. **Token estimation**: `estimateTokens(text) = Math.ceil(text.length / 4)`
9. **Chunking**: Groups into ~800 token chunks. Headers/lists start new chunks. Single-header chunks skipped.
10. **Processing loop** per chunk:
    - Joins non-header text with `\n\n`
    - Sends to background via `simplifyTextViaBackground()`, up to 5 retries (1s delay)
    - Splits result by `\n\n`
    - Matches simplified paragraphs to original DOM elements
    - If more simplified than original: truncates
    - If fewer: removes excess originals
    - Replaces each element:
      - Lists (`UL`/`OL`/`DL`): Creates matching list with items
      - Others: `<p>` with `marked.parse()` if available, else plain text
    - Adds class `simplified-text`, stores `data-original-html`/`data-original-text`
    - Adds hover listeners if `hoverEnabled`
    - Checks OpenDyslexic and applies/removes
11. Shows "✨ Text simplified" toast (3s)
12. Returns `{ success: true }`

---

## 12. content/link-summarization.js

Wrapped in IIFE with `'use strict'`. ~1044 lines.

### Constants & State
- `HOVER_DELAY = 300`
- `IS_YOUTUBE`, `IS_TWITTER`: from `window.location.hostname`
- `DEBUG_ENABLED = !IS_YOUTUBE`
- `REDDIT_HOSTS`, `TWITTER_HOSTS`, `YOUTUBE_HOSTS` (Sets)
- State vars for hover tracking, tooltip, Twitter cache, YouTube tokens

### Safe Messaging
**`safeSendMessage(message, callback)`**: Wraps `chrome.runtime.sendMessage`:
- Checks `chrome.runtime?.id` first
- If callback: passes it, checks `lastError`
- If no callback: fire-and-forget with `.catch(()=>{})` (prevents "message port closed" warning)
- Catches "Extension context invalidated" gracefully

**`safeSendMessageAsync(message)`**: Promise wrapper around `safeSendMessage`.

### Tooltip System
**`createTooltip()`**: Fixed div, id `mango-summary-tooltip`. White bg, 12px border-radius, 4px orange left border (`#FF9800`), max-width 400px, max-height 500px, overflow scroll. Close button (×). Mouse enter/leave handlers.

**`positionTooltip(element, placement)`**: Positions relative to element. Supports `'auto'`/`'right'`/`'left'`. Clamps to viewport with 12px gap.

**`showTooltip(element, content, url, options)`**: Shows with content, attaches dismiss handlers (click outside, Escape).

**`hideTooltip()`**: Opacity→0, then display:none after 200ms.

**`updateTooltipContent(content, url)`**: Updates without hide/show.

**`scheduleHide(delay, forUrl)`**: Delayed hide, respects `isMouseInTooltip`.

**`cancelActiveSummary(reason)`**: Clears timeouts, hides, aborts YouTube if needed.

### Twitter Helpers (extensive)
**`ensureTwitterInterceptor()`**: Injects `twitter/twitter-interceptor.js` into page context. Listens for `window.postMessage` events.

**`handleTwitterPostMessage(event)`**: Captures `TWITTER_GQL_RESPONSE` messages.

**`recordTwitterGqlPayload(json)`**: Caches GraphQL responses by tweet ID (max 8 per ID).

**`extractTweetIdsFromJson(obj)`**: Recursive walker finding `rest_id`, `restId`, `legacy.id_str`.

**`buildThreadFromCache(tweetId)`**: Builds thread from cached GraphQL data.

**`collectTweetsFromPayload(obj, map)`**: Recursive walker extracting tweet candidates.

**`extractTweetCandidate(node)`**: Resolves tweet objects through various Twitter API shapes. Extracts: id, handle, authorName, text, timestamp, media, permalink, conversationId, inReplyToId.

**`resolveTweetResult(node)`**: Handles 8+ different Twitter API response shapes to find Tweet object.

**`extractTweetText(result, legacy)`**: Checks `note_tweet` (long tweets) first, then `full_text`, then `text`.

**`extractTweetMedia(legacy)`**: Photos, videos, GIFs from `extended_entities.media`.

**`extractThreadFromDom(articleElement, tweetId)`**: Expands thread, collects articles, extracts nodes, deduplicates, limits to 12.

**`expandTwitterThread(articleElement, options)`**: Clicks expand buttons matching `/(show|view|reveal).*(repl|thread|tweet)/i`, scrolls.

**`preloadTwitterConversation(articleElement, options)`**: Multiple passes of expand + scroll.

**`collectThreadArticles(rootArticle)`**: All `article[role="article"]` from timeline containers.

**`extractNodeFromArticle(article, isRoot, fallbackTweetId)`**: Node data from DOM article.

**`formatTwitterThreadForSummary(threadPayload)`**: Formats as text for AI.

**`processTwitterHover(article, presetInfo)`**: Full pipeline — cache → DOM extraction → background scrape. Loading states. Sends `SUMMARIZE_CONTENT`.

### YouTube Helpers
**`extractYouTubeVideoId(url)`**: Regex for watch/embed/shorts URLs.
**`isYouTubeVideoLink(url)`**: Host check + video ID.
**`findYouTubeCardElement(element)`**: Parent card renderer.
**`isYouTubeThumbnail(element)`**: Inside thumbnail selectors.
**`waitForYouTubeCaptions(videoId)`**: Listens for `youtube-captions-ready` (5s timeout).
**`handleYouTubeVideoHover(anchor, link, url, token)`**: Shows "Capturing captions…", waits, sends `GET_YOUTUBE_SUMMARY`. 30s timeout. Uses `requestToken` for rapid hover switches.

### General Helpers
**`findLink(element)`**: Walks up 10 parents for `<a>` with href.
**`getShortUrl(url)`**: Last 2 path segments.
**`isRedditPostUrl(url)`**: `REDDIT_HOSTS` + `/comments/` pattern.
**`isInternalTwitterLink(url)`**: `TWITTER_HOSTS` check.

### Mouse Events
**`handleMouseOver(e)`**: Returns if `gazeEnabled`. Handles Twitter articles, YouTube thumbnails/links, general links. Sets hover timeouts.

**`handleMouseOut(e)`**: Clears timeouts, schedules hide. Min display time 500ms. Checks tooltip/card containment.

### Link Processing
**`processLinkHover(link)`**: Pipeline:
1. Reddit → `processRedditPost()`
2. Twitter → `processTwitterHover()`
3. General: Fetch HTML via `FETCH_CONTENT` → parse with `Readability` → extract title/content → `SUMMARIZE_CONTENT`
4. Fallback: `<meta>` description

**`processRedditPost(link, url, shortUrl)`**: Sends `SUMMARIZE_REDDIT_POST`.

**`handleSummaryResult(result, link, url, shortUrl, isStillCurrent)`**: Handles: duplicate, aborted, error, complete (cached=immediate), streaming (via message listener).

### Message Listener
Handles: `CAPTURE_TWITTER_THREAD`, `STREAMING_UPDATE`, `PROCESSING_STATUS`, `DISPLAY_MODE_CHANGED`, `GAZE_ENABLED_CHANGED`, `TRIGGER_CALIBRATION`, `TRIGGER_MOUTH_CALIBRATION`, `PING`.

### Initialization
- If Twitter: `ensureTwitterInterceptor()`
- Attaches `mouseover`/`mouseout` on `document.body` (capture phase)
- Reads `displayMode` and `gazeEnabled` from `chrome.storage.local`
- Has inline `formatAISummary()` (identical to utils version)
- Listens for `gaze:status` window events, relays to background

---

## 13. content/content-main.js

Message router. `chrome.runtime.onMessage` dispatches:

| Action | Handler |
|---|---|
| `simplify` | `await simplifyPageContent()` |
| `toggleFont` | `toggleOpenDyslexicFont(request.enabled)` |
| `applyTheme` | `applyTheme(request.theme)` |
| `getFontState` | Returns `{ fontEnabled }` |
| `adjustSpacing` | `applySpacingAdjustments(line, letter, word)` |
| `toggleHover` | `enableHoverFeature()` or `disableHoverFeature()` |
| `getHoverState` | Returns `{ hoverEnabled }` |

On `DOMContentLoaded` / ready: calls `initAccessibility()` and `ensureInitialized()`.

---

## 14. content/content.css

- `.loader`: Spinning border animation (`mango-spin`)
- `.simplified-text`: Font family, line-height 1.6, color `#2c3e50`, padding, margins. Sub-styles for headings, paragraphs, lists, code, blockquote (orange left border `#FF9800`), pre.
- `.original-text-tooltip`: Absolute, dark bg `rgba(0,0,0,0.85)`, white text, max-width 400px, border-radius 8px, z-index 10000, pointer-events none.

---

*Continue to Part 3 for sidepanel, YouTube, Twitter, and gaze module specifications.*
