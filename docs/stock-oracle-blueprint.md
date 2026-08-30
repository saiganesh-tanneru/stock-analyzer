# Stock Oracle Intrinsic Value Modeling Blueprint
## From Fundamental Formulas to Full-Scale Implementation

This blueprint provides a comprehensive guide to understanding, calculating, and implementing the stock valuation methodologies popularized by the **Stock Oracle™** platform, developed by the **Piranha Profits®** research team under the leadership of renowned financial educator **Adam Khoo**.

The core philosophy of this approach is rooted in **Value Momentum Investing™ (VMI)**: first filtering for high-quality businesses with strong competitive moats (economic moats) and robust financial track records, and then calculating their precise intrinsic value to buy them at a significant discount (with a margin of safety) [2, 5].

---

## 1. Primary Function & Valuation Philosophy
The **Stock Oracle** platform is an AI-aided stock intelligence system designed to answer two fundamental questions for retail investors:
1. *Is this a high-quality business with strong fundamentals?* (Analyzed via the **OracleIQ™** Appraiser)
2. *Is this stock trading at a discount relative to its true worth?* (Calculated via **OracleValue™**)

### The Multi-Model Approach
Instead of relying on a single valuation model, the Stock Oracle methodology evaluates stocks across multiple lenses. It primarily uses absolute valuation models—**Discounted Free Cash Flow (DFCF)** and **Discounted Net Income (DNI)**—to project the cash or earnings a business will generate over the next 10 to 20 years, discounting those flows back to the present day [5]. 

By comparing the results of different models (such as the 10-Year or 20-Year variations), investors gain a comprehensive, conservative, and verified estimation of a stock's fair value [5].

---

## 2. Intrinsic Value Model Deconstruction
The two pillars of absolute valuation in Stock Oracle are the **Discounted Cash Flow (DCF / DFCF)** model and the **Discounted Net Income (DNI)** model [5].

### Model A: Discounted Free Cash Flow (DFCF)
This is the gold standard for companies with predictable capital expenditures and consistent cash generation from operations (such as Apple, Microsoft, or Alphabet).

### Model B: Discounted Net Income (DNI)
This model is used when a company has inconsistent capital expenditures or operates in sectors where cash flow is highly volatile or difficult to project (e.g., banks, insurance companies, or mature manufacturers with high capital cycles) but maintains stable and growing net earnings.

### Core Mathematical Formulas
Both models share an identical structural backbone, differing only in the starting metric ($OCF_0$ vs. $NI_0$) and the growth rates applied.

#### Step 1: Future Value Projections
Future cash flows or earnings are projected over a specified horizon (typically $N = 10$ or $N = 20$ years) using segmented growth rates:
*   **Years 1 to 5 ($g_{1-5}$):** High-growth phase, typically aligned with historical trends and analyst estimates.
*   **Years 6 to 10 ($g_{6-10}$):** Transition phase, where growth is conservatively reduced (often capped or halved).
*   **Years 11 to 20 ($g_{11-20}$):** Terminal growth phase, approaching a mature growth rate (often capped around 3% to 5% or the rate of inflation).

$$\text{Metric}_t = \begin{cases} 
\text{Metric}_{t-1} \times (1 + g_{1-5}) & \text{for } t \in [1, 5] \\
\text{Metric}_{t-1} \times (1 + g_{6-10}) & \text{for } t \in [6, 10] \\
\text{Metric}_{t-1} \times (1 + g_{11-20}) & \text{for } t \in [11, 20] 
\end{cases}$$

#### Step 2: Discounting to Present Value
The projected values are discounted back to the present day using a discount factor ($DF_t$) derived from the company’s specific risk profile (Discount Rate, $r$):

$$DF_t = \frac{1}{(1 + r)^t}$$

$$PV_t = \text{Metric}_t \times DF_t$$

Summing these discounted values gives the total Present Value of Future Cash Flows ($PV_{\text{Total}}$):

$$PV_{\text{Total}} = \sum_{t=1}^{N} \left( \text{Metric}_t \times \frac{1}{(1 + r)^t} \right)$$

#### Step 3: Cash & Debt Adjustments (The Valuation Bridge)
To move from the present value of the business operations (Enterprise/Business Value) to the final Intrinsic Value of Equity, we perform a net-debt adjustment. We add cash and short-term investments (which belong to shareholders) and subtract total outstanding debt (which must be paid off):

