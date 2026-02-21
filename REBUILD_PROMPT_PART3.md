# Mango Chrome Extension — Complete Rebuild Prompt (Part 3 of 3)

## 15. sidepanel.html

Three-tab layout with mango-themed header.

### Header
- Logo: `icons/icon-48.png` (class `mango-logo`)
- Title: "Mango" (class `mango-title`)
- Tagline: "Accessibility • AI • Hands-Free" (class `header-tagline`)

### Tab Navigation (3 tabs)
1. **♿ Accessibility** (default active, `data-tab="accessibility"`)
2. **🤖 AI Summary** (`data-tab="summary"`)
3. **👁️ Tracking** (`data-tab="tracking"`)

### Tab 1: Accessibility
**Text Simplification card:**
- Card title: "📖 Text Simplification"
- Setting label: "Reading Level"
- 3 level buttons (values "1", "3", "5") with labels "Mild", "Medium", "Strong". Default selected: "3"
- Optimize mode select (id `optimize-mode`): options "Text Clarity" (textClarity), "Focus & Structure" (focusStructure), "Word Patterns" (wordPattern)
- Help text: "Choose how text is restructured for your needs"
- Simplify button (id `simplify-btn`): "✨ Simplify Page Text"

**Visual Settings card:**
- Card title: "🎨 Visual Settings"
- OpenDyslexic Font toggle (id `font-toggle`)
- Show Original on Hover toggle (id `hover-toggle`)
- Color Theme select (id `theme-select`): 13 options matching themes.js keys with human-readable labels

**Spacing card:**
- Card title: "📏 Spacing"
- Line Spacing slider (id `line-spacing`): min 1, max 3, step 0.1, default 1.5
- Letter Spacing slider (id `letter-spacing`): min 0, max 5, step 0.5, default 0
- Word Spacing slider (id `word-spacing`): min 0, max 10, step 1, default 0
- Each has display span showing current value
- Reset button (id `reset-spacing-btn`): "↩ Reset Spacing"

### Tab 2: AI Summary
**Settings card:**
- Card title: "⚙️ Summary Settings"
- Display Mode select (id `display-mode`): "Tooltip on Hover" (tooltip), "Side Panel" (panel)
- API Choice radio group (name `api-choice`): "Summarization API" (summarization, default checked), "Prompt API" (prompt)
- Custom Prompt textarea (id `custom-prompt`, in `prompt-container` div, initially hidden): default "Summarize this article in 2-3 sentences", rows 3

**Loading state** (id `loading-state`, hidden):
- Spinner div
- Status text (id `loading-text`): "Extracting content..."

**Content area** (id `content-area`, hidden):
- Title h2 (id `title`)
- Section heading "AI Summary"
- AI summary div (id `ai-summary`)
- Toggle button (id `toggle-content-btn`, hidden): "Show Full Content"
- Full content section (id `full-content-section`, hidden) with article content div (id `article-content`) and fallback div (id `fallback-article`)

**Error state** (id `error-state`, hidden):
- Error card with message span (id `error-message`)

**Welcome state** (id `welcome-state`):
- Welcome icon: 🥭
- Text: "Hover over any link to see an AI-powered summary"

### Tab 3: Tracking
**Head Tracking card:**
- Card title: "🎯 Head Tracking"
- Toggle (id `gaze-toggle`)
- Status indicator with dot (id `gaze-status-dot`) and text (id `gaze-status-text`): "Disabled"
- Calibrate button (id `calibrate-btn`, disabled): "🎯 Calibrate Head Tracking"
- Dwell Time setting: slider (id `dwell-time`) min 300, max 1200, step 50, default 600, display span (id `dwell-value`): "600ms"

**Mouth Click card:**
- Card title: "👄 Mouth Click"
- Toggle (id `mouth-toggle`)
- Status indicator with dot (id `mouth-status-dot`) and text (id `mouth-status-text`): "Disabled"
- Calibrate button (id `mouth-calibrate-btn`, disabled): "👄 Calibrate Mouth Click"

