# YT True History

YT True History is a Manifest V3 Chrome extension that records only the YouTube videos you intentionally watched, stores them locally in `chrome.storage`, and uses OpenRouter AI to categorize content plus generate a weekly "Watch Intelligence" report.

## Why this exists
YouTube's built-in history is noisy: autoplay videos, quick scrolls, repeated replays, and algorithm hiccups all mix together. This extension filters all that out by tracking only real watches (≥40% completion or ≥5 minutes — configurable) and keeping a private local record you can search, filter, and export.

## Features at a glance
- Content script that measures true watch time, ignores hidden-tab seconds, and flags autoplay events.
- Storage layer with import/export, retention policies, and stats helpers.
- Background service worker that queues AI categorization through OpenRouter (with rate limiting and graceful fallback).
- Popup summarizing tracking status, AI key health, and the 5 most recent intentional watches.
- Dashboard with filters, category sidebar, stats, AI report panel, and settings (including OpenRouter key management).
- Weekly AI report that summarizes your last 7 days of intentional viewing into English prose.

## Installation (Developer Mode)
1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome/Chromium.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `yt-true-history` folder.
5. The extension should appear with the popup accessible from the toolbar.

## File structure
```
yt-true-history/
├── manifest.json              # MV3 manifest wiring popup, content script, service worker
├── .env.example               # Reference for your OpenRouter key (UI handles actual storage)
├── background/
│   └── service-worker.js      # Storage + AI orchestration, message routing, retention
├── content/
│   └── tracker.js             # Runs on youtube.com/watch, tracks intentional watches
├── popup/
│   ├── popup.html             # Popup markup (tracking toggle, stats, recent videos)
│   ├── popup.js               # Popup logic with storage helpers
│   └── popup.css              # Popup styling with CSS custom properties
├── dashboard/
│   ├── dashboard.html         # Full dashboard layout (filters, stats, settings)
│   ├── dashboard.js           # UI interactions, import/export, AI panel, settings
│   └── dashboard.css          # Dashboard theming, grids, charts, report panel
├── utils/
│   ├── storage.js             # chrome.storage abstraction + stats/import/export helpers
│   ├── ai.js                  # OpenRouter calls (categorization + weekly report)
│   └── helpers.js             # Pure utilities (formatting, groupings, CSV, colors)
├── icons/
│   └── README.txt             # Instructions for adding 16/48/128px icons
└── README.md                  # YOU ARE HERE
```

## Watch detection algorithm
1. Content script runs on `youtube.com/watch` pages only.
2. It waits for the `<video>` player, then checks `currentTime` vs `duration` every second.
3. Watch is recorded only if either threshold is met:
   - ≥ 40% of the video watched (configurable)
   - or ≥ 5 minutes watched (configurable)
4. Autoplay is detected when playback begins without a user gesture within 2 seconds.
5. Page Visibility API ensures hidden-tab time is excluded if the user disables it in settings.
6. When qualified, the script sends a message with video metadata + progress to the service worker.

## AI categorization flow
1. Service worker saves the video immediately (optimistic UI), then enqueues AI categorization if the user enabled AI features and provided an OpenRouter key.
2. Queue processes sequentially with a 1-second delay between requests to respect free-tier limits.
3. Primary model: `mistralai/mistral-nemo`; fallback: `google/gemma-3-12b-it` (both require BYOK/paid access).
4. AI receives a strict prompt that returns JSON `{ category, confidence }`. Parsing is wrapped in try/catch.
5. Results are written back to storage; UI updates automatically when reading from storage.
6. Weekly report uses the same API but with a narrative prompt summarizing the last 7 days of history.

## OpenRouter API key
- Generate a free key at [openrouter.ai/keys](https://openrouter.ai/keys).
- The key is stored only via the Settings panel → `settings.openRouterApiKey` in `chrome.storage.local`.
- `.env.example` is informational; the extension does **not** read `.env` files. It's there so developers remember which key to create.
- Every network call includes the required headers:
  - `HTTP-Referer: chrome-extension://<extension-id>`
  - `X-Title: YT True History`

## Customizing watch thresholds
1. Open the dashboard (from popup or `chrome://extensions` → "Details" → "Extension options").
2. In the Settings panel, adjust:
   - Minimum watch percent (10–80%).
   - Minimum watch time in minutes.
   - Whether autoplay videos count.
   - Whether hidden-tab time counts.
3. Save settings; the content script picks them up via message passing.

## Known limitations
- Free OpenRouter tiers have per-minute request caps, so categorization may lag if you binge videos quickly.
- AI responses can occasionally be malformed JSON; we fall back to "Uncategorized" if parsing fails.
- Weekly report requires an API key and AI features enabled.
- Chrome storage quota (4MB) may fill up after thousands of entries; export/delete if you hit warnings.
- The extension currently focuses on desktop YouTube; mobile/responsive layouts may need polish.

