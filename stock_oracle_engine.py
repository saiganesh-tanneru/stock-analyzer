"""
Stock Oracle 3-Thesis Valuation & Analysis Engine
=================================================
Implements the 3 research thesis reports from docs/:
1. Thesis 1: Adam Khoo VMI Intrinsic Value Blueprint (stock-oracle-blueprint.md)
2. Thesis 2: Academic DFCF-20 + Gordon Perpetuity + Composite Blueprint (stockoracle_valuation_blueprint.md)
3. Thesis 3: Dynamic Multi-Modal Routing & OracleIQ™ 6-Dimension Blueprint (A Comprehensive Blueprint for Algorithmic.md)
"""

import math
import re
import numpy as np
import pandas as pd


def parse_num(val):
    """Parses formatted financial numbers into floats (handles B, M, K, T, %, $)."""
    if val is None or val == '' or val == '-' or val == 'nan':
        return None
    if isinstance(val, (int, float)):
        return float(val) if not math.isnan(val) else None
        
    s = str(val).strip().replace('$', '').replace(',', '')
    if not s or s == '-':
        return None
        
    mult = 1.0
    if s.endswith('T') or s.endswith('t'):
        mult = 1e12
        s = s[:-1]
    elif s.endswith('B') or s.endswith('b'):
        mult = 1e9
        s = s[:-1]
    elif s.endswith('M') or s.endswith('m'):
        mult = 1e6
        s = s[:-1]
    elif s.endswith('K') or s.endswith('k'):
        mult = 1e3
        s = s[:-1]
    elif s.endswith('%'):
        mult = 0.01
        s = s[:-1]
        
    try:
        # Handle multi-part numbers like "10.20% 10.20%" or "553.72 -7.26%"
        parts = s.split()
        if len(parts) > 1:
            s = parts[0]
        return float(s) * mult
    except Exception:
        return None


def get_discount_rate_khoo(beta, is_us_stock=True):
    """
    Adam Khoo's Beta-to-Discount-Rate mapping matrix (Thesis 1 & VMI framework).
    """
    if beta is None or beta <= 0:
        beta = 1.0  # Default to market beta
        
    if is_us_stock:
        if beta < 0.80:
            return 0.050, "Beta < 0.80 -> 5.0% (Stable/Defensive)"
        elif beta < 1.05:
            return 0.060, "0.80 <= Beta < 1.05 -> 6.0% (Market Average)"
        elif beta < 1.15:
            return 0.068, "1.05 <= Beta < 1.15 -> 6.8% (Moderate Volatility)"
        elif beta < 1.25:
            return 0.070, "1.15 <= Beta < 1.25 -> 7.0% (Above-Average Growth)"
        elif beta < 1.35:
            return 0.079, "1.25 <= Beta < 1.35 -> 7.9% (High Volatility/Cyclical)"
        elif beta < 1.45:
            return 0.080, "1.35 <= Beta < 1.45 -> 8.0% (Dynamic High-Growth)"
        elif beta < 1.55:
            return 0.089, "1.45 <= Beta < 1.55 -> 8.9% (Speculative/Emerging)"
        else:
            return 0.100, "Beta >= 1.55 -> 10.0% (Extreme Volatility)"
    else:
        # China/HK / International Adjustment
        if beta < 0.80:
            return 0.081, "Beta < 0.80 -> 8.1% (International Defensive)"
        elif beta < 1.20:
            return 0.100, "0.80 <= Beta < 1.20 -> 10.0% (International Average)"
        else:
            return 0.120, "Beta >= 1.20 -> 12.0% (International High Risk)"


