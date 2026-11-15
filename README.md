# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aris189/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/aris189/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it ranks pre-token DeFi protocols by implied value and shows how to
farm each one. `main.ts` (Node 22, standard library only) reads a sealed DefiLlama snapshot
of 758 protocols, scores every pre-token protocol with the radar-2 model, and writes the
ranked board (200 rows: the 40-protocol watchlist plus 160 early pre-token protocols below
the watchlist floor), a static no-network dashboard, three screenshots, and the dossier the
judge reads.

The model calibrates its multiple from the snapshot itself: each category's multiple is the
median market-cap-to-TVL ratio of that category's live-token protocols, so a DEX token is
scored at a different multiple of its TVL than a liquid staking token. No protocol name is
special-cased; the same function scores every row.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=33cfzssx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
