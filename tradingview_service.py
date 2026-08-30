"""
TradingView Scanner, News & Analytics Service
Fetches real-time technical ratings, Wall Street analyst price targets, upcoming earnings,
breaking news headlines, and computes the 4-Pillar Composite Investment Score.
"""

import requests
import time
from datetime import datetime, timezone

# Custom ticker mapping for symbols that differ on TradingView
TICKER_TO_TV = {
    'FI': 'FISV',
    'MMC': 'MRSH',
    'BF.B': 'BF.B',
    'BF-B': 'BF.B',
    'BRK.B': 'BRK.B',
    'BRK-B': 'BRK.B',
}

TV_TO_TICKER = {v: k for k, v in TICKER_TO_TV.items()}
TV_TO_TICKER['FISV'] = 'FI'
TV_TO_TICKER['MRSH'] = 'MMC'

def get_tv_technical_label(score):
    """Convert Recommend.All score (-1.0 to +1.0) into human readable rating."""
    if score is None or score == '':
        return ''
    try:
        val = float(score)
        if val >= 0.5:
            return 'Strong Buy'
        elif val >= 0.1:
            return 'Buy'
        elif val > -0.1:
            return 'Neutral'
        elif val > -0.5:
            return 'Sell'
        else:
            return 'Strong Sell'
    except (ValueError, TypeError):
        return ''

def get_analyst_consensus_label(mark):
    """Convert TradingView recommendation_mark (1=Strong Buy, 5=Strong Sell) into label."""
    if mark is None or mark == '':
        return ''
    try:
        val = float(mark)
        if val <= 1.5:
            return 'Strong Buy'
        elif val <= 2.2:
            return 'Buy'
        elif val <= 3.2:
            return 'Hold'
        elif val <= 4.2:
            return 'Sell'
        else:
            return 'Strong Sell'
    except (ValueError, TypeError):
        return ''

def calculate_composite_score(row):
    """
    Computes a 0-100 Multi-Factor Investment Score and 4-pillar breakdown:
    - Valuation: 0-25 pts (GF Valuation status + Target Upside bonus)
    - Quality & Safety: 0-35 pts (Piotroski F-Score 0-20 + Altman Z-Score 0-15)
    - Economic Moat: 0-15 pts (Wide = 15, Narrow = 8, None/Unknown = 4)
    - Momentum: 0-25 pts (TradingView Technical Rating)
    """
    score = 0
    breakdown = {}
    
    # 1. Valuation (0-25)
    val_status = str(row.get('GF Valuation', '')).strip()
    val_pts = 10
    if 'Significantly Undervalued' in val_status:
        val_pts = 25
    elif 'Modestly Undervalued' in val_status:
        val_pts = 20
    elif 'Fairly' in val_status:
        val_pts = 12
    elif 'Modestly Overvalued' in val_status:
        val_pts = 6
    elif 'Significantly Overvalued' in val_status:
        val_pts = 2
    elif 'Value Trap' in val_status:
        val_pts = 0
        
    try:
        upside_str = str(row.get('Target Upside %', '')).replace('%', '').replace('+', '')
        if upside_str and float(upside_str) >= 20.0:
            val_pts = min(25, val_pts + 3)
    except:
        pass
    score += val_pts
    breakdown['valuation'] = val_pts

    # 2. Quality & Safety (0-35)
    # 2a. Piotroski F-Score (0-20)
    f_pts = 8
    try:
        f_raw = str(row.get('Piotroski F-Score', '')).split('/')[0].strip()
        f = int(f_raw)
        if f >= 8: f_pts = 20
        elif f == 7: f_pts = 16
        elif f == 6: f_pts = 12
        elif f == 5: f_pts = 8
        else: f_pts = 3
    except:
        pass
    
    # 2b. Altman Z-Score (0-15)
    z_pts = 8
    try:
        z = float(row.get('Altman Z-Score', 0))
        if z >= 3.0: z_pts = 15
        elif z >= 1.81: z_pts = 8
        else: z_pts = 0
    except:
        pass
    quality_pts = f_pts + z_pts
    score += quality_pts
    breakdown['quality'] = quality_pts
    breakdown['f_score'] = f_pts
    breakdown['z_score'] = z_pts

    # 3. Economic Moat (0-15)
    moat_str = str(row.get('Moat', '')).strip()
    moat_pts = 4
    if 'Wide' in moat_str: moat_pts = 15
    elif 'Narrow' in moat_str: moat_pts = 8
    score += moat_pts
    breakdown['moat'] = moat_pts

    # 4. Momentum / Technical (0-25)
    tv = str(row.get('TV Technical', '')).strip()
    tv_pts = 10
    if tv == 'Strong Buy': tv_pts = 25
    elif tv == 'Buy': tv_pts = 18
    elif tv == 'Neutral': tv_pts = 10
    elif tv == 'Sell': tv_pts = 4
    elif tv == 'Strong Sell': tv_pts = 0
    score += tv_pts
    breakdown['momentum'] = tv_pts

    return score, breakdown

