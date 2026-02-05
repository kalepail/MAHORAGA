# Sentiment Trading Parameters Research

Research compiled 2026-02-04 for MAHORAGA trading bot optimization.

## 1. Alpaca API Constraints

| Parameter | Value | Source |
|-----------|-------|--------|
| Trading API requests | 200/minute | Alpaca docs |
| Burst limit | 10/second | Alpaca docs |
| Position count limit | None (buying power constrained) | Alpaca forum |
| Crypto trading | 24/7 supported | Alpaca docs |

**Implication**: 100-position strategy is well within limits. Even batch rebalancing 50 sells + 50 buys consumes ~100 requests/minute.

## 2. Position Sizing Research

### Equal-Weight Approach (for 50-100 positions)

| Positions | Capital/Position | % of $100k Equity |
|-----------|------------------|-------------------|
| 50 | $2,000 | 2% |
| 75 | $1,333 | 1.33% |
| 100 | $1,000 | 1% |

### Kelly Criterion Application

For sentiment strategy with 55% win rate, 2:1 win/loss ratio:
- Full Kelly: 32.5% per position (far too aggressive)
- Half Kelly: 16.25%
- Quarter Kelly: 8.1%
- 1/10th Kelly: 3.25% (appropriate for many-position strategy)

**Recommendation**: 2-3% of cash per trade for 50-100 position diversification.

### Risk-Per-Trade Framework

With 3% stop-loss:
- 1% portfolio risk = position size of $3,333 (3.3% of $100k)
- 0.5% portfolio risk = position size of $1,666 (1.7% of $100k)

**Current config**: $1,500 max position, 3% of cash per trade. This implies ~0.45% portfolio risk per position with 3% SL, which is conservative but appropriate for 100 positions.

## 3. Take-Profit / Stop-Loss Research

### Academic Findings

| Study | Finding |
|-------|---------|
| Han, Yufeng - "Taming Momentum Crashes" | 10% stop-loss optimal for momentum (Sharpe 0.179 vs 0.119 baseline) |
| KJ Trading - 567,000 backtests | Time-based exits often outperform fixed stops |
| Connors - "Short Term Strategies" | Stop-losses frequently hurt short-term strategy performance |
| SSRN 2024 | Under certain conditions, stops increase return AND reduce variance |

### Optimal TP/SL by Strategy Type

| Strategy | Win Rate | R:R | TP% | SL% |
|----------|----------|-----|-----|-----|
| High win-rate sentiment (60%+) | 60-65% | 1:1 to 1.5:1 | 3-5% | 3-5% |
| Moderate win-rate momentum | 50-55% | 2:1 to 3:1 | 6-10% | 3-5% |
| Low win-rate, high conviction | 35-45% | 3:1 to 5:1 | 15-25% | 5% |

### Hold-Period Specific Recommendations

| Hold Period | TP | SL | Rationale |
|-------------|----|----|-----------|
| 1-3 hours | 2-4% | 2-3% | Capture fast-decaying alpha |
| 1 day | 3-5% | 3% | Standard sentiment window |
| 2-3 days | 5-8% | 3-5% | Extended thesis development |

**Current config**: 5% TP, 3% SL (1.67:1 R:R). Appropriate for 1-3 day holds.

## 4. Sentiment Alpha Decay

### Decay Timeline by Source

| Time After Signal | Remaining Alpha |
|-------------------|-----------------|
| 0-30 minutes | 100% |
| 30 min - 2 hours | 70-80% |
| 2-6 hours | 40-60% |
| 6-24 hours | 20-40% |
| 1-2 days | 10-20% |
| 3-5 days | 5-10% |
| 1-2 weeks | ~0% |

### Optimal Decay Half-Life Settings

| Signal Source | Recommended Half-Life |
|---------------|----------------------|
| Twitter burst | 60-90 minutes |
| StockTwits | 90-120 minutes |
| Reddit/WSB | 120-180 minutes |
| News/SEC filings | 360-720 minutes |

**Current config**: 90 minutes. Appropriate for social signals, may want separate decay for news.

## 5. Sentiment Thresholds

| Threshold (0-1 scale) | Trade Volume | Edge Quality |
|-----------------------|--------------|--------------|
| 0.20-0.25 | High | Moderate |
| 0.30-0.40 | Moderate | Good |
| 0.50-0.60 | Low | High per-trade |
| 0.70+ | Very low | Highest per-trade |

