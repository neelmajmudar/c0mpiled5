# Mango Chrome Extension — Complete Rebuild Prompt (Part 1 of 3)

You are building a Chrome Manifest V3 extension called **Mango** from scratch. This prompt contains every specification needed to rebuild the extension with perfect functional parity. Follow every detail exactly.

---

## 1. OVERVIEW & ARCHITECTURE

Mango is a Chrome extension combining:
- **AI text simplification** (rewrites page content at adjustable reading levels)
- **Hover-to-summarize link previews** (specialized pipelines for YouTube, Twitter/X, Reddit)
- **Visual accessibility** (OpenDyslexic font, 13 color themes, spacing controls)
- **Hands-free head tracking** (webcam cursor, dwell-to-click, blink detection, mouth click)

All AI runs on-device via Chrome's Summarization API and Language Model API (Gemini Nano). No API keys.

### Three Execution Contexts

```
SIDE PANEL (sidepanel.html/css/js)
    ↕ chrome.runtime.sendMessage
BACKGROUND SERVICE WORKER (background.js)
    ↕ chrome.tabs.sendMessage
CONTENT SCRIPTS (content/*.js, gaze/*.js, youtube/*.js)
```

**Critical**: `LanguageModel`/`self.ai` is NOT available in content scripts (isolated world). All AI calls route through background.js.

---

## 2. manifest.json

```json
{
  "manifest_version": 3,
  "name": "Mango",
  "version": "1.0",
  "description": "Accessibility, AI summarization, and hands-free browsing — all in one",
  "icons": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" },
  "permissions": ["sidePanel", "storage", "tabs", "scripting", "activeTab", "webNavigation"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["lib/Readability.js", "lib/marked.js", "config/config.js", "config/themes.js", "utils/markdown-formatter.js", "content/accessibility.js", "content/text-simplification.js", "content/link-summarization.js", "content/content-main.js"],
      "css": ["content/content.css"],
      "run_at": "document_idle"
    },
    { "matches": ["*://*.youtube.com/*"], "js": ["youtube/youtube-content-bridge.js"], "run_at": "document_start", "all_frames": false },
    {
      "matches": ["<all_urls>"],
      "js": ["gaze/gaze-core.js", "gaze/head-cal.js", "gaze/mouth-cal.js", "gaze/gaze-dwell.js", "gaze/gaze-overlay.js"],
      "run_at": "document_idle"
    }
  ],
  "side_panel": { "default_path": "sidepanel.html" },
  "action": { "default_title": "Open Mango", "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" } },
  "web_accessible_resources": [
    { "resources": ["lib/Readability.js", "youtube/youtube-inject-page.js", "youtube/youtube-caption-handler.js", "twitter/twitter-interceptor.js", "fonts/*", "config/config.js"], "matches": ["<all_urls>"] },
    { "resources": ["gaze/gaze-overlay.css", "gaze/human/human.esm.js", "gaze/human/models/*"], "matches": ["<all_urls>"] }
  ]
}
```

---

## 3. CONFIG FILES

### config/config.js
```js
const simplificationLevelsConfig = { levels: 3 };
```

### config/themes.js
Object `themes` with 13 entries. Each has `backgroundColor` and `textColor`:
- `default`: `''`, `''`
- `highContrast`: `#FFFFFF`, `#000000`
- `highContrastAlt`: `#000000`, `#FFFFFF`
- `darkMode`: `#121212`, `#E0E0E0`
- `sepia`: `#F5E9D5`, `#5B4636`
- `lowBlueLight`: `#FFF8E1`, `#2E2E2E`
- `softPastelBlue`: `#E3F2FD`, `#0D47A1`
- `softPastelGreen`: `#F1FFF0`, `#00695C`
- `creamPaper`: `#FFFFF0`, `#333333`
- `grayScale`: `#F5F5F5`, `#424242`
- `blueLightFilter`: `#FFF3E0`, `#4E342E`
- `highContrastYellowBlack`: `#000000`, `#FFFF00`
- `highContrastBlackYellow`: `#FFFF00`, `#000000`