def fetch_tradingview_batch(symbols, timeout=10):
    """
    Fetch TradingView technicals, analyst targets, and earnings calendar for a list of symbols in 1 HTTP call.
    Returns a dictionary keyed by input symbol.
    """
    if not symbols:
        return {}

    # Map input symbols to TradingView query names
    clean_symbols = [s.strip().upper() for s in symbols if s and s.strip()]
    query_symbols = [TICKER_TO_TV.get(s, s.replace('-', '.')) for s in clean_symbols]
    query_symbols_set = list(set(query_symbols))

    url = "https://scanner.tradingview.com/america/scan"
    payload = {
        "filter": [
            {"left": "name", "operation": "in_range", "right": query_symbols_set}
        ],
        "columns": [
            "name",
            "close",
            "change",
            "Recommend.All",
            "Recommend.MA",
            "Recommend.Other",
            "RSI",
            "price_target_median",
            "price_target_high",
            "price_target_low",
            "recommendation_mark",
            "earnings_release_next_date",
            "dividends_yield_current"
        ],
        "range": [0, max(250, len(query_symbols_set) + 50)]
    }

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Content-Type": "application/json",
        "Origin": "https://www.tradingview.com"
    }

    results = {}
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=timeout)
        if r.status_code != 200:
            print(f"Warning: TradingView API returned status {r.status_code}")
            return results

        data = r.json()
        now_ts = datetime.now(timezone.utc).timestamp()

        for item in data.get('data', []):
            vals = item.get('d', [])
            if len(vals) < 12:
                continue

            full_s = item.get('s', '')
            tv_name = vals[0]
            close_val = vals[1]
            rec_all = vals[3]
            rsi_val = vals[6]
            target_median = vals[7]
            target_high = vals[8]
            target_low = vals[9]
            rec_mark = vals[10]
            earnings_ts = vals[11]

            # Calculate Upside %
            upside_str = ''
            if target_median is not None and close_val is not None and close_val > 0:
                try:
                    upside = ((float(target_median) - float(close_val)) / float(close_val)) * 100
                    upside_str = f"{upside:+.2f}%"
                except:
                    pass

            # Calculate Days to Earnings & Date
            earnings_date_str = ''
            days_to_earnings = None
            if earnings_ts and earnings_ts > 0:
                try:
                    dt = datetime.fromtimestamp(earnings_ts, timezone.utc)
                    earnings_date_str = dt.strftime('%Y-%m-%d')
                    diff_days = int((earnings_ts - now_ts) / 86400)
                    if diff_days >= 0:
                        days_to_earnings = diff_days
                except:
                    pass

            stock_tv_data = {
                'TV Symbol': full_s,
                'TV Technical': get_tv_technical_label(rec_all),
                'TV Score': f"{float(rec_all):.2f}" if rec_all is not None else '',
                'TV RSI': f"{float(rsi_val):.1f}" if rsi_val is not None else '',
                'Analyst Target': f"{float(target_median):.2f}" if target_median is not None else '',
                'Analyst High': f"{float(target_high):.2f}" if target_high is not None else '',
                'Analyst Low': f"{float(target_low):.2f}" if target_low is not None else '',
                'Target Upside %': upside_str,
                'Analyst Rating': get_analyst_consensus_label(rec_mark),
                'Next Earnings Date': earnings_date_str,
                'Days to Earnings': days_to_earnings,
                'TV Close': f"{float(close_val):.2f}" if close_val is not None else ''
            }

            # Map back to original input symbol
            orig_sym = TV_TO_TICKER.get(tv_name, tv_name)
            results[orig_sym] = stock_tv_data
            results[tv_name] = stock_tv_data

    except Exception as e:
        print(f"Error fetching TradingView batch data: {e}")

    # Build final dictionary matching input symbols exactly
    final_output = {}
    for sym in clean_symbols:
        tv_sym = TICKER_TO_TV.get(sym, sym.replace('-', '.'))
        data_found = results.get(sym) or results.get(tv_sym) or {}
        final_output[sym] = data_found

    return final_output

