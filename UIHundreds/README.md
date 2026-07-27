# UIHundreds — design reference, not shipped code

**Nothing here runs.** No file in this directory is imported by `web/`, built by
either Dockerfile, or referenced by `docker-compose.yml`. It is a standalone
design prototype: `Hundres.html` opens directly in a browser with the JSX in
`src/` and the styling in `styles.css`.

The real frontend is `web/` — Next.js, TypeScript, Tailwind, and the components
under `web/src/components/`.

## Why it is still here

It is the visual reference the shipped UI was built from, and several components
in `web/src/components/hundres/` (`button`, `card`, `chip`, `sparkline`) trace
back to it. Keeping it makes the intended look reviewable without reading Tailwind
classes.

## What to watch out for

These files have not been updated since the initial commit and do **not** reflect
current behaviour. Where they disagree with `web/`, `web/` is correct. In
particular the prototype predates the autopilot cycle, the activity feed, the
paid-ad human gate, and the execution states added since.

If it stops being a useful reference, delete the directory — nothing depends on
it.

## Duplicated filenames

`tweaks-panel.jsx` here and `web/src/components/dev/tweaks-panel.tsx` are unrelated
beyond the name. Searching the repo for a component name will match both; the one
under `web/src/` is the live one.