**Keyboard Shortcuts** (collapsible `<details>`):
- Summary: "⌨️ Keyboard Shortcuts"
- `Alt + H` — Start head calibration
- `Alt + B` — Toggle blink-to-click
- `Alt + G` — Toggle gaze tracking
- `Alt + D` — Toggle debug HUD

Script tag: `<script src="sidepanel.js"></script>`

---

## 16. sidepanel.css

Mango-themed design system (~715 lines). CSS custom properties:
```css
--color-primary: #FF9800;
--color-primary-hover: #F57C00;
--color-primary-light: #FFF3E0;
--color-primary-dark: #E65100;
--color-accent: #FFB74D;
--color-success: #4CAF50;
--color-success-light: #E8F5E9;
--color-warning: #FFC107;
--color-error: #F44336;
--color-text: #212121;
--color-text-secondary: #757575;
--color-text-light: #9E9E9E;
--color-border: #E0E0E0;
--color-bg: #FAFAFA;
--color-bg-card: #FFFFFF;
--color-bg-hover: #FFF8E1;
```

Key component styles:
- **Header**: `linear-gradient(135deg, #FF9800 0%, #FFB74D 50%, #FF9800 100%)`, logo `filter: brightness(0) invert(1)`
- **Tab nav**: Sticky, bottom border indicator, active = orange
- **Cards**: Border, shadow-sm, hover shadow-md
- **Buttons**: Primary = orange fill, secondary = orange outline → fill on hover, translateY(-1px) hover effect
- **Level buttons**: Selected = orange fill white text
- **Toggle switches**: 44×24px, orange when checked, 18px circle knob
- **Sliders**: 5px track, 18px orange thumb
- **Status dots**: 8px, pulsing animation, states: loading(yellow), ready(orange), calibrated(green), live(green no pulse)
- **AI summary**: Light orange bg `#FFF3E0`, 4px orange left border
- **Keyboard shortcuts**: Collapsible with rotating arrow, styled `<kbd>` elements

---

## 17. sidepanel.js

### State
```js
let settings = {
  apiChoice: 'summarization', customPrompt: 'Summarize this article in 2-3 sentences',
  displayMode: 'tooltip', gazeEnabled: false, gazeDwellMs: 600,
  simplificationLevel: '3', optimizeFor: 'textClarity', selectedTheme: 'default',
  fontEnabled: false, hoverEnabled: false, lineSpacing: 1.5, letterSpacing: 0, wordSpacing: 0
};
```

### Initialization (DOMContentLoaded)
1. `cacheElements()` — gets all DOM elements by ID
2. `loadSettings()` — reads `chrome.storage.local` and `chrome.storage.sync`, updates UI
3. `setupTabNavigation()` — tab button click handlers
4. `setupEventListeners()` — all control handlers
5. `showWelcome()`
6. Queries `GET_API_STATUS` from background

### Event Listeners
- **Level buttons**: Toggle `selected` class, save `simplificationLevel` to sync
- **Optimize mode**: Save `optimizeFor` to sync
- **Simplify button**: Disable, send `simplifyActiveTab` to background, re-enable after 2s
- **Font toggle**: Save to sync, relay `toggleFont` to active tab
- **Hover toggle**: Save to sync, relay `toggleHover` to active tab
- **Theme select**: Save to sync, relay `applyTheme` to active tab
- **Spacing sliders**: Update display, `applySpacing()` saves and relays `adjustSpacing`
- **Reset spacing**: Resets to 1.5, 0, 0
- **API choice radios**: Save to local, toggle prompt container
- **Custom prompt**: Save to local
- **Display mode**: Save to local, relay `DISPLAY_MODE_CHANGED`
- **Toggle full content**: Show/hide full content section
- **Gaze toggle**: Save to local, relay `GAZE_ENABLED_CHANGED`, enable/disable calibrate btn
- **Calibrate btn**: Relay `TRIGGER_CALIBRATION`
- **Mouth toggle**: Save to local, enable/disable calibrate btn
- **Mouth calibrate btn**: Relay `TRIGGER_MOUTH_CALIBRATION`
- **Dwell slider**: Update display, save to local

