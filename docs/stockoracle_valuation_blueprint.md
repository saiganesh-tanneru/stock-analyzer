# StockOracle Intrinsic-Value Reconstruction Blueprint

A structured guide for recreating a transparent StockOracle-style valuation model using public financial data.

> **Research status:** StockOracle publicly describes OracleValue™ as proprietary. Its exact source code, weighting system, normalization rules, and complete model list are not publicly disclosed. This document reconstructs the most clearly identifiable 20-year discounted free cash flow framework and distinguishes confirmed public information from implementation assumptions.

## 1. What StockOracle Does

StockOracle is an AI-assisted stock-research platform that combines financial statements, valuation estimates, market data, and qualitative analysis. Its central valuation output is **OracleValue™**, described as a proprietary intrinsic-value estimate developed by the Piranha Profits research team.

Public examples show that StockOracle presents OracleValue™ alongside established valuation models, including DCF-20, DFCF-20, DNI-20, terminal FCF, mean P/E, mean P/S, and mean P/B. OracleValue™ should therefore be treated as distinct from the more transparent component models.

**Important limitation:** Public material does not establish the exact OracleValue™ weighting scheme, discount-rate methodology, terminal-value convention, or data-normalization rules.

## 2. Publicly Identifiable DFCF-20 Model

StockOracle examples indicate a 20-year discounted free cash flow model using a current or normalized FCF base, staged growth assumptions, a terminal growth rate, a discount rate, cash and short-term investments, debt, and diluted shares outstanding.

### Core inputs

- `FCF₀`: latest normalized free cash flow.
- `g₁`: annual growth rate for years 1–5.
- `g₂`: annual growth rate for years 6–10.
- `gᵀ`: terminal growth rate.
- `r`: discount rate.
- `Cash`: cash and short-term investments.
- `Debt`: total debt or debt selected by the model.
- `N`: diluted shares outstanding.

## 3. Core Mathematical Components

### 3.1 Forecast free cash flow

For years 1–5:

\[
FCF_t = FCF_0(1+g_1)^t
\]

For years 6–10:

\[
FCF_t = FCF_0(1+g_1)^5(1+g_2)^{t-5}
\]

For years 11–20:

\[
FCF_t = FCF_{10}(1+g_T)^{t-10}
\]

### 3.2 Present value of forecast cash flows

\[
PV_{forecast} = \sum_{t=1}^{20}\frac{FCF_t}{(1+r)^t}
\]

### 3.3 Terminal value

Using a Gordon-growth perpetuity after year 20:

\[
TV_{20} = \frac{FCF_{20}(1+g_T)}{r-g_T}
\]

\[
PV(TV) = \frac{TV_{20}}{(1+r)^{20}}
\]

The formula requires:

\[
r > g_T
\]

### 3.4 Enterprise value and equity value

\[
EV = PV_{forecast} + PV(TV)
\]

\[
EquityValue = EV + Cash - Debt
\]

\[
IntrinsicValuePerShare = \frac{EquityValue}{N}
\]

### 3.5 Market comparison

\[
PriceToIntrinsicValue = \frac{CurrentPrice}{IntrinsicValuePerShare}
\]

\[
MarginOfSafety = 1 - PriceToIntrinsicValue
\]

A ratio below 1 means the market price is below the estimated intrinsic value; a ratio above 1 means it is above the estimate.

## 4. Required Financial Metrics

| Category | Required metric | Symbol | Use |
|---|---|---:|---|
| Cash flow | Normalized free cash flow | `FCF₀` | Starting cash-flow base |
| Growth | Years 1–5 growth rate | `g₁` | First forecast stage |
| Growth | Years 6–10 growth rate | `g₂` | Second forecast stage |
| Growth | Terminal growth rate | `gᵀ` | Long-run growth |
| Risk | Discount rate | `r` | Present-value discounting |
| Balance sheet | Cash and short-term investments | `Cash` | Added to enterprise value |
| Balance sheet | Total debt | `Debt` | Deducted from enterprise value |
| Capital structure | Diluted shares outstanding | `N` | Converts equity value to per-share value |
| Market data | Current share price | `P` | Calculates valuation discount or premium |

### Supporting metrics

Collect the following for validation and assumption-building:

- Revenue.
- Operating income.
- Net income.
- Diluted EPS.
- Cash from operating activities.
- Capital expenditures.
- Total assets.
- Total liabilities.
- Total equity.
- Current and long-term debt.
- Cash and equivalents.
- Short-term investments.
- Historical FCF.
- Historical FCF growth.
- Analyst EPS or revenue-growth estimates.
- Historical valuation multiples.
- Industry and sector classification.
- Share-count history.
- Stock price and market capitalization.

### Free cash flow calculation

If capital expenditures are expressed as a positive amount:

\[
FCF = CashFromOperations - CapitalExpenditures
\]