$$\text{Total Intrinsic Value of Equity} = PV_{\text{Total}} + \text{Cash & Short-Term Investments} - \text{Total Debt}$$

#### Step 4: Division by Shares Outstanding
To calculate the Intrinsic Value Per Share, the Total Intrinsic Value of Equity is divided by the diluted shares outstanding:

$$\text{Intrinsic Value Per Share} = \frac{PV_{\text{Total}} + \text{Cash & Short-Term Investments} - \text{Total Debt}}{\text{Shares Outstanding}}$$

Or, calculated on a per-share basis:

$$\text{Intrinsic Value Per Share} = \text{PV per Share} + \text{Cash per Share} - \text{Debt per Share}$$

---

## 3. The Risk Framework: Beta & Discount Rate Mapping
In the Value Momentum Investing™ system, the **Discount Rate ($r$)** is not arbitrary. Instead of using the complex Capital Asset Pricing Model (CAPM) or WACC, Adam Khoo utilizes a highly practical **Beta-to-Discount-Rate mapping table**. 

Beta measures the stock's price volatility relative to the broader market. A higher Beta indicates higher risk, requiring a higher Discount Rate to provide a margin of safety.

### US Stock Discount Rate Matrix
For US-listed companies, the standard mapping is as follows:

| Beta Range | Discount Rate ($r$) | Risk Profile Classification |
|---|---|---|
| **Beta < 0.80** | **4.6% to 5.0%** | Exceptionally Stable / Low Volatility (e.g., Utilities, Consumer Staples) |
| **0.80 ≤ Beta < 1.05** | **6.0%** | Market-Average Volatility (e.g., Mega-cap Tech, Mature Growth) |
| **1.05 ≤ Beta < 1.15** | **6.8%** | Moderate Growth / Moderate Volatility |
| **1.15 ≤ Beta < 1.25** | **7.0%** | Above-Average Growth & Volatility |
| **1.25 ≤ Beta < 1.35** | **7.9%** | High Volatility / Cyclical |
| **1.35 ≤ Beta < 1.45** | **8.0%** | Dynamic High-Growth / High Volatility |
| **1.45 ≤ Beta < 1.55** | **8.9%** | Speculative / Emerging Sector Volatility |
| **Beta ≥ 1.55** | **9.0% to 12.0%+** | Extreme Volatility / Unpredictable (e.g., Biotech, Micro-caps, turnaround plays) |

### International Adjustments (China / Hong Kong Stocks)
Because international emerging markets have higher structural, currency, and regulatory risks, the discount rate is adjusted upward. For China/Hong Kong-listed companies:
*   **Beta < 0.80:** Discount Rate starts at **8.1%** (rather than 4.6% to 5.0%).
*   **High Volatility (Beta > 1.20):** Discount rates typically range from **10.0% to 15.0%**.

---

## 4. Required Financial Metrics Checklist
To execute either the DFCF or DNI valuation model from scratch, you must gather the following six critical metrics:

1.  **Operating Cash Flow ($OCF_0$):** Sourced as Trailing Twelve Months (TTM) or Last Fiscal Year (LFY) in millions. (Required for DFCF model).
2.  **Net Income ($NI_0$):** Sourced as TTM or LFY in millions. (Required for DNI model).
3.  **Total Debt ($D$):** Sourced from the latest quarterly balance sheet in millions. Sum of short-term debt, current portion of long-term debt, and long-term debt.
4.  **Cash & Short-Term Investments ($C$):** Sourced from the latest quarterly balance sheet in millions. Sum of cash, cash equivalents, and marketable securities.
5.  **Shares Outstanding ($S$):** Diluted shares outstanding currently active in the market (in millions).
6.  **Beta:** 5-year monthly regression coefficient of the stock relative to the index.

---

## 5. Sourcing Pathways: GuruFocus, Finviz, and TradingView