### Helper Functions
- `relayToActiveTab(payload)`: Sends `{ action:'relayToActiveTab', payload }` to background
- `togglePromptContainer()`: Shows/hides based on API choice
- `applySpacing()`: Saves sync, relays values
- `updateGazeStatus(phase, note)`: Updates dot class and text
- `updateMouthStatus(calibrated)`: Updates mouth indicator

### Display Functions
- `hideAll()`: Hides welcome/loading/content/error
- `showWelcome()`: Shows welcome state
- `showProcessing(title)`: Shows loading, then "Summarizing..." after 500ms
- `updateSummaryDisplay(formattedContent)`: Updates AI summary HTML
- `displayCachedSummary(title, formattedSummary)`: Shows cached immediately

### Message Listener
- `STREAMING_UPDATE`: Updates summary (if panel mode)
- `PROCESSING_STATUS`: Shows processing state
- `DISPLAY_CACHED_SUMMARY`: Shows cached
- `GAZE_STATUS`: Updates gaze indicator

### Storage Change Listener
Watches `mouthCalV1` changes to update mouth status.

---

## 18. youtube/youtube-caption-handler.js

Runs in **page context** (injected via web_accessible_resource). Only on YouTube.

- `captionCache` Map: videoId → `{ videoId, captions, text, timestamp }`
- **`setupInterception()`**: Monkey-patches `XMLHttpRequest.prototype.open`/`.send`. On load, if URL has `timedtext`/`caption`, parses and caches. Dispatches `youtube-captions-ready` CustomEvent.
- **`parseCaptions(data)`**: JSON3 (`"events"` + `segs`) and XML (`<text>`) formats.
- Exposes: `window.__ytGetCaptions()`, `__ytHasCaptions()`, `__ytClearCache()`
- Listens for `postMessage` type `YT_GET_CAPTIONS`, responds with `YT_CAPTIONS_RESPONSE`

---

## 19. youtube/youtube-content-bridge.js

**Content script** on YouTube. Bridges page ↔ extension.

- Injects `youtube-caption-handler.js` via `<script src>` element
- Listens for `youtube-captions-ready`, re-dispatches as `yt-captions-available`
- `pendingCaptionRequests` Map for request/response correlation
- **`getCaptionsFromPage(videoId)`**: Posts `YT_GET_CAPTIONS`, waits for `YT_CAPTIONS_RESPONSE` (1s timeout)
- Exposes: `window.getYouTubeCaptions()`, `window.hasYouTubeCaptions()`
- Handles `chrome.runtime.onMessage` action `GET_YOUTUBE_CAPTIONS` — bridges to page context

---

## 20. youtube/youtube-inject-page.js

**Page context** testing utility. Intercepts fetch + XHR for `timedtext`/`caption`. Stores in `window.__ytCaptureData` Map. Green notification on capture. Exposes `ytTestStart()`, `ytTestStop()`, `ytTestResults()`.

---

## 21. youtube/youtube-methods.js

Utility library. Available as `window.YouTubeMethods`.

- `extractVideoId(url)`: 10+ regex patterns for all YouTube URL formats (watch, embed, shorts, youtu.be, vi/, vi_webp/)
- `parseCaptionData(data, format)`: JSON3, XML, plain JSON array
- `captionsToText(captions)`: Joins `.text` with spaces
- `fetchCaptionsDirect(videoId, lang)`: Tries 3 endpoints, uses background fetch in extension context
- `setupNetworkIntercept()`: Monkey-patches fetch/XHR, returns cleanup function
- `setupWebRequestIntercept()`: Uses `chrome.webRequest` (background only)
- `waitForCaptions(videoId, timeout)`: Promise wait for capture event

---

## 22. youtube/youtube-test-injector.js

Content script that injects `youtube-inject-page.js` into page context via `<script src>` using `chrome.runtime.getURL`.

---

## 23. twitter/twitter-interceptor.js

**Page context** (injected). IIFE with guard `window.__hoverTwitterInterceptorInstalled`.

- **`shouldCapture(url)`**: Returns true if URL has `/i/api/graphql/` and matches `TweetDetail|TweetResultByRestId|ConversationTimeline|threaded_conversation`
- Patches `window.fetch`: Clones response, parses JSON, posts `{ source:'hover-preview-twitter', type:'TWITTER_GQL_RESPONSE', payload:{ url, json } }`
- Patches `XMLHttpRequest.prototype.open` (stores URL) and `.send` (load listener captures response)