### config/system-prompts.js
Object `systemPrompts` with 3 modes × 5 levels = 15 prompts.

**Modes:** `textClarity`, `focusStructure`, `wordPattern`. **Levels:** `"1"` through `"5"` (string keys).

Key patterns per mode:
- **textClarity**: General readability. L1 keeps sophisticated elements; L5 targets 5-year-old.
- **focusStructure**: ADHD. Visual breaks, bullet points, one idea per paragraph.
- **wordPattern**: Dyslexia. Consistent sentence patterns, predictable structure.

All end with "Keep all names, places, and quotes unchanged." L5 prompts include "Keep sentences under 8 words."

Full text for each prompt:
```js
const systemPrompts = {
    "textClarity": {
        "1": "You are helping a reader by simplifying complex text and improving readability. Rewrite text to enhance readability while keeping sophisticated elements. Focus on clearer organization and structure. Break down complex sentences when needed. Keep all proper names, places, and quotes unchanged.",
        "2": "You are helping a reader with learning disabilities. Rewrite text using clearer structure and simpler explanations. Replace complex terms with everyday words where possible. Use shorter sentences and clear organization. Keep all names, places, and quotes unchanged.",
        "3": "You are helping a reader with learning disabilities. Rewrite using simple, everyday language and short sentences. Break down complex ideas into smaller, clearer parts. Use familiar words while keeping important details. Keep all names, places, and quotes unchanged.",
        "4": "You are helping a reader with learning disabilities. Rewrite to be very, very easy to understand. Use basic words and simple sentences. Break each complex idea into multiple short sentences. Add brief explanations in brackets for difficult concepts. Keep all names, places, and quotes unchanged.",
        "5": "You are helping a 5-year-old reader with learning disabilities. Rewrite in the simplest possible way. Use only basic, everyday words. Keep sentences under 8 words. Add step-by-step explanations for complex ideas. Include definitions for any unusual terms. Keep all names, places, and quotes unchanged."
    },
    "focusStructure": {
        "1": "You are helping readers with ADHD by organizing content with better visual breaks and highlights. Rewrite text with clear visual structure and frequent paragraph breaks. Organize information in a way that maintains focus. Add emphasis to key points. Keep all names, places, and quotes unchanged.",
        "2": "You are helping readers with ADHD and attention challenges. Rewrite using distinct sections and clear headings. Break information into smaller, focused chunks. Use clear language and highlight important points. Keep all names, places, and quotes unchanged.",
        "3": "You are helping readers with ADHD and attention challenges. Rewrite using short paragraphs and bullet points. Keep one main idea per paragraph. Use simple language and highlight key information. Keep sentences focused and direct. Keep all names, places, and quotes unchanged.",
        "4": "You are helping readers with ADHD and attention challenges. Rewrite using very short, focused paragraphs. Create bullet points for lists. Keep sentences short and direct. Add visual markers between different ideas. Highlight important information. Keep all names, places, and quotes unchanged.",
        "5": "You are helping a 5-year-old reader with ADHD and attention challenges. Rewrite with maximum structure and focus. Use single-idea paragraphs with frequent breaks. Create bullet points for all lists. Keep sentences under 8 words. Add clear markers between topics. Keep all names, places, and quotes unchanged."
    },
    "wordPattern": {
        "1": "You are helping readers by using consistent layouts and clearer word spacing. Rewrite text using clear sentence structures and patterns. Keep sophisticated vocabulary but improve readability. Add subtle reading aids through formatting. Keep all names, places, and quotes unchanged.",
        "2": "You are helping readers with dyslexia and processing challenges. Rewrite using consistent sentence patterns. Replace difficult words with clearer ones. Break multi-part ideas into separate sentences. Add helpful context. Keep all names, places, and quotes unchanged.",
        "3": "You are helping readers with dyslexia and processing challenges. Rewrite using simple, predictable patterns. Keep sentences short and direct. Use familiar words and explain complex terms. Break down complicated ideas. Keep all names, places, and quotes unchanged.",
        "4": "You are helping readers with dyslexia and processing challenges. Rewrite using basic patterns and simple words. Keep sentences very short and similar in structure. Break every complex idea into multiple simple sentences. Add clear explanations. Keep all names, places, and quotes unchanged.",
        "5": "You are helping a 5-year-old with dyslexia and processing challenges. Rewrite using the most basic sentence patterns. Use only common, everyday words. Keep sentences under 8 words and similarly structured. Break every idea into tiny steps. Add simple explanations for unusual terms. Keep all names, places, and quotes unchanged."
    }
};
```