Bloomberg research: 0.225 threshold produced significant edge with 8-day optimal hold.

**Current config**: 0.25 minimum sentiment. Appropriate for high-position-count strategy.

## 6. Staleness / Time-Based Exit Research

### Graduated Exit Framework

| Hold Duration | Min Required Gain | Action if Below |
|---------------|-------------------|-----------------|
| 0-4 hours | N/A | Hold |
| 4-12 hours | > -2% | Close quick losers |
| 12-24 hours | > 0% | Close if flat |
| 1-2 days | > +1.5% | Close if below |
| 2-3 days | > +3% | Close if below |
| 3-5 days | > +5% | Force close |
| 5+ days | Force close | Alpha fully decayed |

### Social Volume Decay as Exit Signal

Research supports exiting when social volume drops to 30-40% of entry level. The catalyst is losing attention, and price tends to mean-revert.

**Current config**:
- `stale_min_hold_hours`: 6 (check starts at 6h)
- `stale_mid_hold_days`: 1, `stale_mid_min_gain_pct`: 1.5 (need +1.5% by day 1)
- `stale_max_hold_days`: 3, `stale_min_gain_pct`: 3 (need +3% by day 3)
- `stale_social_volume_decay`: 0.35 (exit at 35% of entry volume)

These align well with research.

## 7. Optimal Holding Periods by Source

| Signal Source | Optimal Hold | Peak Alpha Window |
|--------------|--------------|-------------------|
| Twitter/X burst | 4-24 hours | First 2-6 hours |
| Reddit/WSB surge | 1-3 days | First 12-48 hours |
| StockTwits consensus | 1-5 days | First 1-3 days |
| News sentiment | 3-8 days | First 2-5 days |
| Multi-source confirmed | 2-5 days | First 1-3 days |

**Current config**: 15-minute minimum hold, 3-day max hold. Appropriate for fast rotation.

## 8. Source Weights Validation

Current SOURCE_CONFIG weights:

| Source | Weight | Research Support |
|--------|--------|------------------|
| twitter_fintwit | 0.95 | High - Twitter has fastest alpha |
| twitter_news | 0.9 | High |
| sec_8k | 0.95 | High - material events |
| sec_4 | 0.9 | High - insider activity |
| reddit_stocks | 0.9 | Moderate-High |
| stocktwits | 0.85 | Moderate - more noise |
| reddit_options | 0.85 | Moderate |
| reddit_investing | 0.8 | Moderate |
| sec_13f | 0.7 | Lower - quarterly, delayed |
| reddit_wallstreetbets | 0.6 | Lower - high noise |

Context Analytics research: StockTwits better aligned with next-day returns than Twitter alone. Consider boosting StockTwits weight or requiring multi-source confirmation.

## 9. Implementation Gaps Identified

1. **No separate news decay**: News/SEC signals use same 90-min half-life as social. Should be 6-12 hours.

2. **No multi-source confirmation**: Research shows 20%+ improvement when signals confirmed across platforms. Currently treating each source independently.

3. **No dynamic staleness threshold**: Same social volume decay (35%) regardless of hold duration. Research suggests:
   - Day 0-1: Exit at 40% (early decay = bad sign)
   - Day 1-2: Exit at 30%
   - Day 2+: Exit at 20%

4. **Crypto parameters not tuned**: Using 10%/5% TP/SL from old config. Crypto volatility (BTC daily range 3-5%, SOL 5-8%) may warrant wider stops.

5. **No intraday quick-loser exit**: Research suggests closing positions down >2% within first 4-12 hours. Current staleness check doesn't start until 6 hours.

## Sources

- Alpaca API Documentation (https://docs.alpaca.markets)
- Han, Yufeng - "Taming Momentum Crashes" (CICF Conference)
- KJ Trading Systems - 567,000 Backtests Analysis
- Bloomberg - "Edge from News Sentiment Data"
- Context Analytics - Social Sentiment Research
- CEPR - "Twitter Sentiment and Stock Market Movements"
- SSRN - "Simple Trading Strategy with Stop-Loss and Take-Profit" (2024)
- Alpha Theory - Kelly Criterion in Practice
- Lopez de Prado - Triple Barrier Method
