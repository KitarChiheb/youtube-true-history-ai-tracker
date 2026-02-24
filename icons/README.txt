Add three square PNG icons before publishing:
- icon16.png — 16×16 for the toolbar
- icon48.png — 48×48 for extension lists
- icon128.png — 128×128 for Chrome Web Store preview

Place them in this folder and update manifest.json:
{
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}

Use flat backgrounds so the badge-style popup header matches Chrome's dark toolbar.