---

## 24. GAZE MODULE

Complex hands-free browsing system. 5 files + vendored Human.js.

### gaze/gaze-core.js (~1458 lines)

IIFE. Core face detection and head tracking.

**Constants:**
- `DEFAULT_DWELL_MS = 600`, `POINT_THROTTLE_MS = 33` (~30fps)
- One-Euro filter: `HEAD_FILTER_MIN_CUTOFF=0.4`, `HEAD_FILTER_BETA=0.0025`, `HEAD_FILTER_D_CUTOFF=1.0`
- `HEAD_POINTER_LERP=0.12`, `HEAD_TRANSLATION_GAIN=1`, `HEAD_ROTATION_INFLUENCE=0.22`
- `HEAD_CENTER_LERP=0.06`, `HEAD_EDGE_LERP=0.10`
- Blink: `BLINK_LEFT_THRESHOLD_MS=1000`, `BLINK_RIGHT_THRESHOLD_MS=2000`
- Mouth: `MOUTH_CALIBRATION_SAMPLES=30`, `MOUTH_OPEN_COOLDOWN_MS=800`

**Pipeline:**
1. Loads Human.js from `gaze/human/human.esm.js` via dynamic import
2. Configures: face detection, face mesh, iris tracking from `gaze/human/models/`
3. Hidden `<video>`, camera via `getUserMedia`
4. Detection loop: `requestVideoFrameCallback` (or `requestAnimationFrame` fallback)
5. Extracts face landmarks: nose, eyes, head rotation (yaw/pitch/roll)
6. Computes head pointer via nose-vs-eye offset relative to calibration
7. **One-Euro filter** smoothing (implements `OneEuroFilter` class)
8. **Adaptive LERP**: slower center (0.06), faster edges (0.10)
9. Blends translation (78%) + rotation (22%)
10. Dispatches `gaze:point` CustomEvent `{ x, y, confidence }` at throttled rate
11. Dispatches `gaze:status` CustomEvent `{ phase, note }`
12. **Blink detection** via Eye Aspect Ratio (EAR)
13. **Mouth-open detection** via mouth aspect ratio
14. Calibration persistence: `chrome.storage.local` keys `headCalV2`, `earCalV2`, `mouthCalV1`
15. Responds to `gazeEnabled` storage changes

**Storage Keys:**
- `gazeEnabled`: Master toggle
- `headCalV2`: `{ cx, cy, left, right, up, down, version:2, ts }`
- `earCalV2`: Eyelid calibration thresholds
- `gazeDwellMs`: Dwell duration
- `mouthClickEnabled`: Mouth click toggle
- `mouthCalV1`: Mouth calibration baseline

### gaze/head-cal.js

5-step guided calibration:
1. Center (look straight)
2. Left (turn left)
3. Right (turn right)
4. Up (look up)
5. Down (look down)

User holds still, presses Space (or long blink ≥1s). Captures nose-vs-eye offset per direction. Shows overlay with instructions and progress. Saves to `headCalV2` in `chrome.storage.local`.

Triggered by `Alt+H` keyboard shortcut or `TRIGGER_CALIBRATION` message.

### gaze/mouth-cal.js

Mouth click calibration:
1. Collects baseline samples (mouth closed) — `MOUTH_CALIBRATION_SAMPLES=30`
2. Asks user to open mouth wide for max sample
3. Computes threshold between baseline and max
4. Saves to `mouthCalV1` in `chrome.storage.local`

Triggered by `TRIGGER_MOUTH_CALIBRATION` message.

### gaze/gaze-dwell.js

Dwell-to-click system:
- Listens for `gaze:point` events
- When pointer dwells on an element for `gazeDwellMs` (default 600ms):
  - Dispatches synthetic `click` event
  - Visual feedback (shrinking circle animation)
- Handles link hovering for summary triggering
- Configurable dwell time via storage

### gaze/gaze-overlay.js

Debug HUD overlay:
- Shows pointer position dot (follows gaze)
- Displays face detection confidence
- Shows calibration status
- Toggle via `Alt+D`
- Uses `gaze-overlay.css` for styling