def extract_stock_fundamentals(stock_dict):
    """
    Sanitizes and extracts all fundamental numbers required by the 3 thesis models.
    """
    ticker = str(stock_dict.get('Ticker', stock_dict.get('symbol', ''))).strip().upper()
    name = str(stock_dict.get('Name', ticker)).strip()
    sector = str(stock_dict.get('Sector', '')).strip()
    sub_sector = str(stock_dict.get('Sub-Sector', '')).strip()
    country = str(stock_dict.get('Country', 'USA')).strip()
    is_us_stock = ('USA' in country or 'United States' in country or country == '')

    price = parse_num(stock_dict.get('Price', stock_dict.get('TV Close', 0))) or 0.0
    market_cap = parse_num(stock_dict.get('Market Cap')) or (price * 1e9 if price else 0)
    shs_outstand = parse_num(stock_dict.get('Shs Outstand')) or (market_cap / price if price > 0 else 1.0)
    
    # Financial metrics
    sales = parse_num(stock_dict.get('Sales')) or 0.0
    income = parse_num(stock_dict.get('Income')) or 0.0
    book_sh = parse_num(stock_dict.get('Book/sh')) or 0.0
    cash_sh = parse_num(stock_dict.get('Cash/sh')) or 0.0
    total_cash = cash_sh * shs_outstand if cash_sh and shs_outstand else 0.0
    
    # Valuation multiples
    pe = parse_num(stock_dict.get('P/E'))
    forward_pe = parse_num(stock_dict.get('Forward P/E'))
    ps = parse_num(stock_dict.get('P/S'))
    pb = parse_num(stock_dict.get('P/B'))
    pfcf = parse_num(stock_dict.get('P/FCF'))
    ev_ebitda = parse_num(stock_dict.get('EV/EBITDA'))
    debt_eq = parse_num(stock_dict.get('Debt/Eq')) or 0.0
    
    # Calculate Total Debt
    # Total Debt = Debt/Eq * Total Equity = Debt/Eq * (Book/sh * Shs Outstand)
    total_equity = book_sh * shs_outstand if (book_sh and shs_outstand) else (market_cap / pb if (pb and pb > 0) else market_cap * 0.5)
    total_debt = debt_eq * total_equity if total_equity else 0.0
    
    # Derive Free Cash Flow (FCF) and Operating Cash Flow (OCF)
    fcf = 0.0
    if pfcf and pfcf > 0:
        fcf = market_cap / pfcf
    elif income > 0:
        fcf = income * 1.15  # standard approximation for cash-generative firms
    else:
        fcf = 0.0
        
    # OCF is typically FCF + CapEx (approx 1.25x FCF or derived from income)
    ocf = fcf * 1.25 if fcf > 0 else (income * 1.35 if income > 0 else 0.0)

    # Beta & Growth
    beta = parse_num(stock_dict.get('Beta')) or 1.0
    eps_next_5y = parse_num(stock_dict.get('EPS next 5Y'))  # e.g. 0.1829
    sales_past_5y = parse_num(stock_dict.get('Sales past 3/5Y'))
    eps_past_5y = parse_num(stock_dict.get('EPS past 3/5Y'))
    sales_yy = parse_num(stock_dict.get('Sales Y/Y TTM'))
    
    # Determine base near-term growth rate g1
    if eps_next_5y is not None:
        g1 = max(-0.15, min(0.40, eps_next_5y))
    elif sales_past_5y is not None and sales_past_5y > 0:
        g1 = max(0.04, min(0.30, sales_past_5y))
    elif eps_past_5y is not None and eps_past_5y > 0:
        g1 = max(0.04, min(0.30, eps_past_5y))
    else:
        g1 = 0.10  # default 10%
        
    # Efficiency and Moat
    roe = parse_num(stock_dict.get('ROE')) or 0.0
    roic = parse_num(stock_dict.get('ROIC')) or 0.0
    gross_margin = parse_num(stock_dict.get('Gross Margin')) or 0.0
    oper_margin = parse_num(stock_dict.get('Oper. Margin')) or 0.0
    profit_margin = parse_num(stock_dict.get('Profit Margin')) or 0.0
    wacc = parse_num(stock_dict.get('WACC')) or 7.5
    gf_value = parse_num(stock_dict.get('GF Value'))
    gf_valuation = stock_dict.get('GF Valuation', '')
    analyst_target = parse_num(stock_dict.get('Analyst Target'))
    
    # Financial Strength
    f_score = stock_dict.get('Piotroski F-Score', '')
    z_score = parse_num(stock_dict.get('Altman Z-Score'))
    current_ratio = parse_num(stock_dict.get('Current Ratio')) or 1.0

    return {
        'ticker': ticker,
        'name': name,
        'sector': sector,
        'sub_sector': sub_sector,
        'country': country,
        'is_us_stock': is_us_stock,
        'price': price,
        'market_cap': market_cap,
        'shs_outstand': shs_outstand,
        'sales': sales,
        'income': income,
        'book_sh': book_sh,
        'cash_sh': cash_sh,
        'total_cash': total_cash,
        'total_debt': total_debt,
        'total_equity': total_equity,
        'pe': pe,
        'forward_pe': forward_pe,
        'ps': ps,
        'pb': pb,
        'pfcf': pfcf,
        'ev_ebitda': ev_ebitda,
        'debt_eq': debt_eq,
        'fcf': fcf,
        'ocf': ocf,
        'beta': beta,
        'eps_next_5y': eps_next_5y,
        'sales_past_5y': sales_past_5y,
        'eps_past_5y': eps_past_5y,
        'sales_yy': sales_yy,
        'g1': g1,
        'roe': roe,
        'roic': roic,
        'gross_margin': gross_margin,
        'oper_margin': oper_margin,
        'profit_margin': profit_margin,
        'wacc': wacc,
        'gf_value': gf_value,
        'gf_valuation': gf_valuation,
        'analyst_target': analyst_target,
        'f_score': f_score,
        'z_score': z_score,
        'current_ratio': current_ratio,
        'raw_dict': stock_dict
    }