def fetch_tradingview_news(symbol, limit=10):
    """
    Fetch breaking news headlines and catalysts for a stock symbol from TradingView.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Origin": "https://www.tradingview.com"
    }
    
    clean = symbol.strip().upper().replace('-', '.')
    exchange_candidates = [
        f"NASDAQ:{clean}",
        f"NYSE:{clean}",
        f"AMEX:{clean}",
        clean
    ]
    if clean == 'FI':
        exchange_candidates = ["NASDAQ:FISV", "NYSE:FI"]
    elif clean == 'MMC':
        exchange_candidates = ["NYSE:MRSH", "NYSE:MMC"]
        
    items = []
    for candidate in exchange_candidates:
        url = f"https://news-headlines.tradingview.com/v2/headlines?category=stock&symbol={candidate}&client=web&lang=en"
        try:
            r = requests.get(url, headers=headers, timeout=5)
            if r.status_code == 200:
                raw_items = r.json().get('items', [])
                if raw_items:
                    items = raw_items
                    break
        except Exception:
            continue
            
    now_ts = datetime.now(timezone.utc).timestamp()
    formatted = []
    for item in items[:limit]:
        pub_ts = item.get('published', 0)
        time_ago = ''
        if pub_ts:
            diff = now_ts - pub_ts
            if diff < 3600:
                time_ago = f"{max(1, int(diff/60))}m ago"
            elif diff < 86400:
                time_ago = f"{int(diff/3600)}h ago"
            elif diff < 86400 * 7:
                time_ago = f"{int(diff/86400)}d ago"
            else:
                dt = datetime.fromtimestamp(pub_ts, timezone.utc)
                time_ago = dt.strftime('%b %d, %Y')
                
        link = item.get('link') or (f"https://www.tradingview.com{item.get('storyPath')}" if item.get('storyPath') else '')
        
        formatted.append({
            'id': item.get('id', ''),
            'title': item.get('title', ''),
            'source': item.get('source', 'TradingView'),
            'published': pub_ts,
            'time_ago': time_ago,
            'link': link
        })
    return formatted

def enrich_stock_dict_with_tv(stock_dict, tv_data_dict):
    """Enrich a single stock dictionary with its TradingView metrics and calculate composite score."""
    if not stock_dict or not tv_data_dict:
        return stock_dict
    sym = stock_dict.get('Ticker', '').strip().upper()
    tv_info = tv_data_dict.get(sym, {})
    if tv_info:
        for k, v in tv_info.items():
            stock_dict[k] = v if v is not None else ''
            
    # Calculate composite score
    score, breakdown = calculate_composite_score(stock_dict)
    stock_dict['Composite Score'] = score
    stock_dict['Score Breakdown'] = breakdown
    return stock_dict