### gaze/gaze-overlay.css

Styles for debug overlay: pointer dot, status panel, confidence meter, calibration indicators.

### Human.js (vendored)

Located in `gaze/human/`:
- `human.esm.js`: Main library (ESM format)
- `models/`: Pre-downloaded model files for offline face detection, face mesh, iris tracking

All models run locally — no network requests needed.

---

## 25. EXTERNAL DEPENDENCIES

All vendored (no npm/CDN):
- **Readability.js** (`lib/Readability.js`): Mozilla's article extraction library
- **marked.js** (`lib/marked.js`): Markdown parser
- **Human.js** (`gaze/human/`): Face detection/tracking library with models
- **OpenDyslexic** (`fonts/`): Accessibility font (Regular, Bold, Italic, Bold-Italic in .otf/.woff/.woff2/.eot)

---

## 26. CRITICAL IMPLEMENTATION NOTES

### AI API Access
- Content scripts CANNOT access `self.ai` or `LanguageModel` — they run in isolated world
- All AI calls must go: content script → `chrome.runtime.sendMessage` → background.js → create session → return result
- Background.js has full access to `LanguageModel` and `Summarizer` globals

### Streaming Behavior
- `promptStreaming()` returns chunks where each chunk is the FULL accumulated text (not a delta)
- So in the streaming loop: `result = chunk.trim()` (replaces, not appends)

### Extension Context Invalidation
- When extension reloads, old content scripts lose their connection
- All `chrome.runtime.sendMessage` calls in content scripts must be wrapped in try/catch
- Check `chrome.runtime?.id` before sending
- Fire-and-forget messages must NOT pass a callback (prevents "message port closed" warning)

### Chrome Flags Required
Users must enable these flags for AI features:
- `chrome://flags/#prompt-api-for-gemini-nano`
- `chrome://flags/#summarization-api-for-gemini-nano`
- `chrome://flags/#optimization-guide-on-device-model`

### Storage Split
- `chrome.storage.sync`: Visual preferences (font, theme, spacing, reading level, optimize mode, hover)
- `chrome.storage.local`: AI settings (apiChoice, customPrompt, displayMode), gaze settings (gazeEnabled, gazeDwellMs, mouthClickEnabled), calibration data (headCalV2, earCalV2, mouthCalV1)

### Caching Strategy
- HTML cache: Simple object, no TTL
- Summary cache: Map with 30-minute TTL, keyed by `${url}_${apiChoice}_${customPrompt}`
- YouTube caches: Maps with 30-minute TTL
- Twitter thread cache: Map with 5-minute TTL
- Periodic cleanup every 5 minutes

### Twitter Content Extraction Pipeline (priority order)
1. Check GraphQL cache (from interceptor)
2. Extract from DOM (expand thread, collect articles)
3. Background tab scrape (open hidden tab, inject script, extract)

### YouTube Caption Pipeline
1. Content bridge injects caption handler into page context
2. Handler intercepts XHR for `timedtext`/`caption` URLs
3. Parses JSON3 or XML format
4. Caches in page context
5. Bridge relays via postMessage to content script
6. Content script relays to background via chrome.runtime.sendMessage
7. Background builds summarization input (description + transcript)
8. Background summarizes and streams result back

### Text Simplification Pipeline
1. Side panel sends `simplifyActiveTab` to background
2. Background relays `simplify` to active tab's content script
3. Content script extracts page content, chunks into ~800 token groups
4. Each chunk sent to background via `simplifyText` message
5. Background creates LanguageModel session with system prompt
6. Streams result back to content script
7. Content script replaces DOM elements with simplified versions
8. Stores original text for hover-to-show-original feature

### Job Management
- Only one page summarization job active at a time
- Only one YouTube summarization job active at a time
- New requests abort existing jobs for different URLs
- Same-URL requests return "duplicate" status
- AbortController used for cancellation propagation
- Sessions always destroyed in `finally` blocks

---

## END OF REBUILD PROMPT

This prompt covers every file, function, constant, message type, storage key, and behavioral detail needed to rebuild Mango with 100% functional parity. Follow each specification exactly.