# ==============================================================================
# THESIS 1: Adam Khoo VMI Core Model (stock-oracle-blueprint.md)
# ==============================================================================
def calculate_thesis_1_vmi(f, model_years=20, custom_g1=None, custom_g2=None, custom_g3=None, custom_r=None):
    """
    Implements Thesis 1: Adam Khoo Value Momentum Investing (VMI) 20-Year DFCF / DNI Model.
    - Beta-to-Discount-Rate mapping table.
    - Staged growth (Years 1-5 g1, Years 6-10 g2, Years 11-20 terminal g3).
    - Enterprise to Equity bridge (PV + Cash - Debt) / Shares.
    - 7-Step Quality Filtering Checklist.
    - 20% & 30% Margin of Safety Buy Zones.
    """
    is_us = f['is_us_stock']
    beta = f['beta']
    
    # 1. Discount Rate from Beta mapping
    mapped_r, r_reason = get_discount_rate_khoo(beta, is_us)
    discount_rate = custom_r if custom_r is not None else mapped_r
    
    # 2. Starting Metric: OCF or FCF
    # If financial sector, use Net Income
    is_financial = ('financial' in f['sector'].lower() or 'bank' in f['sub_sector'].lower() or 'insurance' in f['sub_sector'].lower())
    starting_metric = f['income'] if is_financial else (f['ocf'] if f['ocf'] > 0 else f['income'])
    metric_name = "Net Income" if is_financial else "Operating Cash Flow"

    # 3. Growth Staging
    g_1_5 = custom_g1 if custom_g1 is not None else f['g1']
    g_6_10 = custom_g2 if custom_g2 is not None else (g_1_5 * 0.75 if g_1_5 > 0.08 else g_1_5)
    g_11_20 = custom_g3 if custom_g3 is not None else 0.040  # 4% terminal growth

    # 4. Projections Table
    projections = []
    current_val = starting_metric
    pv_sum = 0.0
    
    for yr in range(1, model_years + 1):
        if yr <= 5:
            current_val = current_val * (1 + g_1_5)
            growth_used = g_1_5
        elif yr <= 10:
            current_val = current_val * (1 + g_6_10)
            growth_used = g_6_10
        else:
            current_val = current_val * (1 + g_11_20)
            growth_used = g_11_20
            
        df = 1.0 / ((1.0 + discount_rate) ** yr)
        pv = current_val * df
        pv_sum += pv
        
        projections.append({
            'year': yr,
            'projected_metric': current_val,
            'growth_rate': growth_used,
            'discount_factor': df,
            'present_value': pv,
            'cumulative_pv': pv_sum
        })

    # 5. Enterprise to Equity Bridge
    total_cash = f['total_cash']
    total_debt = f['total_debt']
    shares = f['shs_outstand'] if f['shs_outstand'] > 0 else 1.0
    
    operational_pv = pv_sum
    operational_pv_per_share = operational_pv / shares
    cash_per_share = total_cash / shares
    debt_per_share = total_debt / shares
    net_debt_adj_per_share = cash_per_share - debt_per_share
    
    equity_value = operational_pv + total_cash - total_debt
    intrinsic_value_per_share = max(0.0, equity_value / shares)
    
    # 6. Diagnostics & Buy Zones
    price = f['price']
    margin_of_safety_pct = ((intrinsic_value_per_share - price) / intrinsic_value_per_share * 100.0) if intrinsic_value_per_share > 0 else -100.0
    price_to_iv = price / intrinsic_value_per_share if intrinsic_value_per_share > 0 else 999.0
    
    buy_under_30_pct = intrinsic_value_per_share * 0.70  # Conservative 30% discount
    buy_under_20_pct = intrinsic_value_per_share * 0.80  # Moderate 20% discount

    if price <= buy_under_30_pct:
        signal = "Strong Buy (>=30% MoS)"
        signal_badge = "success"
    elif price <= buy_under_20_pct:
        signal = "Buy (>=20% MoS)"
        signal_badge = "success"
    elif price <= intrinsic_value_per_share:
        signal = "Fair Value / Hold"
        signal_badge = "warning"
    elif price <= intrinsic_value_per_share * 1.25:
        signal = "Modestly Overvalued"
        signal_badge = "danger"
    else:
        signal = "Significantly Overvalued"
        signal_badge = "danger"

    # 7. VMI 7-Step Quality Filtering Checklist
    pass_earnings = (f['eps_past_5y'] is not None and f['eps_past_5y'] > 0) or (f['income'] > 0)
    pass_sales = (f['sales_past_5y'] is not None and f['sales_past_5y'] > 0) or (f['sales_yy'] is not None and f['sales_yy'] > 0)
    pass_ocf = (f['ocf'] > 0) and (f['oper_margin'] > 0.08)
    pass_roe = (f['roe'] >= 0.12)
    pass_roic = (f['roic'] >= 0.10)
    debt_coverage = (total_debt / f['income']) if f['income'] > 0 else 99.0
    pass_debt = (debt_coverage < 3.5 or f['debt_eq'] < 0.8)
    pass_moat = (f['roic'] > (f['wacc'] * 0.01 + 0.02)) or (f['gross_margin'] > 0.45)
    
    checklist = [
        {'id': 1, 'name': 'Consistent Earnings Growth', 'passed': bool(pass_earnings), 'desc': f"EPS growth / profitability positive (Income: ${f['income']/1e9:.2f}B)" if f['income'] else 'Negative or unstable earnings'},
        {'id': 2, 'name': 'Consistent Sales Growth', 'passed': bool(pass_sales), 'desc': f"Sales 5Y: {f['sales_past_5y']*100:.1f}%" if f['sales_past_5y'] is not None else f"Sales: ${f['sales']/1e9:.2f}B"},
        {'id': 3, 'name': 'Operating Cash Flow Quality', 'passed': bool(pass_ocf), 'desc': f"Operating Margin: {f['oper_margin']*100:.1f}%"},
        {'id': 4, 'name': 'High Return on Equity (ROE >= 12%)', 'passed': bool(pass_roe), 'desc': f"ROE: {f['roe']*100:.1f}% (Target: >=12%)"},
        {'id': 5, 'name': 'High Return on Invested Capital (ROIC >= 10%)', 'passed': bool(pass_roic), 'desc': f"ROIC: {f['roic']*100:.1f}% (Target: >=10%)"},
        {'id': 6, 'name': 'Conservative Debt (<3.5x Net Profit)', 'passed': bool(pass_debt), 'desc': f"Debt/Profit: {debt_coverage:.1f}x, D/E: {f['debt_eq']:.2f}"},
        {'id': 7, 'name': 'Durable Economic Moat', 'passed': bool(pass_moat), 'desc': f"ROIC ({f['roic']*100:.1f}%) vs WACC ({f['wacc']:.1f}%), GM: {f['gross_margin']*100:.1f}%"}
    ]
    quality_score = sum(1 for c in checklist if c['passed'])

    return {
        'model_name': 'Thesis 1: Adam Khoo VMI Core Model',
        'short_name': 'Adam Khoo VMI',
        'document_source': 'stock-oracle-blueprint.md',
        'intrinsic_value': round(intrinsic_value_per_share, 2),
        'margin_of_safety_pct': round(margin_of_safety_pct, 1),
        'price_to_iv': round(price_to_iv, 2),
        'signal': signal,
        'signal_badge': signal_badge,
        'buy_under_30_pct': round(buy_under_30_pct, 2),
        'buy_under_20_pct': round(buy_under_20_pct, 2),
        'starting_metric_name': metric_name,
        'starting_metric_value': starting_metric,
        'discount_rate': discount_rate,
        'discount_rate_pct': round(discount_rate * 100.0, 2),
        'discount_rate_reason': r_reason,
        'beta_used': beta,
        'growth_years_1_5': g_1_5,
        'growth_years_6_10': g_6_10,
        'growth_years_11_20': g_11_20,
        'operational_pv': operational_pv,
        'operational_pv_per_share': round(operational_pv_per_share, 2),
        'cash_per_share': round(cash_per_share, 2),
        'debt_per_share': round(debt_per_share, 2),
        'net_debt_adj_per_share': round(net_debt_adj_per_share, 2),
        'equity_value': equity_value,
        'shares_outstanding': shares,
        'projections': projections,
        'quality_checklist': checklist,
        'quality_score': f"{quality_score}/7"
    }


