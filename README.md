# Fresh-Cross Slow Trend

![make.fun bounty](https://make.fun/badge/btc-race-24h-20261118-1444.svg)
![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Yogii123-qw/btc-race-24h-20261118/rank.svg)
![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Yogii123-qw/btc-race-24h-20261118/reward.svg)

A long-only trading bot for the [make.fun bounty: Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261118-1444). It trades cbBTC against USDC on 1-minute bars, entering only a fresh, confirmed slow uptrend and exiting on the cross back or a trailing stop, with all decisions in exact integer arithmetic so repeated runs agree byte for byte.

Run locally against the dev window with the kit grader:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/btc-race-24h-20261118 --driver process
```

Or run the bot directly (it speaks newline-delimited JSON on stdin/stdout):

```sh
node main.ts
```

Built for [make.fun](https://make.fun/r/wdh6z73q).
