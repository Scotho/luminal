# Security

Luminal is unfinished and not actively maintained. There is no bounty and no promised response time.

## Reporting

Please don't open a public issue for a security problem. Use GitHub's **private vulnerability reporting** on this
repository (Security tab, "Report a vulnerability").

## What matters most

- Anything that lets one player read or change another player's data on the live game.
- Anything that gets around the Firestore / Realtime Database rules (`firestore.rules`, `database.rules.json`).
- A credential, token or personal address committed to the repository.

## Things that are not secrets

The Firebase web config and the reCAPTCHA site key in `src/firebase.ts` are public by design. Access is
controlled by security rules and App Check, not by hiding those values.

## If you host your own copy

You are responsible for it. Use your own Firebase project, review the rules before you open it to anyone, and
don't point a fork at the live project.
