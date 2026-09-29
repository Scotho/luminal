# Luminal

A multiplayer light-cycle arena game that runs in the browser. Ride, leave a trail, don't hit anything.

Play it: **https://luminal-game.web.app**

> ## ⚠️ This project is unfinished
>
> Luminal is an early alpha and I'm putting the source out as-is. Things are half built, some systems are switched
> off, and there are rough edges everywhere. It is **not actively maintained**. I might come back to it, I might
> not. No promises on issues, PRs or support. If something here is useful to you, great, take it and run.
>
> It comes with **no warranty of any kind**. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).

> **Experimental, and a lot of it is outdated.** This project was an experiment, in the game and in how it was
> built. Much of the process in here (the workflows, tooling, agent setup, docs and plans) is out of date and I
> wouldn't do it the same way now. **Use it as a reference**, not as a template or a guide to follow.

## What's in here

- Three vehicles with their own handling: a bike (Spectre), a drift car (Slingshot) and a hoverboard that grinds
  trails (Vector).
- Single player against AI, plus online lobbies and matches.
- Deterministic lockstep netcode, so every client simulates the same match from inputs.
- Replays, spectating, leaderboards, profiles, friends, chat.
- A local admin dashboard I used to run the project (tasks, test runs, sessions). It's very much built for me.

## Tech stack

| | |
|---|---|
| Language | TypeScript (strict), ES modules |
| Rendering | Three.js + pmndrs/postprocessing |
| Build | Vite |
| Backend | Firebase: Auth, Firestore, Realtime Database, Cloud Functions, Hosting, App Check |
| Match transport | Firebase RTDB, or a small Node WebSocket relay (`relay/`) |
| Tests | Vitest + jsdom for unit tests, Playwright for browser tests |
| Lint | ESLint + typescript-eslint |

No UI framework. The UI is HTML partials, CSS and plain TypeScript.

## Rough state of things

Works:

- Core gameplay, all three vehicles, AI opponents
- Online lobbies and lockstep matches
- Replays and spectating
- Around 4,400 unit tests, which pass

Half done or switched off:

- **Progression / unlocks / shop**: partly built, shop is disabled
- **Ranked / MMR**: planned, not started in any real way
- **Monetization**: never happened
- **Mobile**: playable, not polished
- Browser e2e suites: some are stale

Known mess:

- A couple hundred lint warnings
- Some very large files
- Docs under `docs/` are working notes and plans, a lot of them are out of date
- The admin dashboard and `.claude/` skills assume my machine and my workflow

## Getting it running

You need **Node 20**, **Java** (the Firebase emulators need it) and the **Firebase CLI**
(`npm i -g firebase-tools`).

```bash
git clone https://github.com/Scotho/luminal.git
cd luminal
npm install

# the websocket relay (optional, but the local stack expects it)
cd relay && npm install && npm run build && cd ..

cp .env.local.example .env.local

# emulators + relay + vite dev server
npm run local
```

Or just the game with no backend stack: `npm run dev`.

Useful commands:

```bash
npm test            # unit tests
npm run lint
npm run typecheck
npm run build:local # local build
```

Things to know:

- **Use the emulators.** The Firebase config in `src/firebase.ts` points at my project. Web config values are not
  secrets, but the live project is locked down with security rules and App Check, so a local build talking to it
  won't get far. If you want your own hosted copy, make your own Firebase project and swap the config,
  `.firebaserc` and the hosting targets in `firebase.json`.
- **Some audio is missing on purpose.** Most of the soundtrack and the UI sound effects are licensed to me for use
  in the game but not for redistribution, so they are not in this repo. The game skips missing tracks and sounds.
  Drop your own files into `public/music/` and `public/sfx/ui/` if you want them. Details in
  [NOTICE.md](NOTICE.md).
- Setup steps are rough. I haven't run them on a clean machine in a while.

## Where things are

| Path | What |
|---|---|
| `src/core/` | Deterministic simulation and lockstep engine. No rendering in here. |
| `src/net/` | Match transport and protocol |
| `src/modes/` | Game modes: demo, online, replay, spectator |
| `src/ui/` | Menus, lobby, HUD |
| `src/partials/`, `src/styles/` | HTML and CSS |
| `functions/` | Firebase Cloud Functions |
| `relay/` | WebSocket relay for match traffic |
| `admin/` | Local admin dashboard |
| `public/` | Models, textures, audio |

## How it was built

Mostly by me and Claude (through Claude Code), with some local models along the way. A lot of the code was written
by AI under my direction. Read it with that in mind.

## License

- **Code**: [MIT](LICENSE). Copyright © 2026 Craig Smith. Do what you want with it, just keep the copyright
  notice.
- **Name, logo and branding**: "Luminal" and the Luminal logo are **not** licensed. Fork the code, call your
  version something else.
- **Third-party assets** (models, music, sound effects): each under its own license. They are not covered by the
  MIT license.

The full breakdown, credits and disclaimers are in **[NOTICE.md](NOTICE.md)**. Read it before you reuse anything
from `public/`.

Luminal is a fan-made game inspired by light-cycle games. It is not affiliated with or endorsed by Disney, and
"TRON" is their trademark.
