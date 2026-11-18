// Fresh-Cross Slow Trend: a long-only bot for the agent-fun/bars-replay/v1 replay.
//
// How the protocol shapes this bot: the harness sends one hello line first
// (universe, capital, caps, fees, seed), then one batch per minute. Each batch
// carries the bar that just closed, the fills of the orders decided on the
// previous batch, and the account. The bot answers every batch with exactly
// one reply echoing its seq, carrying zero or more orders. An order decided
// on a batch fills at the next bar's open, so every signal here is computed
// from closes that are already final, and nothing peeks at the future.
//
// Strategy, designed from the dev window's own bars: BTC's 1-minute moves are
// tiny (about 7 bps of noise) while a full-size round trip costs about 26 bps,
// so the bot trades rarely and only rides a fresh slow uptrend:
//   - a fast 60-bar average of closes above a slow 180-bar average by a 10 bp
//     band, confirmed for 3 consecutive bars;
//   - the cross must be fresh (the fast average has been above the slow one
//     for at most 60 bars) and the close must not be stretched more than
//     25 bps above the slow average, so the bot never chases a stale trend;
//   - exit on the cross back through the lower band, or on an 80 bp trailing
//     fall from the highest close since entry, whichever comes first.
// All comparisons are exact integer arithmetic on the bar closes, so two runs
// on the same data answer byte for byte the same. No clock, no randomness,
// no network, no environment reads: time is the bar time in each batch.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 60;
const SLOW_BARS = 180;
const BAND_BPS = 10;
const CONFIRM_BARS = 3;
const FRESH_MAX_BARS = 60;
const EXTENSION_MAX_BPS = 25;
const TRAIL_BPS = 80;
const COOLDOWN_BARS = 30;
const MAX_SLIPPAGE_BPS = 100;
const BPS_DENOM = 10_000n;

const SYMBOL = 'CBBTC';

// Rolling state over the closes of each bar, oldest to newest.
const closes: bigint[] = [];
let barIndex = 0;
let aboveBandStreak = 0;
let barsAbove = 0;
let lastExitBar = -1_000_000;
let runHigh: bigint | null = null;
let wasHolding = false;

function sumLast(window: number): bigint {
  let total = 0n;
  for (let i = closes.length - window; i < closes.length; i++) total += closes[i]!;
  return total;
}

function onBatch(state: BarsState, batch: Batch): OrderInput[] {
  const bar = batch.bars.find((b) => b.symbol === SYMBOL);
  if (bar === undefined) return [];
  const close = BigInt(bar.c);
  closes.push(close);
  if (closes.length > SLOW_BARS) closes.shift();
  barIndex += 1;

  const held = state.positions.get(SYMBOL);
  const holding = held !== undefined && held.qty > 0n;
  if (holding) {
    if (!wasHolding) runHigh = close;
    if (runHigh === null || close > runHigh) runHigh = close;
  } else {
    runHigh = null;
  }
  wasHolding = holding;

  // Averages exist only once the slow window is full.
  if (closes.length < SLOW_BARS) return [];
  const fastSum = sumLast(FAST_BARS);
  const slowSum = sumLast(SLOW_BARS);
  // fastAvg = fastSum / 60, slowAvg = slowSum / 180. Cross-multiply so every
  // comparison stays in integers: fastAvg > slowAvg  <=>  fastSum * 180 > slowSum * 60.
  const fastScaled = fastSum * BigInt(SLOW_BARS);
  const slowScaled = slowSum * BigInt(FAST_BARS);

  const aboveBand = fastScaled * BPS_DENOM > slowScaled * (BPS_DENOM + BigInt(BAND_BPS));
  const belowBand = fastScaled * BPS_DENOM < slowScaled * (BPS_DENOM - BigInt(BAND_BPS));
  aboveBandStreak = aboveBand ? aboveBandStreak + 1 : 0;
  barsAbove = fastScaled > slowScaled ? barsAbove + 1 : 0;

  if (state.warmingUp) return [];

  if (!holding) {
    // Entry: fresh, confirmed, unextended slow uptrend, past the cooldown.
    if (aboveBandStreak < CONFIRM_BARS) return [];
    if (barsAbove > FRESH_MAX_BARS) return [];
    // close <= slowAvg * (1 + 25 bps), in integers.
    const stretched = close * BigInt(SLOW_BARS) * BPS_DENOM > slowSum * (BPS_DENOM + BigInt(EXTENSION_MAX_BPS));
    if (stretched) return [];
    if (barIndex - lastExitBar < COOLDOWN_BARS) return [];
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    const room = state.weightRoom(SYMBOL);
    const spend = state.cash < room ? state.cash : room;
    if (spend < minNotional) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }

  // Exit: cross back through the lower band, or the trailing stop.
  const trailHit = runHigh !== null && close * BPS_DENOM < runHigh * (BPS_DENOM - BigInt(TRAIL_BPS));
  if (belowBand || trailHit) {
    lastExitBar = barIndex;
    return [{ side: 'sell', symbol: SYMBOL, qty: held!.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({ onBatch });
