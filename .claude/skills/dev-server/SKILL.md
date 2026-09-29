---
name: dev-server:luminal
description: Start local dev servers and Firebase emulators for the Tron project. Health-checks all ports, starts only what's missing, ensures emulators are always running.
user_invocable: true
---

# Dev Server

Start and ensure all local development infrastructure is running. Idempotent — safe to run repeatedly.

## Infrastructure

| Service | Port | Alias | Purpose |
|---------|------|-------|---------|
| Firebase Auth | 9099 | — | Auth emulator |
| Firebase RTDB | 9000 | — | Realtime Database emulator |
| Firebase Firestore | 8080 | — | Firestore emulator |
| Vite HMR | 5173 | http://hot | Live dev with hot reload |
| Static Preview | 5174 | http://cold | No auto-refresh — stable viewing while agents edit |
| Admin Dashboard | 5175 | http://admin | Started separately via /admin |
| Hostname Proxy | 80 | — | Routes hot/cold/admin aliases |

## Steps

### 1. Health check — probe all managed ports

Run this to see what's already up:
```bash
for port in 9099 9000 8080 5173 5174; do
  (echo >/dev/tcp/localhost/$port) 2>/dev/null && echo "UP   :$port" || echo "DOWN :$port"
done
```

Record which ports are UP and which are DOWN. Only start services whose ports are DOWN.

### 2. Firebase emulators (ports 9099, 9000, 8080)

**If all three emulator ports are UP** → skip this step entirely.

**If ANY emulator port is DOWN** → kill all three and start fresh (emulators must start together):
```bash
npx kill-port 9099 9000 8080 2>/dev/null; echo "Emulator ports cleared"
```

Then start emulators in the background:
```bash
npx firebase emulators:start --only auth,database,firestore --project luminal-game &
```

Wait for readiness by polling the Auth port (last to come up):
```bash
for i in $(seq 1 30); do
  (echo >/dev/tcp/localhost/9099) 2>/dev/null && echo "Emulators ready" && break
  [ "$i" -eq 30 ] && echo "ERROR: Emulators failed to start within 30s"
  sleep 1
done
```

### 3. Vite HMR (port 5173)

**If port 5173 is UP** → skip.

**If DOWN** → start the Vite dev server:
```bash
npx kill-port 5173 2>/dev/null
npx vite --port 5173 --strictPort &
```

### 4. Static preview (port 5174)

**If port 5174 is UP** → skip.

**If DOWN** → build and serve:
```bash
npx kill-port 5174 2>/dev/null
npm run build:local && npx vite preview --port 5174 --strictPort &
```

### 5. Hostname proxy (port 80)

Only start if not already running. Requires admin privileges on Windows.
```bash
PROXY_PORT=80 node scripts/local-proxy.js &
```

If port 80 is unavailable, skip the proxy and tell the user to use `localhost:PORT` URLs directly.

### 6. Report status

Print a summary table showing each service and whether it was already running (kept) or just started:

```
Service             Port   Status
─────────────────────────────────
Firebase Auth       9099   ✓ running
Firebase RTDB       9000   ✓ running
Firebase Firestore  8080   ✓ started
Vite HMR            5173   ✓ running
Static Preview      5174   ✓ started
```

Include access URLs:
- `localhost:5173` — Vite HMR
- `localhost:5174` — Static preview
- `localhost:5175` — Admin (if running)
- `http://hot` / `http://cold` / `http://admin` — if proxy is active

## First-Time Setup

The user must add these lines to `C:\Windows\System32\drivers\etc\hosts` (run editor as admin):
```
127.0.0.1  hot
127.0.0.1  cold
127.0.0.1  admin
```
This only needs to be done once.

## Notes

- The static preview serves the last `npm run build:local` output. It does NOT update when source files change — that's the point.
- To refresh the static preview after code changes, re-run `npm run build:local` (the preview server picks up the new output automatically).
- Hosted deploys must use `npm run build:test` or `npm run build:live`. This skill's static preview is intentionally the local build channel.
- Use `--strictPort` so servers fail loudly instead of silently picking a different port.
- Firebase emulators are all-or-nothing: if any one is down, restart all three together.
- The proxy cannot use port 8080 — that's the Firestore emulator. Use port 80 (default) or set `PROXY_PORT`.
- `scripts/local-stack.ts` is a unified alternative that starts emulators + relay + Vite in one process tree. This skill is for when you want finer control or already have some services running.