# ==============================================================================
# THESIS 2: Academic DFCF-20 + Gordon Perpetuity + Composite (stockoracle_valuation_blueprint.md)
# ==============================================================================
def calculate_thesis_2_academic(f, custom_g1=None, custom_g2=None, custom_gT=None, custom_r=None):
    """
    Implements Thesis 2: Academic DFCF-20 with Gordon Growth Perpetuity Terminal Value
    + Multi-Model Valuation Suite (DCF, DFCF, DNI, Fair P/E, Fair P/S, Fair P/B)
    + Composite OracleStyleValue
    + 2-Variable Sensitivity Analysis Matrix (r vs gT).
    """
    # 1. Base Free Cash Flow FCF0
    fcf0 = f['fcf'] if f['fcf'] > 0 else (f['income'] if f['income'] > 0 else 1.0)
    shares = f['shs_outstand'] if f['shs_outstand'] > 0 else 1.0
    
    # 2. Growth Rates
    g1 = custom_g1 if custom_g1 is not None else f['g1']
    g2 = custom_g2 if custom_g2 is not None else max(0.05, g1 * 0.75)
    gT = custom_gT if custom_gT is not None else 0.040  # 4% terminal growth
    
    # 3. Discount Rate: Cost of Equity / WACC / 6.61% standard StockOracle benchmark
    cost_of_equity = 0.042 + f['beta'] * 0.050
    default_r = min(0.12, max(0.055, cost_of_equity))
    discount_rate = custom_r if custom_r is not None else default_r

    # Ensure r > gT for Gordon Growth
    effective_r = max(discount_rate, gT + 0.01)

    # 4. 20-Year Cash Flow Projections
    projections = []
    pv_forecast = 0.0
    fcf_t = fcf0
    
    for t in range(1, 21):
        if t <= 5:
            fcf_t = fcf0 * ((1 + g1) ** t)
            growth_used = g1
        elif t <= 10:
            fcf_t = fcf0 * ((1 + g1) ** 5) * ((1 + g2) ** (t - 5))
            growth_used = g2
        else:
            fcf_10 = fcf0 * ((1 + g1) ** 5) * ((1 + g2) ** 5)
            fcf_t = fcf_10 * ((1 + gT) ** (t - 10))
            growth_used = gT
            
        df = 1.0 / ((1.0 + discount_rate) ** t)
        pv = fcf_t * df
        pv_forecast += pv
        
        projections.append({
            'year': t,
            'projected_fcf': fcf_t,
            'growth_rate': growth_used,
            'discount_factor': df,
            'present_value': pv,
            'cumulative_pv': pv_forecast
        })

    # 5. Gordon Growth Terminal Value after Year 20
    fcf_20 = projections[-1]['projected_fcf']
    terminal_fcf = fcf_20 * (1 + gT)
    terminal_value_20 = terminal_fcf / (effective_r - gT)
    pv_terminal_value = terminal_value_20 / ((1.0 + discount_rate) ** 20)
    
    # 6. Enterprise Value to Equity Value Bridge
    enterprise_value = pv_forecast + pv_terminal_value
    total_cash = f['total_cash']
    total_debt = f['total_debt']
    equity_value = enterprise_value + total_cash - total_debt
    intrinsic_value_dfcf20 = max(0.0, equity_value / shares)

    # 7. Multi-Model Valuation Suite (DCF, DFCF, DNI, Fair P/E, Fair P/S, Fair P/B)
    eps = (f['income'] / shares) if (f['income'] and shares) else (f['price'] / f['pe'] if f['pe'] else 0)
    sales_per_sh = (f['sales'] / shares) if (f['sales'] and shares) else (f['price'] / f['ps'] if f['ps'] else 0)
    book_per_sh = f['book_sh']
    
    # Baseline benchmarks
    benchmark_pe = 22.0
    benchmark_ps = 3.8
    benchmark_pb = 4.0
    
    v_dcf = pv_forecast / shares + (total_cash - total_debt) / shares  # Without perpetuity TV
    v_dfcf = intrinsic_value_dfcf20                                      # With perpetuity TV
    v_dni = (f['income'] * 15.0 + total_cash - total_debt) / shares if f['income'] else v_dfcf * 0.9
    v_pe = max(0.0, eps * benchmark_pe)
    v_ps = max(0.0, sales_per_sh * benchmark_ps)
    v_pb = max(0.0, book_per_sh * benchmark_pb)
    
    composite_weights = {
        'dcf': 0.25,
        'dfcf': 0.25,
        'dni': 0.15,
        'pe': 0.15,
        'ps': 0.10,
        'pb': 0.10
    }
    
    composite_fair_value = (
        composite_weights['dcf'] * v_dcf +
        composite_weights['dfcf'] * v_dfcf +
        composite_weights['dni'] * v_dni +
        composite_weights['pe'] * v_pe +
        composite_weights['ps'] * v_ps +
        composite_weights['pb'] * v_pb
    )

    # 8. 2-Variable Sensitivity Analysis Matrix (Discount Rate vs Terminal Growth)
    r_variants = [discount_rate - 0.015, discount_rate, discount_rate + 0.015]
    gT_variants = [0.030, 0.040, 0.050]
    
    sensitivity_matrix = []
    for r_test in r_variants:
        row = {'discount_rate': round(r_test * 100, 2), 'values': []}
        for g_test in gT_variants:
            if r_test <= g_test:
                eff_r_test = g_test + 0.008
            else:
                eff_r_test = r_test
                
            test_pv_fc = sum(
                p['projected_fcf'] / ((1.0 + r_test) ** p['year'])
                for p in projections
            )
            test_tv = (fcf_20 * (1 + g_test)) / (eff_r_test - g_test)
            test_pv_tv = test_tv / ((1.0 + r_test) ** 20)
            test_eq = test_pv_fc + test_pv_tv + total_cash - total_debt
            test_iv = max(0.0, test_eq / shares)
            
            row['values'].append({
                'terminal_growth': round(g_test * 100, 1),
                'intrinsic_value': round(test_iv, 2)
            })
        sensitivity_matrix.append(row)

    # Diagnostics
    price = f['price']
    mos_dfcf = ((intrinsic_value_dfcf20 - price) / intrinsic_value_dfcf20 * 100.0) if intrinsic_value_dfcf20 > 0 else -100.0
    mos_composite = ((composite_fair_value - price) / composite_fair_value * 100.0) if composite_fair_value > 0 else -100.0
    
    signal = "Undervalued" if mos_dfcf > 15 else ("Fairly Valued" if mos_dfcf >= -10 else "Overvalued")
    signal_badge = "success" if mos_dfcf > 15 else ("warning" if mos_dfcf >= -10 else "danger")

    return {
        'model_name': 'Thesis 2: Academic DFCF-20 + Gordon Perpetuity + Composite',
        'short_name': 'Academic DFCF-20 + TV',
        'document_source': 'stockoracle_valuation_blueprint.md',
        'intrinsic_value': round(intrinsic_value_dfcf20, 2),
        'composite_fair_value': round(composite_fair_value, 2),
        'margin_of_safety_pct': round(mos_dfcf, 1),
        'composite_mos_pct': round(mos_composite, 1),
        'signal': signal,
        'signal_badge': signal_badge,
        'base_fcf': fcf0,
        'discount_rate': discount_rate,
        'discount_rate_pct': round(discount_rate * 100.0, 2),
        'terminal_growth': gT,
        'terminal_growth_pct': round(gT * 100.0, 1),
        'pv_forecast': pv_forecast,
        'terminal_value_20': terminal_value_20,
        'pv_terminal_value': pv_terminal_value,
        'tv_contribution_pct': round((pv_terminal_value / enterprise_value * 100.0) if enterprise_value > 0 else 0, 1),
        'enterprise_value': enterprise_value,
        'equity_value': equity_value,
        'shares_outstanding': shares,
        'multi_model_suite': {
            'dcf_no_tv': round(v_dcf, 2),
            'dfcf_with_tv': round(v_dfcf, 2),
            'dni_earnings': round(v_dni, 2),
            'fair_pe': round(v_pe, 2),
            'fair_ps': round(v_ps, 2),
            'fair_pb': round(v_pb, 2),
            'composite_oracle_style': round(composite_fair_value, 2),
            'weights': composite_weights
        },
        'sensitivity_matrix': sensitivity_matrix,
        'projections': projections
    }