---

## 4. UTILS

### utils/markdown-formatter.js
Single function `formatAISummary(text)` converting markdown → HTML. Steps in order:
1. HTML-escape `&`, `<`, `>`
2. Headings: `### `→`<h4>`, `## `→`<h3>`, `# `→`<h2>` (line-start)
3. Bold: `**text**`/`__text__` → `<strong>`
4. Italic: `*text*`/`_text_` → `<em>` (text must not start/end with whitespace)
5. Unordered list items: `* `/`- `/`• ` → `<li>`
6. Ordered list items: `\d+. ` → `<li>`
7. Consecutive `<li>` wrapped in `<ul>`
8. Double newlines → `</p><p>`
9. Single newlines → `<br>`
10. Wrap in `<p>` if needed, close with `</p>` if needed
11. Remove empty `<p></p>`, clean `<p>` around block elements

### utils/logger.js
Object `logger` with `logs` array, `lastWrite` timestamp, `writeInterval=5000`. Methods: `log()`, `error()`, `_scheduleWrite()`, `_writeLogs()` (sends to background via `chrome.runtime.sendMessage({ action: "storeLogs" })`).

---

## 5. background.js — AI INITIALIZATION & SETTINGS

Uses `importScripts('config/system-prompts.js', 'config/config.js', 'utils/markdown-formatter.js')`.

### API Initialization
`initializeSummarizerAPI()` returns object with:
- `summarizer`: Checks `Summarizer` global or `self.ai.summarizer`. Has `available`, `availability()`, `create()`.
- `promptAPI`: Checks `LanguageModel` global. Has `available`, `availability()` (calls `LanguageModel.availability()`), `create()`, `params()`.

`SummarizerAPI` global state initialized via `createInitialApiState()`. `initAPIs()` merges API results, checks actual availability. `apiInitializationPromise = initAPIs()` — all handlers await this.

### Settings
Global: `{ apiChoice: 'summarization', customPrompt: 'Summarize this article in 2-3 sentences', displayMode: 'tooltip' }`. Loaded from `chrome.storage.local`, updated via `onChanged` listener.

---

## 6. background.js — CACHING & JOB MANAGEMENT

**Caches:** `htmlCache` (object), `summaryCache` (Map), `youtubeCaptionCache`, `youtubeSummaryCache`, `youtubeDescriptionCache`, `twitterThreadCache` (all Maps).

**Constants:** `CACHE_DURATION=30min`, `TWITTER_THREAD_TTL=5min`. Periodic cleanup every 5min.

**Job system:** `summarizationJobs` Map, `youtubeJobsByVideoId` Map, counters for `activePageJobId`/`activeYouTubeJobId`.

Job object: `{ id, url, tabId, feature, metadata, controller: new AbortController(), signal, session, sessionType, createdAt }`.

Functions: `createSummarizationJob()`, `registerJobSession()`, `destroyJobSession()` (calls `session.destroy()`), `finalizeJob()`, `abortJob()`, `getJob()`.

---

## 7. background.js — AI SUMMARIZATION

**`summarizeContent({ job, text, url })`**: Routes to Summarization API or Prompt API based on settings.

**`useSummarizationAPI()`**: Creates summarizer with `{ type:'key-points', format:'markdown', length:'medium', sharedContext:'This is an article from a webpage.', outputLanguage:'en' }`. Truncates to 4000 chars (start/middle/end sampling: `partSize=floor(4000/3)`). Streams via `summarizeStreaming()`, broadcasts every 150ms. Checks abort between chunks.

