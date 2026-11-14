# Token Radar

A token launch radar: 300 pre-token protocols from DefiLlama's sealed snapshot, ranked by an
implied value the model derives from each protocol's own figures — TVL, seven-day growth, age with
no token, and chain reach — with a concrete farm plan for every row.

## Value model (radar-2)

```
implied = round( tvl_usd x 0.30
               x (1 + clamp(change_7d, -60, 120) / 100 x 0.60)
               x (0.55 + min(age_days, 1095) / 1095 x 0.45)
               x (1 + 0.03 x min(chains, 4)) )
```

No protocol name is special-cased. The board covers all 40 watchlist protocols plus the 260
strongest pre-token protocols below the $50M floor, by TVL. The 24 largest live-token protocols
are set aside with their market caps, never mixed into the ranking.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`, writes
`/output/board.json`, `/output/data.js`, copies `dashboard/` and `screenshots/`, and writes
`/output/dossier.json` with the vendored `vendor/makefun-board.ts` library.

## Dashboard

`dashboard/` is a static page with no network: a sortable, filterable board (search, category,
chain, pre-token / live-token tabs), a detail view per protocol with the model's inputs and its
farm plan, and the formula it runs. Open `dashboard/index.html` with the generated `data.js`
beside it.
