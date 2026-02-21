# Mollitiam

> *Latin for "resilience"* — Accessibility, AI summarization, and hands-free browsing in one Chrome extension.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-0D9488?style=flat-square&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-134E4A?style=flat-square)
![On-Device AI](https://img.shields.io/badge/AI-On--Device-2DD4BF?style=flat-square)

## Features

### AI Text Simplification
- Rewrites page content at adjustable reading levels (Mild → Strong)
- Three optimization modes: Text Clarity, Focus & Structure, Word Patterns
- All AI runs **on-device** via Chrome's built-in Gemini Nano — no API keys needed

### Hover-to-Summarize Link Previews
- Hover any link for an AI-powered summary
- Specialized pipelines for **YouTube** (captions), **Twitter/X** (threads), and **Reddit** (posts + comments)
- Supports both tooltip and side panel display modes

### Visual Accessibility
- **OpenDyslexic font** toggle
- **13 color themes** including high contrast, sepia, dark mode, and blue light filters
- **Spacing controls** for line height, letter spacing, and word spacing
- Hover-to-show-original text after simplification

### Hands-Free Head Tracking
- Webcam-based cursor control via face detection (Human.js)
- Dwell-to-click with configurable timing
- Blink detection and mouth-click support
- Guided calibration for head tracking and mouth click
- Debug HUD overlay (Alt+D)

## Installation

### Prerequisites
Enable these Chrome flags for AI features:
1. `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
2. `chrome://flags/#summarization-api-for-gemini-nano` → **Enabled**
3. `chrome://flags/#optimization-guide-on-device-model` → **Enabled**

### Vendored Dependencies
Download and place the following files (gitignored due to size):

| File | Location | Source |
|------|----------|--------|
| Readability.js | `lib/Readability.js` | [Mozilla Readability](https://github.com/nicephil/nicephil.github.io) |
| marked.js | `lib/marked.js` | [markedjs/marked](https://github.com/markedjs/marked) |
| Human.js | `gaze/human/human.esm.js` | [vladmandic/human](https://github.com/vladmandic/human) |
| Human.js models | `gaze/human/models/` | Included with Human.js |
| OpenDyslexic | `fonts/` | [OpenDyslexic](https://opendyslexic.org/) |

### Load Extension
1. Clone the repo
2. Download vendored dependencies (see above)
3. Open `chrome://extensions/`
4. Enable **Developer mode**
5. Click **Load unpacked** → select the project folder

## Architecture

```
SIDE PANEL (sidepanel.html/css/js)
    ↕ chrome.runtime.sendMessage
BACKGROUND SERVICE WORKER (background.js)
    ↕ chrome.tabs.sendMessage
CONTENT SCRIPTS (content/*.js, gaze/*.js, youtube/*.js)
```

**Critical**: `LanguageModel`/`self.ai` is NOT available in content scripts (isolated world). All AI calls route through `background.js`.

## Project Structure

```
mollitiam/
├── manifest.json
├── background.js              # Service worker — AI, caching, jobs, message routing
├── sidepanel.html/css/js      # Three-tab side panel UI
├── config/
│   ├── config.js              # Simplification levels config
│   ├── themes.js              # 13 color themes
│   └── system-prompts.js      # 3 modes × 5 levels = 15 AI prompts
├── utils/
│   ├── markdown-formatter.js  # AI output → HTML
│   └── logger.js              # Extension logger
├── content/
│   ├── accessibility.js       # Font, themes, spacing, hover
│   ├── text-simplification.js # Page content chunking and AI rewrite
│   ├── link-summarization.js  # Hover previews, tooltip, platform handlers
│   ├── content-main.js        # Message router
│   └── content.css            # Content injection styles
├── youtube/
│   ├── youtube-caption-handler.js   # Page-context XHR intercept
│   ├── youtube-content-bridge.js    # Content ↔ page bridge
│   ├── youtube-inject-page.js       # Test utility
│   ├── youtube-methods.js           # Shared YouTube utilities
│   └── youtube-test-injector.js     # Injector script
├── twitter/
│   └── twitter-interceptor.js       # GraphQL response capture
├── gaze/
│   ├── gaze-core.js           # Face detection, head pointer, One-Euro filter
│   ├── head-cal.js            # 5-step head calibration
│   ├── mouth-cal.js           # Mouth click calibration
│   ├── gaze-dwell.js          # Dwell-to-click system
│   ├── gaze-overlay.js        # Debug HUD
│   ├── gaze-overlay.css       # Debug HUD styles
│   └── human/                 # Vendored Human.js (gitignored)
├── fonts/                     # OpenDyslexic font files (gitignored)
├── lib/                       # Readability.js, marked.js (gitignored)
└── icons/                     # Extension icons
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt + H` | Start head calibration |
| `Alt + B` | Toggle blink-to-click |
| `Alt + G` | Toggle gaze tracking |
| `Alt + D` | Toggle debug HUD |

## Storage

| Area | Keys |
|------|------|
| `chrome.storage.sync` | Font, theme, spacing, reading level, optimize mode, hover |
| `chrome.storage.local` | API choice, custom prompt, display mode, gaze settings, calibration data |

## License

MIT