**`usePromptAPI()`**: Creates session with `{ expectedOutputs:[{type:'text',languages:['en']}], signal }`. Truncates to 3000 chars. Prompt: `"${customPrompt}\n\nContent:\n${text}"`. Streams via `promptStreaming()`.

**`broadcastStreamingUpdate()`**: Formats via `formatAISummary()`, sends `STREAMING_UPDATE` to sidepanel and content tab.

**IMPORTANT**: In `simplifyText` handler, each chunk from `promptStreaming()` is the FULL text so far (not delta). So `result = chunk.trim()` replaces, not appends.

---

## 8. background.js — PLATFORM-SPECIFIC HANDLERS

### Twitter
`handleTwitterBackgroundScrape()`: Checks cache → opens hidden tab → `waitForTabComplete(18s)` → `captureTwitterThreadInTab()` (3 message attempts, then `chrome.scripting.executeScript` fallback that scrolls/expands/extracts articles) → caches → closes tab.

### Reddit
`buildRedditApiUrl()`: Handles `reddit.com`, `old.reddit.com`, `redd.it`. Appends `.json?limit=40&depth=2&raw_json=1`.
`extractRedditThread()`: Extracts post (title, selftext≤1500chars, subreddit, author, score) + top 5 comments (by score, ≤600chars each).
`buildRedditSummaryInput()`: Structured prompt focusing on "main viewpoints, consensus, and disagreements."

### YouTube
`parseCaptionData()`: JSON3 (events+segs), XML (<text>), plain JSON.
`fetchYouTubeDescription()`: Parses `ytInitialPlayerResponse` or `<meta>` tags.
`buildYouTubeSummarizationInput()`: Combines videoId + description(≤1000) + transcript into ≤4000 chars with `clipTranscript()` (start/middle/end sampling).
`handleYouTubeSummary()`: Deduplicates → checks cache → creates job → fetches description → requests captions (6 retries) → builds input → summarizes → caches.

### Content Summarization
`handleSummarizeContent()`: Deduplicates → aborts old → checks cache (key=`${url}_${apiChoice}_${customPrompt}`) → creates job → summarizes → caches → finalizes.

---

## 9. background.js — MESSAGE HANDLERS

Single `chrome.runtime.onMessage.addListener`. All return `true` for async.

| Message | Handler |
|---|---|
| `action:'getSystemPrompts'` | Returns `{ success:true, prompts:systemPrompts }` |
| `action:'simplifyText'` | Creates LanguageModel session with `message.systemPrompt`, streams `message.text`, returns `{ success, simplifiedText }` |
| `action:'checkPromptAPI'` | Checks availability, returns `{ available, status }` |
| `action:'simplifyActiveTab'` | Relays `{ action:'simplify' }` to active tab |
| `action:'relayToActiveTab'` | Relays `message.payload` to active tab |
| `type:'SCRAPE_TWITTER_THREAD'` | `handleTwitterBackgroundScrape()` |
| `type:'SUMMARIZE_CONTENT'` | `handleSummarizeContent()` |
| `type:'SUMMARIZE_REDDIT_POST'` | `handleSummarizeRedditPost()` |
| `type:'GET_API_STATUS'` | Returns both API statuses |
| `type:'GET_SETTINGS'` | Returns settings |
| `type:'FETCH_CONTENT'` | Fetches URL HTML, caches |
| `action:'FETCH_YOUTUBE_CAPTIONS'` | Fetches caption URL |
| `action:'ABORT_YOUTUBE_SUMMARY'` | Aborts YouTube job |
| `action:'GET_YOUTUBE_SUMMARY'` | `handleYouTubeSummary()` |
| `type:'GAZE_STATUS'` | Relays to sidepanel |

### Extension Lifecycle
- `onInstalled`: Logs, removes legacy `readingLevel` key
- `action.onClicked`: Opens side panel via `chrome.sidePanel.open({ windowId })`

---

*Continue to Part 2 for content scripts, sidepanel, YouTube, Twitter, and gaze module specifications.*
