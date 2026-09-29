---
name: inspect-ui:luminal
description: Capture screenshots, computed styles, DOM dumps, and console logs from any game screen using Playwright. Use when debugging visual/layout issues, verifying CSS changes, or running UI test suites.
---

# Inspect UI Tool

Playwright-based visual inspection and UI testing for Luminal. Two tools:

1. **`inspect.js`** — ad-hoc inspection (screenshot a screen, dump styles/DOM)
2. **`ui-tests.js`** — run the full UI test suite or subsets

## When to Use

- **After CSS/layout changes** — screenshot the affected screen to verify
- **Debugging visual issues** — inspect computed styles or DOM for a selector
- **Before committing UI work** — run the relevant test group to catch regressions
- **When the user asks to check a screen** — screenshot it and read the PNG

## Ad-Hoc Inspection

### Screenshot (most common)
```bash
node scripts/inspect.js screenshot <screen> [--viewport <preset>]
```

### Computed Styles
```bash
node scripts/inspect.js styles <screen> "<selector>" [--viewport <preset>]
```

### DOM Dump
```bash
node scripts/inspect.js dom <screen> "<selector>" [--viewport <preset>]
```

### After Capture
1. Use the **Read** tool on the `.png` to view the screenshot
2. If something looks wrong, read the `.log` for console errors
3. For specific elements, use `styles` or `dom` mode

## UI Test Suite

Test manifest lives at `scripts/ui-tests.js`. Add new tests there as screens/features are built.

### Commands
```bash
node scripts/ui-tests.js                     # run all tests
node scripts/ui-tests.js --list              # list all tests and groups
node scripts/ui-tests.js --group menu        # run one group
node scripts/ui-tests.js menu-desktop        # run a single test by ID
node scripts/ui-tests.js social-friends social-chat  # run multiple by ID
```

### Workflow
1. **After modifying a screen** — run its group: `node scripts/ui-tests.js --group settings`
2. **Before deploy or PR** — run all: `node scripts/ui-tests.js`
3. **Investigating a failure** — re-run the single test, then read the screenshot
4. **Adding a new screen/feature** — add entries to `scripts/ui-tests.js`

### Adding Tests
Edit `scripts/ui-tests.js` and add to the `tests` array.

**Simple test** — single screenshot:
```js
{ id: 'screen-variant', group: 'screen', screen: 'screen', viewport: 'desktop', description: 'What this tests' }
```
Optional fields: `preset` (settings only), `tab` (social only).

**Flow test** — multi-step, single browser session:
```js
{ id: 'my-flow', group: 'flows', description: 'What this flow tests', viewport: 'desktop', flow: [
  { action: 'navigate', screen: 'settings' },
  { action: 'capture',  name: 'settings-before' },
  { action: 'preset',   preset: 'ultra' },
  { action: 'capture',  name: 'settings-ultra' },
  { action: 'back' },
  { action: 'capture',  name: 'back-to-menu' },
]}
```

**Flow step types:**
| Action | Fields | Description |
|--------|--------|-------------|
| `navigate` | `screen` | Navigate to a screen from menu |
| `back` | — | Return to main menu |
| `preset` | `preset` | Switch graphics preset (settings) |
| `tab` | `tab` | Switch social tab |
| `capture` | `name` | Take a screenshot |
| `wait` | `ms` | Wait N milliseconds |

## Reference

### Screens
| Screen | Notes |
|--------|-------|
| `menu` | Main menu (default after loading) |
| `settings` | Use `--preset low\|medium\|high\|ultra` |
| `social` | Use `--tab party\|friends\|notifs\|chat` |
| `stats` | My Stats view |
| `leaderboard` | Stats overlay, Leaderboard tab |
| `music` | Music overlay |
| `auth` | Login overlay |

### Viewport Presets
| Preset | Size | Default |
|--------|------|---------|
| `desktop` | 1920x1080 | Yes |
| `phone` | 390x844 | |
| `tablet` | 768x1024 | |
| `landscape` | 844x390 | |

Custom: `--viewport 1440x900`

### Output
Files saved to `screenshots/` (gitignored and excluded from hosted deploys/build verification):
- `<screen>-<viewport>-<timestamp>.png` + `.log`

### Dev Server
Connects to `localhost:5173`. Auto-launches Vite if not running.
