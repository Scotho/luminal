---
name: deploy:luminal
description: Deploy to Firebase with auto-detection of changed targets. Use for versioned releases (/deploy v1.0.8 "note"), hotfixes (/deploy live), rules-only (/deploy rules), functions-only (/deploy functions), test-only (/deploy test), or dry-run checks (/deploy check).
---

> **Convention:** Follow the ref system in `.claude/skills/_conventions/ref-system.md`. Deploy notes should reference shipped TASK/BUG refs.

# Deploy

Deploy the Luminal game to Firebase. Auto-detects which targets changed and deploys them.

## Usage

| Command | What it does |
|---------|-------------|
| `/deploy` | Auto-detect changes, show targets, deploy after confirmation |
| `/deploy v1.0.8 "Feature X" "Fix Y"` | Versioned release via `scripts/deploy.js` |
| `/deploy live` | Hotfix: build + deploy hosting to luminal-game only |
| `/deploy test` | Build + deploy hosting to luminal-test only |
| `/deploy rules` | Deploy database.rules.json + firestore.rules only |
| `/deploy functions` | Deploy Cloud Functions only |
| `/deploy check` | Dry-run: show what changed, validate rules, don't deploy |

## Step 1: Pre-Deploy Checks (always run first)

Run ALL THREE in sequence. If any fails, STOP and fix before continuing.

```bash
npx tsc --noEmit
npx vitest run
npx eslint src/ --max-warnings 350
```

## Step 2: Auto-Detection (for `/deploy` with no explicit target)

Detect which Firebase targets have uncommitted changes:

```bash
git diff --name-only HEAD
```

Map changed files to deploy targets:

| Changed file pattern | Target | Deploy command |
|---------------------|--------|---------------|
| `database.rules.json` | RTDB rules | `firebase deploy --only database --project luminal-game` |
| `firestore.rules` or `firestore.indexes.json` | Firestore | `firebase deploy --only firestore --project luminal-game` |
| `functions/src/**` or `functions/package.json` | Functions | `firebase deploy --only functions --project luminal-game` |
| `src/**`, `index.html`, `public/**`, `music/**`, `vite.config.ts`, `scripts/build.mjs`, `scripts/verify-hosted-build.mjs` | Hosting | Build the matching hosted target, then deploy that site |

Present the detected targets to the user and get confirmation before proceeding.

## Step 3: Deploy by Target

### Versioned Release (`/deploy v1.0.8 "note" "note"`)

Delegate entirely to the deploy script:
```bash
node scripts/deploy.js v1.0.8 "Feature X" "Fix Y"
```
This handles: version bump, changelog, tests, lint, `build:test`, test hosting deploy, `build:live`, live hosting deploy, RTDB version write, git commit, **Discord release notes notification**. Skip all other steps — the script does everything.

### Hosting (`/deploy`, `/deploy live`, `/deploy test`)

Use the explicit hosted build that matches the target:

- `/deploy live`
  ```bash
  npm run build:live
  firebase deploy --only hosting:luminal-game --project luminal-game
  ```
- `/deploy test`
  ```bash
  npm run build:test
  firebase deploy --only hosting:luminal-test --project luminal-game
  ```
- `/deploy` (auto, both sites)
  ```bash
  npm run build:test
  firebase deploy --only hosting:luminal-test --project luminal-game
  npm run build:live
  firebase deploy --only hosting:luminal-game --project luminal-game
  ```

Never use a single shared hosted build output for both sites.

Local-only sandbox/output folders stay out of git and hosted deploys: `testinghub/`, `testhub/`, `testbed/`, `screenshots/`, `test-results/`, `playwright-report/`, `coverage/`.

### Database Rules (`/deploy rules` or auto-detected)

Always dry-run first:
```bash
firebase deploy --only database --project luminal-game --dry-run
```
If dry-run passes, deploy for real:
```bash
firebase deploy --only database --project luminal-game
```
If dry-run fails, show the error and STOP.

### Firestore Rules (`/deploy rules` or auto-detected)

```bash
firebase deploy --only firestore:rules --project luminal-game --dry-run
firebase deploy --only firestore --project luminal-game
```

### Cloud Functions (`/deploy functions` or auto-detected)

This is the slowest target (~15s). Compiles TypeScript, uploads to Cloud Run.
```bash
firebase deploy --only functions --project luminal-game
```

### Dry-Run (`/deploy check`)

Show what would be deployed without deploying:
```bash
git diff --name-only HEAD
firebase deploy --only database --project luminal-game --dry-run
firebase deploy --only firestore:rules --project luminal-game --dry-run
```
Report the list of detected targets and rule validation results.

## Step 4: Post-Deploy

1. Update the environments memory file:
   **File:** `C:\Users\Utilisateur\.claude\projects\C--Projects-tron\memory\reference_environments.md`
   - Update the version and date for whichever environment was deployed to

2. Report what was deployed:
   - Which targets (hosting, rules, functions)
   - Which sites (live, test, both)
   - URLs: https://luminal-game.web.app (live), https://luminal-test.web.app (test)

3. For non-versioned deploys: remind about `git push origin develop` if appropriate

## Discord Notifications

- **Commit history:** A git post-commit hook (`scripts/discord-notify.js commit`) fires automatically on every commit — no action needed.
- **Release notes:** The deploy script (`scripts/deploy.js`) sends a formatted release embed with TL;DR summary + full changelog after a versioned deploy.
- **Config:** Webhook URLs stored in `admin/data/alerts.json` (gitignored).

## Timing Reference

| Step | Time |
|------|------|
| TypeScript check | ~2.5s |
| Tests | ~9.5s |
| Lint | ~6.7s |
| Build (vite) | ~2.5s |
| Database rules deploy | ~4.6s |
| Firestore rules deploy | ~2.8s |
| Functions deploy | ~14.7s |
| Hosting deploy | ~10-15s |

## Environment Reference

| Environment | URL | Firebase Target |
|-------------|-----|-----------------|
| Live | https://luminal-game.web.app | `luminal-game` |
| Test | https://luminal-test.web.app | `luminal-test` |
| Local | http://localhost:5173 | N/A (vite dev) |