If capital expenditures are reported as a negative cash-flow item:

\[
FCF = CashFromOperations + CapitalExpenditures
\]

Free cash flow per share is:

\[
FCFPS = \frac{FCF}{DilutedShares}
\]

## 5. Constructing Growth Rates

Historical compound annual growth rate:

\[
CAGR = \left(\frac{Metric_{end}}{Metric_{start}}\right)^{1/n}-1
\]

For volatile cash flows, use normalized FCF:

\[
NormalizedFCF = Median(FCF_{t-5},...,FCF_t)
\]

or:

\[
NormalizedFCF = \frac{1}{6}\sum_{i=0}^{5}FCF_{t-i}
\]

A practical assumption hierarchy is:

1. Use normalized historical FCF CAGR when the company has a stable cash-flow history.
2. Use analyst consensus EPS or revenue growth when FCF is volatile.
3. Use the lower of historical and analyst growth when conservatism is required.
4. Cap long-term growth at a sustainable rate below the discount rate.
5. Apply sector-specific constraints to cyclical, financial, commodity, and early-stage companies.

## 6. Platform Data Sourcing

### 6.1 GuruFocus

GuruFocus is the most suitable of the three platforms for historical financial statements, valuation pages, downloadable financials, and data APIs.

#### Relevant locations

| Required input | GuruFocus location or field |
|---|---|
| Revenue | 30-year Financials → Income Statement |
| Net income | 30-year Financials → Income Statement |
| EPS without NRI | DCF calculator / valuation data |
| Diluted EPS | Income Statement |
| Cash from operations | Cash Flow Statement |
| Capital expenditures | Cash Flow Statement |
| Free cash flow | Cash Flow Statement or derived field |
| FCF per share | Valuation or per-share data |
| Cash and equivalents | Balance Sheet |
| Short-term investments | Balance Sheet |
| Total debt | Balance Sheet / financial ratios |
| Total equity | Balance Sheet |
| Diluted average shares | Per-share or income-statement share data |
| Historical multiples | Historical Valuation and Ratios dataset |
| Growth estimates | Estimates section or valuation tools |

#### Extraction procedure

1. Search for the ticker on GuruFocus.
2. Open the 30-year Financials page.
3. Select annual and quarterly views as required.
4. Export or retrieve income-statement, balance-sheet, and cash-flow data.
5. Normalize units, currencies, fiscal periods, and sign conventions.
6. Map platform field names to the model schema.
7. Preserve the reporting date and source field for every value.
8. Use the GuruFocus API or downloadable financials for repeatable extraction where licensing permits.

### 6.2 Finviz

Finviz is primarily a screening and market-overview platform rather than a complete long-history financial-statement database.

#### Useful Finviz fields

- Price.
- Market capitalization.
- Enterprise value.
- P/E.
- Forward P/E.
- PEG.
- P/S.
- P/B.
- P/FCF.
- EPS.
- EPS growth.
- Sales growth.
- Profit margin.
- Operating margin.
- Return on equity.
- Debt/equity.
- Dividend yield.
- Book value per share.
- Cash per share.
- Current ratio.
- Quick ratio.
- Analyst target price.

#### Best use

Use Finviz for:

- Current price.
- Market capitalization.
- Enterprise value.
- Current valuation multiples.
- Peer-company selection.
- Sector and industry classification.
- Screening for financial quality.
- Cross-checking P/E, P/S, P/B, and P/FCF.

Do not use Finviz as the sole source for a 20-year FCF model unless the required historical statement data is available through an authorized data product.

#### Extraction procedure

1. Use the Finviz screener to identify the ticker.
2. Retrieve the stock summary page.
3. Capture Overview, Valuation, Financial, and Ownership fields.
4. Record whether data is annual, quarterly, TTM, or forward.
5. Use Finviz Elite export or an authorized API for batch extraction.
6. Treat blank fields as unavailable—not zero.
7. Reconcile Finviz market cap, enterprise value, and share count with the financial-statement provider.

### 6.3 TradingView

TradingView organizes fundamental data into four principal categories:

1. Income Statement.
2. Balance Sheet.
3. Cash Flow.
4. Ratios.

#### Relevant TradingView fields

| Model requirement | TradingView category |
|---|---|
| Revenue | Income Statement → Total Revenue |
| Net income | Income Statement → Net Income |
| Diluted EPS | Income Statement → Diluted EPS |
| EBITDA | Income Statement → EBITDA |
| Cash from operations | Cash Flow → Cash From Operating Activities |
| Capital expenditures | Cash Flow |
| Free cash flow | Cash Flow → Free Cash Flow |
| Total debt | Balance Sheet → Total Debt |
| Long-term debt | Balance Sheet → Long-Term Debt |
| Total equity | Balance Sheet → Total Equity |
| Market capitalization | Ratios / Statistics |
| P/E | Ratios → Price Earnings Ratio |
| P/S | Ratios → Price Sales Ratio |
| P/B | Ratios → Price Book Ratio |
| Price | Market data |
| Shares outstanding | Statistics or market-data fields |

