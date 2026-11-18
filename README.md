# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/GGMU1987/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/GGMU1987/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

GGMU Radar ranks 226 pre-token protocols by implied value — what a token would be worth if each protocol's record stayed as it is. The peer multiple at the model's heart is not written down by hand: it is measured from the sealed snapshot itself, as the median market-cap/TVL of the live-token protocols in the same category, then adjusted by the protocol's 7-day TVL momentum, its maturity (days run with no token recorded) and its chain breadth. The board covers all 40 watchlist protocols and adds 186 early finds below the $50M floor, chosen by implied value rather than raw TVL. The dashboard is sortable and filterable (search, category, chain, watchlist-only), every row opens a detail view that shows the model's arithmetic for that protocol — recomputed in the page and checked against board.json — and a seven-step farm plan with costs and times derived from the protocol's own category, chains, TVL and age. Protocols whose token already trades are never ranked; they are shown apart at the market's own values, and their category medians are what price the board.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
# then serve out/ and open out/dashboard/ — the page reads out/data.js, no network needed
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=qzmdrdxd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
