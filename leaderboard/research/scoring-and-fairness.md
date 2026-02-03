# Leaderboard Scoring System & Newcomer Fairness

---

PROMPT:

Every 30 days we start over? Otherwise newcomers will struggle to compete. I see a filter by days, how does that work in practice?

Can you do some review on this? I've just got some questions around exactly how this works with the concern that if a player joins the leaderboard with a brand new $100K account, they won't be able to compete with players that have been trading and making improvements and have $500,000 or $1M of P&L because they've been playing for a year or two years. Or is that not really the way that it works? And that the 30-day, 90-day, one-week filters and sorts will help us avoid that particular issue.

---

Research document capturing findings about the current scoring system and potential improvements for newcomer fairness.

---

## 1. Current System Analysis

### Composite Score Calculation

The leaderboard uses a composite score (0-100) that balances four trading metrics:

| Metric | Weight | What It Measures |
|--------|--------|------------------|
| **ROI %** | 40% | Raw return on investment vs starting capital |
| **Sharpe Ratio** | 30% | Risk-adjusted returns (excess return per unit of volatility) |
| **Win Rate** | 15% | Percentage of profitable trading days |
| **Inverse Max Drawdown** | 15% | Capital preservation (100% - max drawdown) |

**Normalization**: Min-max scaling across all traders ensures each component contributes proportionally regardless of absolute scale (e.g., Sharpe ~0-3 vs ROI ~-50% to +200%).

**Edge cases**: Traders without Sharpe or Win Rate data (insufficient trading history) receive a partial score using ROI (72.7%) and Inverse Drawdown (27.3%), maintaining the 40:15 ratio between these components.

### How Period Filters Currently Work

The frontend offers period filters: 7D, 30D, 90D, ALL.

**Important distinction**: These filters control **data freshness**, not the metric calculation window.

From `worker/api.ts`:
```
The period filter controls DATA FRESHNESS, not the metric calculation window.
A "30D" filter shows traders whose most recent snapshot falls within the
last 30 days, but the metrics in that snapshot (ROI, Sharpe, etc.) reflect
all-time performance up to that date.
```

In practice, the period filter:
- Filters **which traders appear** (those with recent activity)
- Does **NOT** recalculate metrics for only that window
- All displayed metrics are still cumulative all-time values

### All-Time Cumulative Metrics

All metrics stored in `performance_snapshots` are cumulative from day one:

- **ROI %**: `(current_equity - initial_equity) / initial_equity * 100`
- **Sharpe Ratio**: Calculated from all daily returns since account start
- **Win Rate**: Profitable days / total trading days (all-time)
- **Max Drawdown**: Peak-to-trough decline across entire history

Metrics are calculated fresh each sync from Alpaca's portfolio history, but always use the full history.

### Percentage-Based ROI

ROI is calculated as a percentage, which is theoretically fair:
- A $10,000 account with $2,000 profit = 20% ROI
- A $100,000 account with $20,000 profit = 20% ROI

Both would rank equally on ROI percentage, regardless of absolute capital.

---

## 2. Fairness Concerns

### Period Filters Don't Show Rolling Performance

Users selecting "30D" might expect to see performance from the last 30 days only. Instead, they see:
- Traders active in the last 30 days
- With their all-time cumulative metrics

This creates a UX expectation mismatch.

### Veterans Have Compounding Advantage

Even with percentage-based ROI, veterans have structural advantages:

1. **Compounding time**: A trader with 2 years of 0.5% daily gains will have exponentially higher ROI than someone with 30 days of the same daily performance.

2. **Statistical significance**: Veterans have more trading days, leading to:
   - More stable Sharpe ratios (larger sample size)
   - More meaningful Win Rate (100 days at 55% is more reliable than 10 days at 60%)
   - Better representation in Max Drawdown (more opportunities to experience and recover from drawdowns)

3. **Strategy refinement**: Veterans have had time to tune their algorithms, fix bugs, and optimize strategies.

### New Players Need Time for Meaningful Metrics

New traders face cold-start problems:

| Metric | Minimum Data Required | Notes |
|--------|----------------------|-------|
| Sharpe Ratio | 5+ days of data | Returns `null` with fewer days |
| Win Rate | 2+ active trading days | Returns `null` otherwise |
| ROI % | 1 day | Available immediately, but unstable |
| Max Drawdown | 2+ data points | Meaningful only with volatility |

A new trader might have excellent recent performance but:
- No Sharpe score (falls back to partial scoring)
- Volatile metrics that don't reflect true strategy quality
- Unable to compete with veterans who have optimized scores

---

## 3. Potential Changes

### Option A: Rolling Window Metrics

**Concept**: Calculate metrics only for the selected period.
- 30D ROI = returns from last 30 days only
- 30D Sharpe = daily returns from last 30 days
- etc.