# ==============================================================================
# THESIS 3: Dynamic Multi-Modal Routing & OracleIQ™ 6D Framework (A Comprehensive Blueprint for Algorithmic.md)
# ==============================================================================
def calculate_thesis_3_dynamic(f, custom_g1=None, custom_r=None):
    """
    Implements Thesis 3: Dynamic Multi-Modal Model Routing & OracleIQ™ 6-Dimension Holistic Framework.
    - Dynamic Sector & Growth Routing:
        * Financial Sector -> Discounted Net Income (DNI-20)
        * Hyper-Growth (Sales growth > 25% or negative FCF) -> Price-to-Sales-Growth (PSG) at 0.20 Benchmark
        * Standard Operating Business -> 20-Year DFCF with Median Deceleration Rate
    - OracleIQ™ 6-Dimension Quantitative Scoring (Predictability, Profitability, Growth, Financial Strength, OracleMoat, Valuation).
    - VMI Technical Momentum Filter.
    """
    sector = f['sector'].lower()
    sub_sector = f['sub_sector'].lower()
    shares = f['shs_outstand'] if f['shs_outstand'] > 0 else 1.0
    price = f['price']
    
    # 1. Dynamic Routing Decision
    is_financial = ('financial' in sector or 'bank' in sub_sector or 'insurance' in sub_sector)
    is_hyper_growth = (f['sales_yy'] is not None and f['sales_yy'] > 0.25) or (f['g1'] > 0.25) or (f['fcf'] <= 0 and f['sales'] > 0)
    
    routing_type = ""
    routing_rationale = ""
    routed_intrinsic_value = 0.0
    routed_details = {}
    
    # Model A: Financial Sector -> DNI-20
    if is_financial:
        routing_type = "DNI-20 (Discounted Net Income)"
        routing_rationale = "Financial sector assets generate spreads on balance sheet capital rather than traditional operating FCF."
        
        base_ni = f['income'] if f['income'] > 0 else f['sales'] * 0.15
        g1 = custom_g1 if custom_g1 is not None else f['g1']
        g2 = max(0.04, g1 * 0.70)
        g3 = 0.040
        r = custom_r if custom_r is not None else max(0.070, f['wacc'] * 0.01)
        
        pv_ni = 0.0
        cur_ni = base_ni
        for yr in range(1, 21):
            cur_ni *= (1 + (g1 if yr <= 5 else (g2 if yr <= 10 else g3)))
            pv_ni += cur_ni / ((1 + r) ** yr)
            
        eq_val = pv_ni + f['total_cash'] - f['total_debt']
        routed_intrinsic_value = max(0.0, eq_val / shares)
        routed_details = {
            'base_metric': 'Net Income (TTM)',
            'base_value': base_ni,
            'growth_rate': g1,
            'discount_rate': r,
            'pv_total': pv_ni
        }

    # Model B: Hyper-Growth / High CapEx -> PSG Ratio Model (0.20 Benchmark)
    elif is_hyper_growth and (f['fcf'] <= 0 or f['pfcf'] is None or f['pfcf'] > 60):
        routing_type = "PSG Ratio Model (Benchmark 0.20)"
        routing_rationale = "Hyper-growth / intensive reinvestment phase. Market premium evaluated against top-line expansion velocity."
        
        sales_growth_pct = (f['g1'] * 100.0) if f['g1'] else 20.0
        sales_per_sh = (f['sales'] / shares) if (f['sales'] and shares) else (price / f['ps'] if f['ps'] else 10.0)
        current_ps = f['ps'] if f['ps'] else (price / sales_per_sh if sales_per_sh > 0 else 5.0)
        current_psg = current_ps / max(1.0, sales_growth_pct)
        
        fair_ps = 0.20 * sales_growth_pct
        routed_intrinsic_value = fair_ps * sales_per_sh
        routed_details = {
            'current_ps': round(current_ps, 2),
            'sales_growth_pct': round(sales_growth_pct, 1),
            'current_psg': round(current_psg, 3),
            'benchmark_psg': 0.20,
            'fair_ps_multiple': round(fair_ps, 2),
            'sales_per_share': round(sales_per_sh, 2),
            'status': 'Undervalued for growth' if current_psg < 0.20 else 'Premium / Overvalued for growth'
        }

    # Model C: Standard Commercial Operating Business -> DFCF-20 with Median Deceleration
    else:
        routing_type = "DFCF-20 (Median Deceleration Staging)"
        routing_rationale = "Standard operating enterprise. 3-epoch projection with median stepdown and hurdle rate floor."
        
        base_fcf = f['fcf'] if f['fcf'] > 0 else f['ocf']
        g1 = custom_g1 if custom_g1 is not None else f['g1']
        g3 = 0.040
        g2 = float(np.median([g1, g3]))  # Median deceleration rate as specified in paper
        r = custom_r if custom_r is not None else max(0.0579, f['wacc'] * 0.01)  # Hard floor at 5.79%
        
        pv_fcf = 0.0
        cur_fcf = base_fcf
        for yr in range(1, 21):
            cur_fcf *= (1 + (g1 if yr <= 5 else (g2 if yr <= 10 else g3)))
            pv_fcf += cur_fcf / ((1 + r) ** yr)
            
        eq_val = pv_fcf + f['total_cash'] - f['total_debt']
        routed_intrinsic_value = max(0.0, eq_val / shares)
        routed_details = {
            'base_metric': 'Free Cash Flow (TTM)',
            'base_value': base_fcf,
            'near_term_g1': g1,
            'median_mid_term_g2': g2,
            'terminal_g3': g3,
            'discount_rate': r,
            'pv_total': pv_fcf
        }

    # 2. OracleIQ™ 6-Dimension Quantitative Scoring (0 - 100)
    dim_predictability = 70.0
    if f.get('raw_dict', {}).get('predictability'):
        try:
            dim_predictability = float(f['raw_dict']['predictability']) * 20.0
        except Exception:
            dim_predictability = 70.0
            
    score_pm = min(100.0, max(0.0, (f['profit_margin'] * 200.0) if f['profit_margin'] else 50.0))
    score_roe = min(100.0, max(0.0, (f['roe'] * 250.0) if f['roe'] else 50.0))
    score_roic = min(100.0, max(0.0, (f['roic'] * 300.0) if f['roic'] else 50.0))
    dim_profitability = (score_pm * 0.35 + score_roe * 0.35 + score_roic * 0.30)
    
    score_g1 = min(100.0, max(0.0, (f['g1'] * 350.0) if f['g1'] else 50.0))
    score_syy = min(100.0, max(0.0, (f['sales_yy'] * 300.0) if f['sales_yy'] else 50.0))
    dim_growth = (score_g1 * 0.60 + score_syy * 0.40)
    
    f_num = 6.0
    if f['f_score']:
        try:
            f_num = float(str(f['f_score']).split('/')[0])
        except Exception:
            f_num = 6.0
    score_f = min(100.0, (f_num / 9.0) * 100.0)
    score_z = min(100.0, (f['z_score'] / 5.0) * 100.0) if f['z_score'] else 70.0
    score_debt = max(0.0, 100.0 - (f['debt_eq'] * 40.0))
    dim_fin_strength = (score_f * 0.40 + score_z * 0.35 + score_debt * 0.25)
    
    roic_wacc_spread = f['roic'] - (f['wacc'] * 0.01)
    score_spread = min(100.0, max(20.0, 50.0 + roic_wacc_spread * 300.0))
    score_gm = min(100.0, max(20.0, f['gross_margin'] * 120.0))
    dim_moat = (score_spread * 0.60 + score_gm * 0.40)
    
    mos_pct = ((routed_intrinsic_value - price) / routed_intrinsic_value * 100.0) if routed_intrinsic_value > 0 else -50.0
    dim_valuation = min(100.0, max(0.0, 50.0 + mos_pct * 1.2))
    
    oracle_iq_total = (
        dim_predictability * 0.15 +
        dim_profitability * 0.20 +
        dim_growth * 0.20 +
        dim_fin_strength * 0.15 +
        dim_moat * 0.15 +
        dim_valuation * 0.15
    )

    # 3. VMI Technical Momentum Check
    sma50 = parse_num(f['raw_dict'].get('SMA50')) or 0.0
    sma200 = parse_num(f['raw_dict'].get('SMA200')) or 0.0
    rsi = parse_num(f['raw_dict'].get('RSI (14)')) or parse_num(f['raw_dict'].get('TV RSI')) or 50.0
    
    uptrend = (sma50 > 0 and sma200 > 0)
    stage_2_uptrend = uptrend and (sma50 > sma200)
    momentum_signal = "Bullish Uptrend (Stage 2)" if stage_2_uptrend else ("Neutral / Consolidating" if sma50 >= 0 else "Bearish Downtrend")

    mos_routed = ((routed_intrinsic_value - price) / routed_intrinsic_value * 100.0) if routed_intrinsic_value > 0 else -100.0
    signal = "Strong Buy" if (mos_routed > 20 and oracle_iq_total >= 70) else ("Buy" if mos_routed > 10 else ("Hold / Fair Value" if mos_routed >= -15 else "Overvalued"))
    signal_badge = "success" if "Buy" in signal else ("warning" if "Hold" in signal else "danger")

    return {
        'model_name': 'Thesis 3: Dynamic Multi-Modal Routing & OracleIQ™ 6D Framework',
        'short_name': 'Dynamic Routing + OracleIQ',
        'document_source': 'A Comprehensive Blueprint for Algorithmic.md',
        'intrinsic_value': round(routed_intrinsic_value, 2),
        'margin_of_safety_pct': round(mos_routed, 1),
        'signal': signal,
        'signal_badge': signal_badge,
        'routing_type': routing_type,
        'routing_rationale': routing_rationale,
        'routed_details': routed_details,
        'oracle_iq': {
            'total_score': round(oracle_iq_total, 1),
            'predictability': round(dim_predictability, 1),
            'profitability': round(dim_profitability, 1),
            'growth': round(dim_growth, 1),
            'financial_strength': round(dim_fin_strength, 1),
            'oracle_moat': round(dim_moat, 1),
            'valuation': round(dim_valuation, 1)
        },
        'momentum': {
            'sma50': sma50,
            'sma200': sma200,
            'rsi': rsi,
            'stage_2_uptrend': stage_2_uptrend,
            'signal': momentum_signal
        }
    }


