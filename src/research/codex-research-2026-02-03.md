# Codex Research 2026-02-03

## Scope
This document consolidates all research from this session into a single reference. It covers:
- Current system flow and the exact files that govern buy/sell behavior.
- Findings from Perplexity Search (four focused queries).
- Findings from Parallel Deep Research (with run ID and sources).
- A unified, non-duplicative set of implications and next research directions.

## Provenance And IDs
- Parallel Deep Research run ID: `trun_04740bf111ed4e898aac133198597c2e`
- Perplexity Deep Research: timed out twice (no run ID returned)
- Perplexity Search queries executed 2026-02-03:
  - `walk-forward validation backtesting leakage avoidance time series cross validation trading`
  - `execution cost modeling slippage market impact algorithmic trading best practices`
  - `risk management position sizing volatility targeting Kelly criterion drawdown control trading systems`
  - `social media sentiment trading feature engineering alt data pitfalls`

## Current Signal → Trade Flow (High Level)
1. Data gathering populates `signalCache` via `runDataGatherers()` (StockTwits, Reddit, Crypto, Twitter confirmation).
2. LLM research evaluates candidates via `researchTopSignals()` → `researchSignal()` and stores `signalResearch` with BUY/SKIP/WAIT.
3. `runAnalyst()` checks exits first (take profit, stop loss, staleness), then entries from:
   - LLM researched buys above confidence threshold.
   - LLM batch recommendations via `analyzeSignalsWithLLM()` for BUY/SELL.
4. `executeBuy()` sizes positions and places orders; `executeSell()` closes positions and clears state.
5. Policy layer (`policy/engine.ts`) validates orders (order types, buying power, short selling rules).

## Primary Files That Control Buy/Sell Behavior
- `durable-objects/mahoraga-harness.ts`
  - `runAnalyst()` is the central decision loop.
  - `executeBuy()` controls position sizing and buy order execution.
  - `executeSell()` controls exit execution and state cleanup.
  - `analyzeStaleness()` drives momentum decay exits.
  - `researchSignal()` and `analyzeSignalsWithLLM()` shape LLM gating and final recommendations.
  - `DEFAULT_CONFIG` sets thresholds and risk parameters.

- `schemas/agent-config.ts`
  - Validates config ranges for thresholds (sentiment, take profit, stop loss, etc.).

- `providers/technicals.ts`
  - `detectSignals()` defines RSI/MACD/Bollinger/SMA/volume signals.
  - Currently exposed via `mcp/agent.ts` tools but not wired into `runAnalyst()`.

- `policy/engine.ts`
  - Enforces order rules (short selling, order type, buying power, max notional).

## Immediate Tuning Levers (Codebase)
- Entry/exit logic: `durable-objects/mahoraga-harness.ts` → `runAnalyst()`.
- Position sizing: `executeBuy()` (currently % of cash * confidence with caps).
- Exit logic: take profit, stop loss, staleness thresholds.
- Signal gating: `min_sentiment_score`, `min_analyst_confidence`, `sell_sentiment_threshold`.
- LLM prompts and decision structure: `researchSignal()` and `analyzeSignalsWithLLM()`.
- Data sources and weighting: `runDataGatherers()` and source configuration.

## Research Synthesis

### 1) Backtesting, Walk-Forward, Leakage Avoidance
From Perplexity Search and Parallel research:
- Walk-forward backtests better approximate live trading than single-shot backtests but still risk overfitting to one historical path.
- Leakage is a major source of false performance. Purging/embargoing around label overlap reduces leakage risk.
- Use **CSCV** to estimate **Probability of Backtest Overfitting (PBO)**.
- Report **Deflated Sharpe Ratio (DSR)** instead of raw Sharpe; use **PSR** for probabilistic reporting with skew/kurtosis/autocorr adjustments.
- A staged validation pipeline is recommended: rough backtest → walk-forward → holdout sample → paper trading → small live.

### 2) Execution, Slippage, Market Impact
From Perplexity Search:
- Transaction cost modeling is essential; flat costs are inadequate for realistic backtests.
- Slippage depends on volatility, liquidity, latency, and strategy type; market impact is non-linear.
- Arrival price is a standard benchmark for systematic strategies; compare arrival vs VWAP/TWAP.
- Crypto execution includes additional time-risk effects (24/7) and may require explicit time-risk modeling.