**Trade-offs**:
| Pros | Cons |
|------|------|
| Fair comparison of recent performance | Rewards hot streaks, punishes temporary slumps |
| New traders can compete quickly | Loses valuable long-term performance data |
| Matches user expectations for period filters | More volatile rankings (top traders change often) |
| Encourages continuous improvement | Veterans might feel penalized for past success |

**Implementation complexity**: High
- Need to store granular daily data (already have `equity_history`)
- Recalculate metrics per query or pre-compute for common windows
- Significant API and cron changes

### Option B: Dual Leaderboard Views

**Concept**: Keep all-time as primary, add separate "Recent Performance" view.
- Default: All-time leaderboard (current behavior)
- Toggle: "Hot Traders" showing rolling 30D performance

**Trade-offs**:
| Pros | Cons |
|------|------|
| Preserves veteran recognition | UI complexity increases |
| Gives newcomers a path to visibility | Two "leaderboards" might confuse users |
| No breaking changes to current rankings | Doubles computation/storage needs |
| Community can self-select which matters | Debates about which is "real" ranking |

**Implementation complexity**: Medium
- Add new metric columns for rolling periods
- New API endpoints or query parameters
- Frontend toggle/tab component

### Option C: Seasonal Resets (Quarterly Leaderboard)

**Concept**: Reset rankings periodically (e.g., quarterly), archive previous seasons.
- Q1 2024, Q2 2024, etc. leaderboards
- Historical seasons viewable but not active
- All-time stats still visible on profile

**Trade-offs**:
| Pros | Cons |
|------|------|
| Fresh start for everyone | Discourages long-term strategy building |
| Seasonal competition drives engagement | May feel arbitrary (why this date?) |
| Clear "winner" announcements | Good strategies get penalized by resets |
| Similar to gaming/esports models | Veterans lose recognition each season |

**Implementation complexity**: Medium
- Add `season` column to snapshots
- Archive mechanism for past seasons
- Historical season API endpoints
- Season countdown/announcement UI

---

## 4. Implementation Considerations

### Database Changes Needed

**Option A (Rolling Metrics)**:
```sql
-- Already have equity_history with daily data
-- Need to ensure sufficient history retention
-- May need indexed views or materialized aggregates

-- Example: Pre-computed rolling metrics table
CREATE TABLE rolling_metrics (
  trader_id TEXT NOT NULL,
  period_days INTEGER NOT NULL,  -- 7, 30, 90
  roi_pct REAL,
  sharpe_ratio REAL,
  win_rate REAL,
  max_drawdown_pct REAL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (trader_id, period_days)
);
```

**Option B (Dual Views)**:
```sql
-- Add columns to performance_snapshots
ALTER TABLE performance_snapshots ADD COLUMN roi_30d REAL;
ALTER TABLE performance_snapshots ADD COLUMN sharpe_30d REAL;
-- ... etc
```

**Option C (Seasons)**:
```sql
ALTER TABLE performance_snapshots ADD COLUMN season TEXT;
-- e.g., '2024-Q1', '2024-Q2'

CREATE INDEX idx_snapshots_season ON performance_snapshots(season);
```

### API Modifications

**Option A**:
- `GET /api/leaderboard?period=30&rolling=true` - new query param
- Significant changes to `queryLeaderboard()` function
- May need separate endpoint for performance

**Option B**:
- `GET /api/leaderboard?view=recent` or separate `/api/leaderboard/recent`
- Minor changes to existing queries
- Could use same response shape

**Option C**:
- `GET /api/leaderboard?season=2024-Q1`
- `GET /api/seasons` - list available seasons
- Archive endpoint for historical data

### Cron Job Adjustments

**Option A**:
- `computeAndStoreCompositeScores()` needs rolling variants
- Multiple score calculations per trader (7D, 30D, 90D, all-time)
- Consider compute budget (4x calculations)

**Option B**:
- Add rolling metric calculations to existing cron
- Could be incremental (only update if data changed)

**Option C**:
- Add season boundary detection
- Archive job at season end
- Reset job at season start

### Frontend Updates

**All Options**:
- FilterBar component changes
- New toggle/dropdown for view selection
- Period selector behavior clarification
- Possibly new "Recent" or "Season" badges

**Option C specific**:
- Season selector component
- Season countdown/announcement banner
- Historical season browser

---

## Summary

| Aspect | Current | Option A | Option B | Option C |
|--------|---------|----------|----------|----------|
| Newcomer fairness | Poor | Good | Medium | Good |
| Veteran recognition | High | Medium | High | Low |
| Implementation effort | N/A | High | Medium | Medium |
| UX clarity | Medium | High | Medium | High |
| Metric stability | High | Low | High | Medium |
| Breaking changes | N/A | Yes | No | Yes |

**Recommendation**: Option B provides the best balance - preserving existing functionality while giving newcomers visibility through a secondary view. It's also the least disruptive to implement and allows community feedback before committing to more drastic changes.
