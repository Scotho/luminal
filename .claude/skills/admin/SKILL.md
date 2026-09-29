---
name: admin:luminal
description: Start the local admin dashboard for Luminal. Launches the Vite dev server on port 5175 serving the admin/ app for Firebase stats, user monitoring, and admin actions.
user_invocable: true
---

# Admin Dashboard

Start the local-only admin dashboard for Luminal.

## Server

| Server | Port | Purpose |
|--------|------|---------|
| Admin Dashboard | 5175 | Firebase stats, monitoring, purge actions |

## Steps

1. Check if port 5175 is already in use:
   ```bash
   npx kill-port 5175 2>/dev/null || true
   ```

2. Start the admin dashboard:
   ```bash
   npx vite --config admin/vite.config.ts --port 5175 --strictPort &
   ```

3. Report the URL to the user:
   - **Admin Dashboard**: http://localhost:5175

## Notes

- The admin dashboard is a separate Vite app living in `admin/` — it is NOT part of the game build.
- Requires Firebase authentication — sign in with Google when prompted.
- Sections: Live Status (real-time), Users, Matches, Playtime (on-demand with snapshots), Bug Reports (live), Admin Actions (purge).
- Snapshot data is persisted to `admin/data/` (gitignored).
- If the dev-server skill is also running, there is no conflict — game uses 5173/5174, admin uses 5175.