# ==============================================================================
# UNIFIED COMPARISON & ANALYSIS AGGREGATOR
# ==============================================================================
def analyze_stock_3_theses(stock_dict):
    """
    Runs all three research thesis models on a stock dictionary and compiles
    a side-by-side comparative analysis with external benchmarks (GF Value, Analyst Targets).
    """
    f = extract_stock_fundamentals(stock_dict)
    
    thesis1 = calculate_thesis_1_vmi(f)
    thesis2 = calculate_thesis_2_academic(f)
    thesis3 = calculate_thesis_3_dynamic(f)
    
    price = f['price']
    gf_value = f['gf_value']
    analyst_target = f['analyst_target']

    # Variance and model accuracy delta comparison against actual benchmarks
    vals = [thesis1['intrinsic_value'], thesis2['intrinsic_value'], thesis3['intrinsic_value']]
    valid_vals = [v for v in vals if v > 0]
    avg_thesis_val = (sum(valid_vals) / len(valid_vals)) if valid_vals else price
    
    closest_to_gf = "N/A"
    if gf_value and gf_value > 0:
        diffs = {
            'Thesis 1 (Adam Khoo VMI)': abs(thesis1['intrinsic_value'] - gf_value),
            'Thesis 2 (Academic DFCF-20 + TV)': abs(thesis2['intrinsic_value'] - gf_value),
            'Thesis 3 (Dynamic Routing)': abs(thesis3['intrinsic_value'] - gf_value)
        }
        closest_to_gf = min(diffs, key=diffs.get)

    return {
        'symbol': f['ticker'],
        'name': f['name'],
        'sector': f['sector'],
        'sub_sector': f['sub_sector'],
        'country': f['country'],
        'current_price': price,
        'market_cap': f['market_cap'],
        'shares_outstanding': f['shs_outstand'],
        'beta': f['beta'],
        'wacc': f['wacc'],
        'gf_value': gf_value,
        'gf_valuation': f['gf_valuation'],
        'analyst_target': analyst_target,
        'average_thesis_fair_value': round(avg_thesis_val, 2),
        'closest_to_stock_oracle': closest_to_gf,
        'thesis_1': thesis1,
        'thesis_2': thesis2,
        'thesis_3': thesis3,
        'raw_metrics': {
            'pe': f['pe'],
            'forward_pe': f['forward_pe'],
            'ps': f['ps'],
            'pb': f['pb'],
            'pfcf': f['pfcf'],
            'fcf': f['fcf'],
            'ocf': f['ocf'],
            'income': f['income'],
            'sales': f['sales'],
            'total_cash': f['total_cash'],
            'total_debt': f['total_debt'],
            'gross_margin': f['gross_margin'],
            'oper_margin': f['oper_margin'],
            'profit_margin': f['profit_margin'],
            'roe': f['roe'],
            'roic': f['roic'],
            'f_score': f['f_score'],
            'z_score': f['z_score'],
            'growth_g1': f['g1']
        }
    }


