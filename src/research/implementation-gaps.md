# Implementation Gaps & Recommended Improvements

Analysis of MAHORAGA codebase vs research-backed best practices.

## Gap 1: Quick Loser Exit (HIGH PRIORITY)

**Research finding**: Positions losing >2% within 4-12 hours rarely recover in sentiment trades. Quick losers signal bad entry timing or noise signal.

**Current behavior**: Staleness check only starts after `stale_min_hold_hours` (6 hours). A position can be down 2.5% for 5 hours with no action.

**Recommended fix**: Add early quick-loser check in `runAnalyst()`:
```typescript
// In runAnalyst(), before staleness check:
const holdHours = entry ? (Date.now() - entry.entry_time) / (1000 * 60 * 60) : 0;
if (holdHours >= 1 && holdHours < stale_min_hold_hours && plPct <= -2) {
  await this.executeSell(alpaca, pos.symbol, `Quick loser: ${plPct.toFixed(1)}% in ${holdHours.toFixed(1)}h`);
  continue;
}
```

**Impact**: Faster capital rotation, avoids holding deteriorating positions.

## Gap 2: Separate Decay for News vs Social (MEDIUM PRIORITY)

**Research finding**: News/SEC filing alpha persists 6-24 hours, while social (Twitter, Reddit) alpha decays in 90-180 minutes.

**Current behavior**: Single `decayHalfLifeMinutes: 90` applies to all sources.

**Recommended fix**: Add `newsDecayHalfLifeMinutes` to config and apply different decay in `applyTimeDecay()`:
```typescript
const isNewsSource = ['sec_8k', 'sec_4', 'sec_13f'].includes(signal.source);
const halfLife = isNewsSource
  ? this.state.config.news_decay_half_life_minutes ?? 360
  : SOURCE_CONFIG.decayHalfLifeMinutes;
```

**Impact**: News signals maintain relevance longer, social signals still decay fast.

## Gap 3: Multi-Source Confirmation Bonus (MEDIUM PRIORITY)

**Research finding**: Context Analytics shows 20%+ improvement when signals confirmed across platforms. StockTwits + Twitter + Reddit agreement is highly predictive.

**Current behavior**: Each source contributes to aggregate sentiment score, but no explicit bonus for multi-source confirmation.

**Recommended fix**: In `runLLMAnalyst()` or signal aggregation, boost confidence for multi-source tickers:
```typescript
const sourceCount = new Set(signalsForSymbol.map(s => s.source.split('_')[0])).size;
const multiSourceBonus = sourceCount >= 3 ? 1.2 : sourceCount >= 2 ? 1.1 : 1.0;
```

**Impact**: Prioritize higher-confidence entries with cross-platform validation.

## Gap 4: Dynamic Staleness Thresholds (LOW PRIORITY)

**Research finding**: Early social volume decay is more concerning than late decay. Exit at 40% on day 0-1, 30% on day 1-2, 20% after day 2.

**Current behavior**: Single `stale_social_volume_decay: 0.35` threshold regardless of hold duration.

**Recommended fix**: Make `analyzeStaleness()` use dynamic threshold:
```typescript
const holdDays = ...;
const volumeThreshold = holdDays < 1 ? 0.4 : holdDays < 2 ? 0.3 : 0.2;
if (volumeRatio <= volumeThreshold) { ... }
```

**Impact**: More aggressive early exits when catalyst dies quickly.

## Gap 5: Crypto-Specific TP/SL (HIGH PRIORITY for crypto strategy)

**Research finding**: Crypto volatility is 3-5x higher than equities. BTC daily range 3-5%, SOL 5-8%. Standard equity TP/SL will trigger too frequently.

**Current behavior**: `crypto_take_profit_pct: 10`, `crypto_stop_loss_pct: 5` are used. These seem reasonable but not applied consistently - the main `runAnalyst()` uses `take_profit_pct` and `stop_loss_pct` for ALL positions including crypto.

**Recommended fix**: Check if position is crypto and use crypto-specific thresholds:
```typescript
const isCrypto = this.state.config.crypto_symbols?.includes(pos.symbol.replace('/', ''));
const tp = isCrypto ? this.state.config.crypto_take_profit_pct : this.state.config.take_profit_pct;
const sl = isCrypto ? this.state.config.crypto_stop_loss_pct : this.state.config.stop_loss_pct;
```

**Impact**: Prevents premature crypto exits due to normal volatility.

## Gap 6: Position Count Tracking in Research Loop (MINOR)

**Current behavior**: Lines 2626-2634 check `positions.length >= max_positions` but don't account for successful buys during the loop that add to the position count.

**Already handled**: The `heldSymbols.add()` prevents duplicate buys, and the loop tracks `positions.length` incrementally. No change needed.

## Gap 7: Hardcoded Position Sizing Cap

**Line 2763**: `Math.min(20, this.state.config.position_size_pct_of_cash)`

**Current config**: `position_size_pct_of_cash: 3`, so this cap doesn't affect us.

**Note**: This cap exists as a safety rail. Keep it but perhaps raise to 25 for flexibility.

## Implementation Priority

| Gap | Priority | Complexity | Impact |
|-----|----------|------------|--------|
| Gap 5: Crypto TP/SL | HIGH | Low | Correct crypto exit triggers |
| Gap 1: Quick Loser | HIGH | Low | Faster capital rotation |
| Gap 2: News Decay | MEDIUM | Medium | Better news signal persistence |
| Gap 3: Multi-Source | MEDIUM | Medium | Higher quality entries |
| Gap 4: Dynamic Staleness | LOW | Low | Marginal improvement |