| Required Metric | GuruFocus Extraction Pathway | Finviz Extraction Pathway | TradingView Extraction Pathway |
|---|---|---|---|
| **Operating Cash Flow (OCF)** | **Location:** Ticker > "Financials" tab > "Cash Flow" sub-tab.<br>**Row Name:** "Operating Cash Flow" (TTM or LFY) | *Free tier does not provide absolute dollar values in the main dashboard.* Use **Financial** screener view or scroll to **Financial Statements** at the bottom of the stock page. | **Location:** Ticker > "Supercharts" > "Financials" icon (top bar) > "Cash flow" tab.<br>**Row Name:** "Cash flow from operating activities" |
| **Net Income** | **Location:** Ticker > "Financials" tab > "Income Statement" sub-tab.<br>**Row Name:** "Net Income" | *Free tier does not provide absolute values.* Locate **Financial Statements** at the bottom or calculate by multiplying Market Cap by Net Profit Margin. | **Location:** Ticker > "Supercharts" > "Financials" icon > "Income statement" tab.<br>**Row Name:** "Net income" |
| **Total Debt** | **Location:** Ticker > "Financials" tab > "Balance Sheet" sub-tab.<br>**Row Name:** "Total Debt" (autocalculated) or sum "Short-Term Debt" + "Long-Term Debt". | **Location:** Key statistics table below chart.<br>**Cell:** Look for **"Debt/Eq"** (Total Debt-to-Equity) and multiply by Shareholder's Equity, or calculate using **"LT Debt/Eq"**. | **Location:** Ticker > "Supercharts" > "Financials" icon > "Balance sheet" tab.<br>**Row Name:** "Total debt" |
| **Cash & Short-Term Investments** | **Location:** Ticker > "Financials" tab > "Balance Sheet" sub-tab.<br>**Row Name:** "Cash, Cash Equivalents & Marketable Securities". | *Not in standard table.* Extract from bottom **Statements** links or use external Balance Sheet tool. | **Location:** Ticker > "Supercharts" > "Financials" icon > "Balance sheet" tab.<br>**Row Name:** "Cash and short-term investments" |
| **Shares Outstanding** | **Location:** Ticker > "Financials" tab > "Income Statement" sub-tab.<br>**Row Name:** "Shares Outstanding (Diluted TTM)". | **Location:** Snapshot grid below price chart.<br>**Cell:** Look for **"Shs Outstand"** (e.g., `289.94M`). | **Location:** Ticker > "Supercharts" > "Financials" icon > "Statistics" tab.<br>**Row Name:** "Diluted shares outstanding" |
| **Beta (5-Year)** | **Location:** Main stock overview header > "Key Statistics" box or "Beta" metric. | **Location:** Snapshot grid below price chart.<br>**Cell:** Look for **"Beta"** (e.g., `1.12`). | **Location:** Advanced Watchlist view > "Financials" or "Risk" tab, or Symbol Overview page statistics. |
| **Growth Projections ($g_{1-5}$)** | **Location:** "Analysis" tab > "Growth Estimates" or historical growth CAGRs under the "Financials" overview. | **Location:** Snapshot grid below price chart.<br>**Cell:** Look for **"EPS next 5Y"** (e.g., `17.32%`). Excellent proxy for $g_{1-5}$. | **Location:** Main Symbol Page > "Forecast" section > "Actuals and estimates" tab > consensus estimates for OCF/Net Income. |

---

## 6. Mathematical Implementation Code (Python)
Below is a clean, production-grade Python script designed to execute both the **10-Year and 20-Year DFCF & DNI** models from scratch using standard libraries (`pandas` and `numpy`). This script takes user inputs, applies the Beta mapping, performs cash-flow projections, handles the enterprise-to-equity bridge, and prints a formatted report.

You can save this script as `valuation_model.py` and run it locally.