### 3) Risk Management And Position Sizing
From Perplexity Search and Parallel:
- Full Kelly is too volatile for live trading; prefer **fractional Kelly (0.25x–0.5x)**.
- Combine fractional Kelly with **volatility targeting** and **Expected Shortfall (ES)** limits.
- Use drawdown-based throttles (step-downs or linear scaling) to prevent regime blowups.

### 4) Social Sentiment / Alt-Data Signal Engineering
From Perplexity Search:
- Social sentiment is noisy, easily manipulated, and highly source-dependent.
- Feature engineering and temporal alignment are critical; avoid lookahead bias by time-stamping and lagging.
- Use multiple sources and credibility weighting; avoid single-platform bias.
- Sentiment should be combined with price/volume or technical signals rather than used in isolation.

### 5) LLM Quality And Signal Attribution
From Parallel:
- Finance-tuned LLMs or finance-grounded RAG materially outperform generic LLMs for financial sentiment and entity recognition.
- Enforce ablation tests for each signal source and re-compute DSR/PBO after removing features to verify true contribution.

### 6) Regime Detection And Execution Sensitivity
From Parallel:
- Long-run convergence can take extremely long; use regime detection to throttle risk when edge is weak.
- Noisy mean estimates (e.g., sentiment) amplify turnover and estimation error; require higher confidence thresholds before trading.

## Implications For This Codebase
- Validation: Introduce CSCV + PBO + DSR/PSR gates before accepting any strategy modifications.
- Execution: Add arrival-price benchmarking and a slippage model to backtesting.
- Sizing: Replace flat % of cash sizing with fractional Kelly + volatility targeting overlay.
- Sentiment: Add credibility weighting, bot filtering, and strict timestamp alignment.
- LLM: Evaluate a finance-tuned model or RAG to reduce hallucinations and improve signal quality.
- Governance: Add drawdown breakers, confidence gates, and data-quality guards for live execution.

## Initial Research Directions
1. Rebuild backtests using CSCV, DSR, and PBO to filter false positives.
2. Run ablation studies to quantify marginal alpha from each source.
3. Compare against baseline strategies (buy-and-hold, SMA crossover) to validate added value.
4. Add regime filters (trend/volatility) to limit trading in weak regimes.
5. Implement volatility-adjusted sizing (ATR-based or volatility targeting).
6. Introduce execution modeling (arrival slippage + impact estimates).
7. Expand risk controls: max daily loss, max sector correlation, max concurrent high-correlation positions.

## Potential Enhancements (Next Iteration)
- Integrate technical confirmations into `runAnalyst()` or `researchSignal()` (RSI/MACD confirmation gates).
- Improve exit logic with trailing stops or volatility-linked time decay.
- Add consistency checks across sources (require multiple independent sources before a buy).
- Expand signal scoring to combine social sentiment, volume momentum, and technical momentum.

## Open Questions
- Desired holding period (intraday, swing, multi-day)?
- Sensitivity to social volume spikes vs sustained sentiment?
- Should options be activated for high-conviction signals or remain disabled?

## Parallel References (Titles Only; URLs In Code Block)
All below sourced from `trun_04740bf111ed4e898aac133198597c2e`.

- The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting and Non‑Normality (Bailey, Lopez de Prado)
- The Probability of Backtest Overfitting (Bailey, Borwein, Lopez de Prado, Zhu)
- Sharpe Ratio Inference: A New Standard for Decision‑Making and Reporting (Lopez de Prado, Lipton, Zoonekynd)
- BloombergGPT: A Large Language Model for Finance
- Good and bad properties of the Kelly criterion
- Harnessing Volatility Targeting in Multi‑Asset Portfolios
- Risk Parity Portfolio
- Comparative Analyses of Expected Shortfall and Value‑at‑Risk

```text
Parallel ID: trun_04740bf111ed4e898aac133198597c2e
References URLs:
https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551
https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253
https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5520741
https://www.semanticscholar.org/paper/BloombergGPT%3A-A-Large-Language-Model-for-Finance-Wu-Irsoy/83edcfbb206ddad38a971d605da09390604248ea
https://arxiv.org/abs/2303.17564
https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf
https://www.researchaffiliates.com/content/dam/ra/publications/pdf/1014-harnessing-volatility-targeting.pdf
https://palomar.home.ece.ust.hk/ELEC5470_lectures/slides_risk_parity_portfolio.pdf
https://www.imes.boj.or.jp/research/papers/english/me20-1-4.pdf
```