#### Extraction procedure

1. Open the company’s TradingView market page.
2. Select Financials.
3. Choose Income Statement, Balance Sheet, Cash Flow, or Ratios.
4. Select annual, quarterly, or TTM periods.
5. Capture the value and reporting period.
6. Use the Stock Screener for standardized cross-company fields.
7. Use an authorized data interface or export capability for automation.
8. Do not use chart-indicator scripts as a substitute for source financial statements.

## 7. Data-Source Mapping

| Metric | Primary source | Secondary source | Notes |
|---|---|---|---|
| Base FCF | GuruFocus or filings | TradingView | Prefer normalized TTM or fiscal-year FCF |
| Historical FCF | GuruFocus | TradingView | Required for CAGR and normalization |
| Cash from operations | GuruFocus | TradingView | Check period and currency |
| Capital expenditures | GuruFocus | TradingView | Normalize sign convention |
| Cash and short-term investments | GuruFocus | TradingView | Avoid double-counting restricted cash |
| Total debt | GuruFocus | TradingView | Define whether leases are included |
| Diluted shares | GuruFocus | TradingView / Finviz | Use a consistent period |
| Current price | TradingView or Finviz | GuruFocus | Use the same timestamp |
| Market cap | Finviz | TradingView | Reconcile with share count |
| P/E, P/S, P/B | Finviz | TradingView | Useful for cross-checks |
| Analyst growth | GuruFocus estimates | Finviz | Verify methodology and date |
| Sector and industry | Finviz | TradingView | Used for peer selection |
| Discount rate | Derived | StockOracle examples | Exact method is undisclosed |
| Terminal growth | Model assumption | StockOracle examples | Public examples commonly show 4% |

## 8. End-to-End Build Blueprint

### Step 1: Define the valuation record

```yaml
ticker: AAPL
valuation_date: YYYY-MM-DD
currency: USD
share_class: common
period_basis: TTM
```

### Step 2: Collect financial statements

Retrieve:

- At least six years of annual FCF.
- Latest TTM FCF.
- Cash from operations.
- Capital expenditures.
- Cash and short-term investments.
- Total debt.
- Diluted shares.
- Revenue, EPS, net income, and equity for validation.

### Step 3: Normalize the data

- Convert all values to the same currency.
- Convert all values to consistent units.
- Use consistent fiscal-period dates.
- Use a consistent capex sign convention.
- Remove one-time items only when documented.
- Do not mix TTM FCF with annual shares without documenting the choice.
- Record restatements and share-count changes.

### Step 4: Select base FCF

Choose one method and document it:

**TTM method**

\[
FCF_0 = FCF_{TTM}
\]

**Six-year average**

\[
FCF_0 = \frac{FCF_t+FCF_{t-1}+...+FCF_{t-5}}{6}
\]

**Median method**

\[
FCF_0 = Median(FCF_t,...,FCF_{t-5})
\]

### Step 5: Set growth assumptions

```yaml
growth_years_1_5: 0.10
growth_years_6_10: 0.08
terminal_growth: 0.04
```

Store the source and rationale for each assumption:

```yaml
growth_years_1_5:
  value: 0.10
  source: analyst_consensus
  rationale: median_consensus_estimate
```

### Step 6: Set the discount rate

Cost-of-equity approach:

\[
r = RiskFreeRate + Beta \times EquityRiskPremium
\]

WACC approach:

\[
WACC = \frac{E}{D+E}R_e + \frac{D}{D+E}R_d(1-T)
\]

where `E` is equity value, `D` is debt, `Rₑ` is cost of equity, `R𝒹` is pre-tax cost of debt, and `T` is the tax rate.

StockOracle public examples have used a 6.61% discount rate, but this should not automatically be treated as a universal constant.

### Step 7: Forecast years 1–20

```python
fcf[0] = base_fcf

for year in range(1, 6):
    fcf[year] = base_fcf * (1 + g1) ** year

for year in range(6, 11):
    fcf[year] = base_fcf * (1 + g1) ** 5 * (1 + g2) ** (year - 5)

for year in range(11, 21):
    fcf[year] = fcf[10] * (1 + terminal_growth) ** (year - 10)
```

### Step 8: Discount the forecast

```python
pv_forecast = sum(
    fcf[year] / (1 + discount_rate) ** year
    for year in range(1, 21)
)
```

### Step 9: Calculate terminal value

```python
terminal_fcf = fcf[20] * (1 + terminal_growth)
terminal_value = terminal_fcf / (discount_rate - terminal_growth)
pv_terminal_value = terminal_value / (1 + discount_rate) ** 20
```