```python
import pandas as pd
import numpy as np

def get_discount_rate(beta, is_us_stock=True):
    """
    Maps Beta to Discount Rate based on Adam Khoo's Value Momentum Investing framework.
    """
    if is_us_stock:
        if beta < 0.80:
            return 0.050  # 5.0%
        elif beta < 1.05:
            return 0.060  # 6.0%
        elif beta < 1.15:
            return 0.068  # 6.8%
        elif beta < 1.25:
            return 0.070  # 7.0%
        elif beta < 1.35:
            return 0.079  # 7.9%
        elif beta < 1.45:
            return 0.080  # 8.0%
        elif beta < 1.55:
            return 0.089  # 8.9%
        else:
            return 0.100  # 10.0%+ for highly volatile stocks
    else:
        # China/HK Stock adjustment
        if beta < 0.80:
            return 0.081
        elif beta < 1.20:
            return 0.100
        else:
            return 0.120

def run_valuation_model(
    ticker,
    starting_metric,
    total_debt,
    total_cash,
    shares_outstanding,
    beta,
    g_1_5,
    g_6_10,
    g_11_20=0.03,
    model_years=20,
    is_us_stock=True
):
    """
    Runs the intrinsic value model (DFCF or DNI) over 10 or 20 years.
    All dollar metrics must be in the same units (e.g., Millions).
    """
    # 1. Determine Discount Rate
    discount_rate = get_discount_rate(beta, is_us_stock)
    
    # 2. Build Projections Table
    years = list(range(1, model_years + 1))
    projected_metrics = []
    current_value = starting_metric
    
    for yr in years:
        if yr <= 5:
            current_value = current_value * (1 + g_1_5)
        elif yr <= 10:
            current_value = current_value * (1 + g_6_10)
        else:
            current_value = current_value * (1 + g_11_20)
        
        projected_metrics.append(current_value)
    
    # 3. Calculate Discount Factors and Present Values
    discount_factors = [1 / ((1 + discount_rate) ** yr) for yr in years]
    present_values = [m * df for m, df in zip(projected_metrics, discount_factors)]
    
    # Create DataFrame
    df_projections = pd.DataFrame({
        'Year': years,
        'Projected_Metric': projected_metrics,
        'Discount_Factor': discount_factors,
        'Present_Value': present_values
    })
    
    # 4. Bridge to Equity Value
    pv_sum = sum(present_values)
    intrinsic_equity_value = pv_sum + total_cash - total_debt
    intrinsic_value_per_share = intrinsic_equity_value / shares_outstanding
    
    return {
        'projections': df_projections,
        'discount_rate': discount_rate,
        'pv_sum': pv_sum,
        'equity_value': intrinsic_equity_value,
        'intrinsic_value_per_share': intrinsic_value_per_share
    }

# Example execution for a Microsoft-like setup in 2019 [5]
# Figures in Millions, except Shares and Beta
results_dcf = run_valuation_model(
    ticker="MSFT",
    starting_metric=52190.0,      # Operating Cash Flow [5]
    total_debt=66662.0,           # Short-Term + Long-Term Debt [5]
    total_cash=133819.0,          # Cash and Short-Term Investments [5]
    shares_outstanding=7635.4,    # Diluted Shares Outstanding [5]
    beta=0.9,                     # Standard Beta
    g_1_5=0.1453,                 # Year 1-5 Growth (14.53%) [5]
    g_6_10=0.1453,                # Year 6-10 Growth (14.53%) [5]
    g_11_20=0.048,                # Year 11-20 Growth (conservative terminal growth) [5]
    model_years=20,
    is_us_stock=True
)

print(f"--- MSFT Intrinsic Value Report (20-Year DFCF Model) ---")
print(f"Discount Rate Used: {results_dcf['discount_rate'] * 100:.1f}%")
print(f"Sum of Present Value of Cash Flows: ${results_dcf['pv_sum']:,.2f} Million")
print(f"Adjusted Equity Value: ${results_dcf['equity_value']:,.2f} Million")
print(f"Diluted Shares Outstanding: {7635.4:,.1f} Million")
print(f"Calculated Intrinsic Value Per Share: ${results_dcf['intrinsic_value_per_share']:.2f}")
```

---

## 7. The 7-Step Quality Filtering Checklist
Valuation calculations are meaningless if performed on poor-quality or unpredictable businesses ("garbage in, garbage out"). Before using this blueprint to value a stock, you must ensure the business passes the **Value Momentum Investing™** quality filters [5]:

1.  **Consistent Earnings Growth:** Net Profit and EPS must show a consistent upward trend over the past 5 to 10 years [5].
2.  **Consistent Sales/Revenue Growth:** Top-line growth must consistently back bottom-line earnings [5].
3.  **Consistent Operating Cash Flow Growth:** Real cash must be growing alongside net income (verifying the quality of earnings) [5].
4.  **High Return on Equity (ROE):** The company should maintain an ROE > 12% to 15% consistently [5].
5.  **High Return on Invested Capital (ROIC):** The business must efficiently allocate capital (ROIC > 12%).
6.  **Conservative Debt Levels:** Long-term debt should be fully coverable by less than 3 times the company’s annual Net Profit (or Cash from Operations) [5].
7.  **Durable Economic Moat:** The business must possess a clear, sustainable competitive advantage (brand power, network effect, cost advantages, high switching costs) that protects future cash flows from competitors [2, 5].

Once these parameters are verified, apply a **20% to 30% Margin of Safety** (discount) to the calculated intrinsic value per share to define your maximum buy level.
