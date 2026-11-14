# Token Radar

A token launch radar: 240 pre-token protocols from DefiLlama's sealed snapshot,
ranked by an implied value the model derives from the snapshot's own figures.

## The model

Implied value = locked value × 0.30 × growth × maturity × reach.

- **Growth** follows the seven-day move in locked value (clamped to −50…+100%).
- **Maturity** follows how long the protocol has run with no token (12% per year, up to 4 years).
- **Reach** follows how many chains the protocol touches (3% per extra chain, up to 10).

The board carries every protocol on the snapshot's watchlist plus the 200
strongest other pre-token protocols by implied value. Protocols whose token
already trades are set aside, never ranked.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`
into the output directory. Two runs on the same snapshot write the same bytes.

## Screenshots

Rendered from the dashboard itself with headless Chromium:

```sh
node tools/shoot.mjs out screenshots
```