### Step 10: Convert to equity value

```python
enterprise_value = pv_forecast + pv_terminal_value
equity_value = enterprise_value + cash - debt
intrinsic_value_per_share = equity_value / diluted_shares
```

### Step 11: Calculate diagnostics

```python
price_to_intrinsic_value = current_price / intrinsic_value_per_share
margin_of_safety = 1 - price_to_intrinsic_value
upside = intrinsic_value_per_share / current_price - 1
```

### Step 12: Add comparable-value checks

\[
P/E = \frac{Price}{EPS}
\]

\[
P/S = \frac{MarketCapitalization}{Revenue}
\]

\[
P/B = \frac{Price}{BookValuePerShare}
\]

\[
P/FCF = \frac{Price}{FCFPerShare}
\]

Peer-based values:

\[
FairValue_{PE} = EPS_{company} \times Median(PE_{peers})
\]

\[
FairValue_{PS} = RevenuePerShare_{company} \times Median(PS_{peers})
\]

\[
FairValue_{PB} = BookValuePerShare_{company} \times Median(PB_{peers})
\]

### Step 13: Implement an OracleValue-style composite

Because the OracleValue™ weighting algorithm is undisclosed, implement a transparent substitute:

\[
OracleStyleValue = w_{DCF}V_{DCF} + w_{DFCF}V_{DFCF} + w_{DNI}V_{DNI} + w_{PE}V_{PE} + w_{PS}V_{PS} + w_{PB}V_{PB}
\]

with:

\[
\sum_i w_i = 1
\]

Illustrative starting weights—not StockOracle’s confirmed weights:

```yaml
weights:
  dcf: 0.25
  discounted_fcf: 0.25
  discounted_net_income: 0.15
  mean_pe: 0.15
  mean_ps: 0.10
  mean_pb: 0.10
```

Use different emphasis by business type:

- Cash-flow models for mature industrial companies.
- P/B and earnings models for financial companies.
- P/S and scenario DCF for early-stage growth companies.
- Dividend or normalized-earnings models for stable dividend payers.
- Mid-cycle normalization for highly cyclical companies.

### Step 14: Run sensitivity analysis

Vary at minimum:

- Near-term growth by ±5 percentage points.
- Long-term growth by ±2 percentage points.
- Discount rate by ±1–2 percentage points.
- Base FCF by ±10–20%.
- Cash and debt assumptions.
- Diluted share count.

Two-variable sensitivity table:

| Discount rate / terminal growth | 3% | 4% | 5% |
|---|---:|---:|---:|
| 5.5% | Calculate | Calculate | Calculate |
| 6.5% | Calculate | Calculate | Calculate |
| 7.5% | Calculate | Calculate | Calculate |

## 9. Recommended Output Schema

```json
{
  "ticker": "AAPL",
  "valuation_date": "YYYY-MM-DD",
  "base_fcf": 0,
  "growth_years_1_5": 0.10,
  "growth_years_6_10": 0.08,
  "terminal_growth": 0.04,
  "discount_rate": 0.0661,
  "cash_and_short_term_investments": 0,
  "total_debt": 0,
  "diluted_shares": 0,
  "pv_explicit_cash_flows": 0,
  "terminal_value": 0,
  "pv_terminal_value": 0,
  "enterprise_value": 0,
  "equity_value": 0,
  "intrinsic_value_per_share": 0,
  "current_price": 0,
  "price_to_intrinsic_value": 0,
  "margin_of_safety": 0,
  "data_sources": {
    "financial_statements": "GuruFocus",
    "market_data": "Finviz",
    "cross_check": "TradingView"
  },
  "assumptions": {
    "growth_source": "",
    "discount_rate_source": "",
    "normalization_method": ""
  }
}
```

## 10. Key Limitations

- StockOracle does not publicly disclose the complete OracleValue™ formula.
- DCF, DFCF, and intrinsic-value labels can represent different formulas across platforms.
- GuruFocus, Finviz, and TradingView use different vendors and accounting conventions.
- Financial-statement data can differ because of restatements, foreign-exchange translation, diluted-share methodology, lease treatment, and non-recurring-item adjustments.
- Valuation results are highly sensitive to growth, discount rate, terminal value, and share-count assumptions.
- The output should be treated as an analytical estimate, not a guaranteed fair price or investment recommendation.

The most reliable implementation is a transparent DFCF-20 model with explicit assumptions, source-level data lineage, independent cross-checks, and sensitivity analysis—not an attempt to claim that the reconstructed formula is the undisclosed OracleValue™ algorithm.

## Source Notes

- StockOracle public product, features, glossary, and valuation pages.
- GuruFocus valuation, financial-data, and API documentation.
- Finviz screener and export documentation.
- TradingView fundamental-analysis and financial-statement documentation.
- Research date: August 30, 2026.