def generate_watchlist_oracle_leaderboard(stocks_list):
    """
    Computes a 3-model comparison leaderboard summary for all stocks in the watchlist.
    """
    results = []
    for s in stocks_list:
        try:
            ticker = str(s.get('Ticker', s.get('symbol', ''))).strip().upper()
            if not ticker:
                continue
            analysis = analyze_stock_3_theses(s)
            results.append({
                'symbol': analysis['symbol'],
                'name': analysis['name'],
                'sector': analysis['sector'],
                'current_price': analysis['current_price'],
                'thesis_1_val': analysis['thesis_1']['intrinsic_value'],
                'thesis_1_mos': analysis['thesis_1']['margin_of_safety_pct'],
                'thesis_2_val': analysis['thesis_2']['intrinsic_value'],
                'thesis_2_mos': analysis['thesis_2']['margin_of_safety_pct'],
                'thesis_3_val': analysis['thesis_3']['intrinsic_value'],
                'thesis_3_mos': analysis['thesis_3']['margin_of_safety_pct'],
                'thesis_3_type': analysis['thesis_3']['routing_type'].split(' ')[0],
                'avg_fair_value': analysis['average_thesis_fair_value'],
                'gf_value': analysis['gf_value'],
                'analyst_target': analysis['analyst_target'],
                'oracle_iq_score': analysis['thesis_3']['oracle_iq']['total_score'],
                'closest_thesis': analysis['closest_to_stock_oracle']
            })
        except Exception as e:
            print(f"Warning: Failed to compute oracle summary for stock {s.get('Ticker')}: {e}")
            
    return results
