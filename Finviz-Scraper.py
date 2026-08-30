import requests
from bs4 import BeautifulSoup
import pandas as pd
import progressbar
import re
import time
import random
from datetime import datetime
import pygsheets
import csv
import json
from curl_cffi import requests as curl_requests
from concurrent.futures import ThreadPoolExecutor, as_completed
import tradingview_service
import db

# set Google Sheets variables
try:
    import user_specific_variables
    has_gsheets = True
except ImportError:
    has_gsheets = False

CONFIG_SYMBOLS = []
CONFIG_COLUMN_SYMBOL_IX = 0

def scrape_single_stock_dict(symbol, ticker_name=None):
    hdr = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'}
    
    symbol = symbol.strip()
    if not symbol:
        return None
        
    try:
        # 1. Parse Finviz Quote (handle dot notation like BRK.B -> BRK-B)
        finviz_symbol = symbol.replace('.', '-')
        req = None
        for attempt in range(3):
            try:
                req = requests.get("https://finviz.com/quote.ashx?t=" + finviz_symbol, headers=hdr, timeout=10)
                if req.status_code == 200:
                    break
                elif req.status_code == 429:
                    time.sleep(1.5 * (attempt + 1) + random.uniform(0.1, 0.4))
            except Exception:
                time.sleep(0.8 * (attempt + 1))
                
        if not req or req.status_code != 200:
            return None
            
        soup = BeautifulSoup(req.content, 'html.parser')
        
        sector = ''
        sub_sector = ''
        country = ''
        for cat in soup.find_all(class_='quote-header_category'):
            href = cat.get('href', '')
            if 'f=sec_' in href:
                sector = cat.text.strip()
            elif 'f=ind_' in href:
                sub_sector = cat.text.strip()
            elif 'f=geo_' in href:
                country = cat.text.strip()
                
        snapshot_data = {}
        tables = soup.find_all('table', class_='snapshot-table2')
        for table in tables:
            rows = table.find_all('tr')
            for row in rows:
                tds = row.find_all('td')
                if len(tds) >= 2:
                    key = tds[0].text.strip()
                    val = tds[1].text.strip()
                    snapshot_data[key] = val
                    
        if not snapshot_data:
            return None
            
        res = {
            'Ticker': symbol,
            'Name': ticker_name if ticker_name else '',
            'Sector': sector,
            'Sub-Sector': sub_sector,
            'Country': country
        }
        res.update(snapshot_data)
        
        # 2. Fetch GuruFocus
        guru_symbol = symbol.replace('-', '.')
        guru_data = {
            'Piotroski F-Score': '',
            'Altman Z-Score': '',
            'Beneish M-Score': '',
            'ROIC': '',
            'WACC': '',
            'GF Value': '',
            'GF Valuation': ''
        }
        
        for attempt in range(2):
            try:
                guru_req = curl_requests.get("https://www.gurufocus.com/stock/" + guru_symbol, impersonate="chrome", timeout=12)
                if guru_req.status_code == 200:
                    guru_soup = BeautifulSoup(guru_req.content, 'html.parser')
                    
                    # Extract F-Score, Z-Score, M-Score
                    guru_ls = ['Piotroski F-Score', 'Altman Z-Score', 'Beneish M-Score']
                    for val in guru_ls:
                        try:
                            match = None
                            for a in guru_soup.find_all('a'):
                                if val in a.text:
                                    match = a
                                    break
                            if match:
                                next_td = match.find_next('td')
                                if next_td:
                                    guru_data[val] = next_td.text.strip()
                        except:
                            pass
                    
                    # Extract ROIC
                    try:
                        for a in guru_soup.find_all('a'):
                            if 'ROIC %' in a.text:
                                next_td = a.find_next('td')
                                if next_td:
                                    guru_data['ROIC'] = next_td.text.strip()
                                    break
                    except:
                        pass
                        
                    # Extract WACC & GF Value (requires Nuxt state decoding)
                    try:
                        script_text = ""
                        for script in guru_soup.find_all('script'):
                            if script.string and 'window.__NUXT__' in script.string:
                                script_text = script.string
                                break
                        if script_text:
                            wacc_val, gf_value = parse_guru_state(script_text)
                            if wacc_val is not None:
                                try:
                                    guru_data['WACC'] = f"{float(wacc_val):.2f}"
                                except:
                                    guru_data['WACC'] = str(wacc_val)
                            if gf_value is not None:
                                try:
                                    guru_data['GF Value'] = f"{float(gf_value):.2f}"
                                except:
                                    guru_data['GF Value'] = str(gf_value)
                                
                                price_val = res.get('Price', '')
                                if price_val:
                                    guru_data['GF Valuation'] = get_valuation_status(
                                        price_val, 
                                        gf_value, 
                                        z_score_str=guru_data.get('Altman Z-Score', ''),
                                        f_score_str=guru_data.get('Piotroski F-Score', '')
                                    )
                    except:
                        pass
                    break
                elif guru_req.status_code == 429:
                    time.sleep(2.0 * (attempt + 1))
            except Exception as e:
                time.sleep(0.5)
            
        res.update(guru_data)
        
        # 3. Fetch TradingView Technicals & Targets
        try:
            tv_batch = tradingview_service.fetch_tradingview_batch([symbol], timeout=5)
            res = tradingview_service.enrich_stock_dict_with_tv(res, tv_batch)
        except Exception as tv_e:
            pass
            
        return res
    except Exception as e:
        print(f"Error scraping {symbol}: {e}")
        return None

def scrape_finviz(symbols, ticker_names=None, progress_callback=None, max_workers=3):
    clean_symbols = [s.strip() for s in symbols if s and s.strip()]
    total_count = len(clean_symbols)
    print(f"\nScraping {total_count} stocks (parallel x{max_workers} with retry)...")
    
    results_map = {}
    completed_count = 0
    
    def worker(sym):
        name = ticker_names.get(sym, '') if ticker_names else ''
        for attempt in range(3):
            try:
                time.sleep(random.uniform(0.08, 0.20))
                res = scrape_single_stock_dict(sym, name)
                if res:
                    return sym, res
            except Exception as e:
                pass
            time.sleep(0.6 * (attempt + 1))
        return sym, None

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(worker, s): s for s in clean_symbols}
        for future in as_completed(futures):
            sym = futures[future]
            completed_count += 1
            try:
                s, res = future.result()
                if res:
                    results_map[s] = res
            except Exception as e:
                print(f"Error scraping {sym}: {e}")
                
            if progress_callback:
                try:
                    progress_callback(completed_count, total_count, sym)
                except Exception as p_err:
                    pass
            print(f"\rProgress: {completed_count}/{total_count} ({(completed_count/total_count)*100:.1f}%)", end="", flush=True)

    print()
    results = [results_map[s] for s in clean_symbols if s in results_map]
    
    if not results:
        print("Error: No data successfully scraped.")
        return pd.DataFrame()
        
    df = pd.DataFrame(results)
    
    # Enrich with batch TradingView data
    try:
        tv_batch = tradingview_service.fetch_tradingview_batch(df['Ticker'].tolist())
        tv_cols = [
            'TV Technical', 'TV Score', 'TV RSI', 'Analyst Target', 
            'Analyst High', 'Analyst Low', 'Target Upside %', 
            'Analyst Rating', 'Next Earnings Date', 'Days to Earnings'
        ]
        for col in tv_cols:
            df[col] = df['Ticker'].map(lambda s: tv_batch.get(str(s).strip().upper(), {}).get(col, ''))
    except Exception as tv_err:
        print(f"Warning: TradingView enrichment failed: {tv_err}")
    
    # Merge newly scraped results into existing data so existing rows are preserved
    if db.is_db_enabled():
        try:
            old_stocks = db.load_stocks()
            if old_stocks:
                old_df = pd.DataFrame(old_stocks)
                new_syms = set(df['Ticker'].tolist())
                kept_old = old_df[~old_df['Ticker'].isin(new_syms)]
                if not kept_old.empty:
                    df = pd.concat([df, kept_old], ignore_index=True)
        except Exception as merge_err:
            print(f"Warning: database merge failed: {merge_err}")
    else:
        import os
        if os.path.exists('stocks_data.csv'):
            try:
                old_df = pd.read_csv('stocks_data.csv')
                new_syms = set(df['Ticker'].tolist())
                kept_old = old_df[~old_df['Ticker'].isin(new_syms)]
                if not kept_old.empty:
                    df = pd.concat([df, kept_old], ignore_index=True)
            except Exception as merge_err:
                print(f"Warning: merge failed: {merge_err}")
    
    # Optional Google Sheets Integration
    if has_gsheets:
        try:
            print("\nUploading data to Google Sheets...")
            gc = pygsheets.authorize(service_file=user_specific_variables.json_file)
            sheet = gc.open_by_key(user_specific_variables.sheet_key)
            worksheet = sheet.worksheet_by_title(user_specific_variables.worksheet_title)
            worksheet.clear(start='A1')
            worksheet.set_dataframe(df, start='A1', nan='')
            print("Google Sheets updated successfully.")
        except Exception as e:
            print(f"Warning: Failed to upload to Google Sheets: {e}")
    else:
        print("\nNote: user_specific_variables.py not found. Google Sheets integration skipped.")
        
    # Write output to database or CSV
    output_file_with_date = 'output' + datetime.today().strftime('%Y-%m-%d') + '.csv'
    if db.is_db_enabled():
        db.save_stocks_batch(df.to_dict(orient='records'))
        print(f"Data saved to database.")
    else:
        df.to_csv(output_file_with_date, index=False)
        df.to_csv('stocks_data.csv', index=False)
        print(f"Data saved to local CSV file: {output_file_with_date} and stocks_data.csv")
    
    # Write output HTML from dataframe
    output_file_html = 'output' + datetime.today().strftime('%Y-%m-%d') + '.html'
    save_to_html(df, output_file_html)
    save_to_html(df, 'stocks_data.html')
    print(f"Data saved to local HTML dashboard: {output_file_html} and stocks_data.html")
    
    return df

def scan_arguments(s):
    args = []
    i = 0
    n = len(s)
    
    while i < n:
        while i < n and (s[i].isspace() or s[i] == ','):
            i += 1
        if i >= n:
            break
            
        char = s[i]
        
        if char == '"' or char == "'":
            quote = char
            start = i
            i += 1
            while i < n:
                if s[i] == '\\':
                    i += 2
                elif s[i] == quote:
                    i += 1
                    break
                else:
                    i += 1
            val_str = s[start:i]
            try:
                if quote == "'":
                    inner = val_str[1:-1].replace('"', '\\"').replace("\\'", "'")
                    val = json.loads(f'"{inner}"')
                else:
                    val = json.loads(val_str)
            except Exception as e:
                val = val_str[1:-1]
            args.append(val)
            
        elif char == '{' or char == '[':
            start = i
            brace_count = 0
            bracket_count = 0
            while i < n:
                c = s[i]
                if c == '"' or c == "'":
                    q = c
                    i += 1
                    while i < n:
                        if s[i] == '\\':
                            i += 2
                        elif s[i] == q:
                            i += 1
                            break
                        else:
                            i += 1
                    continue
                elif c == '{':
                    brace_count += 1
                elif c == '}':
                    brace_count -= 1
                elif c == '[':
                    bracket_count += 1
                elif c == ']':
                    bracket_count -= 1
                
                i += 1
                if brace_count == 0 and bracket_count == 0:
                    break
            args.append(s[start:i])
            
        else:
            start = i
            while i < n and s[i] != ',' and s[i] != ')' and s[i] != '}':
                i += 1
            val_str = s[start:i].strip()
            if val_str == 'null':
                args.append(None)
            elif val_str == 'true':
                args.append(True)
            elif val_str == 'false':
                args.append(False)
            elif val_str == 'undefined':
                args.append(None)
            else:
                try:
                    if '.' in val_str:
                        args.append(float(val_str))
                    else:
                        args.append(int(val_str))
                except:
                    args.append(val_str)
                    
    return args

def parse_guru_state(script_text):
    param_match = re.search(r'\(function\(([^)]+)\)', script_text)
    if not param_match:
        return None, None
        
    params = [p.strip() for p in param_match.group(1).split(',')]
    
    idx = script_text.rfind('}(')
    if idx == -1:
        return None, None
        
    args_str = script_text[idx+2:]
    if args_str.endswith('));'):
        args_str = args_str[:-3]
    elif args_str.endswith(');'):
        args_str = args_str[:-2]
        
    args = scan_arguments(args_str)
    
    mapping = {}
    for p, a in zip(params, args):
        mapping[p] = a
        
    def resolve_val(raw):
        if raw in mapping:
            return mapping[raw]
        try:
            if '.' in raw:
                return float(raw)
            return int(raw)
        except:
            return raw

    wacc = None
    wacc_key_match = re.search(r'\bwacc:([a-zA-Z0-9_$]+)', script_text)
    if wacc_key_match:
        wacc = resolve_val(wacc_key_match.group(1))
        
    gf_value = None
    gf_val_match = re.search(r'\bgf_value\s*:\s*([a-zA-Z0-9_$]+)', script_text)
    if gf_val_match:
        gf_value = resolve_val(gf_val_match.group(1))
        
    return wacc, gf_value

def get_valuation_status(price_str, gf_val, z_score_str=None, f_score_str=None):
    if not gf_val:
        return 'N/A'
    try:
        p_clean = price_str.replace('$', '').replace(',', '').strip()
        price = float(p_clean)
        g = float(gf_val)
        if g <= 0:
            return 'N/A'
        ratio = price / g
        
        # Check if it is undervalued (ratio < 0.90)
        is_undervalued = (ratio < 0.90)
        
        # Check for Value Trap indicators
        is_value_trap = False
        if is_undervalued:
            # 1. Check Altman Z-Score (distress zone is < 1.81)
            if z_score_str and z_score_str != '-':
                try:
                    z = float(z_score_str.split()[0])
                    if z < 1.81:
                        is_value_trap = True
                except:
                    pass
            
            # 2. Check Piotroski F-Score (low score is <= 3, format is "X/9")
            if f_score_str and f_score_str != '-':
                try:
                    f_val = f_score_str.split('/')[0].strip()
                    f = int(f_val)
                    if f <= 3:
                        is_value_trap = True
                except:
                    pass
        
        if is_value_trap:
            return 'Possible Value Trap, Think Twice'
            
        if ratio < 0.70:
            return 'Significantly Undervalued'
        elif ratio < 0.90:
            return 'Modestly Undervalued'
        elif ratio < 1.10:
            return 'Fairly Valued'
        elif ratio < 1.30:
            return 'Modestly Overvalued'
        else:
            return 'Significantly Overvalued'
    except:
        return 'N/A'

def save_to_html(df, filepath):
    # Convert dataframe to JSON records
    data_json = df.to_json(orient='records')
    scrape_date = datetime.today().strftime('%Y-%m-%d %H:%M')
    
    html_content = HTML_TEMPLATE.replace('{{ DATA_JSON }}', data_json).replace('{{ SCRAPE_DATE }}', scrape_date)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(html_content)

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Finviz & GuruFocus Scraped Stock Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-tertiary: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --accent: #6366f1;
            --accent-hover: #4f46e5;
            --accent-light: rgba(99, 102, 241, 0.15);
            --success: #10b981;
            --success-light: rgba(16, 185, 129, 0.15);
            --danger: #ef4444;
            --danger-light: rgba(239, 68, 68, 0.15);
            --warning: #f59e0b;
            --warning-light: rgba(245, 158, 11, 0.15);
            --border-color: #334155;
            --card-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -4px rgba(0, 0, 0, 0.3);
        }

        body {
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0;
            padding: 0;
            min-height: 100vh;
        }

        .dashboard {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2.5rem 1.5rem;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2.5rem;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 1.5rem;
        }

        .header-title h1 {
            margin: 0;
            font-size: 2rem;
            font-weight: 700;
            background: linear-gradient(135deg, #a5b4fc, #6366f1);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .header-title p {
            margin: 0.25rem 0 0 0;
            color: var(--text-secondary);
            font-size: 0.95rem;
        }

        .scrape-badge {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            padding: 0.5rem 1rem;
            border-radius: 9999px;
            font-size: 0.85rem;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .scrape-badge i {
            color: var(--accent);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2.5rem;
        }

        .stat-card {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 14px;
            padding: 1.5rem;
            box-shadow: var(--card-shadow);
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            min-height: 100px;
        }

        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 4px;
            height: 100%;
            background-color: var(--accent);
        }

        .stat-card.success::before { background-color: var(--success); }
        .stat-card.danger::before { background-color: var(--danger); }
        .stat-card.warning::before { background-color: var(--warning); }

        .stat-label {
            color: var(--text-secondary);
            font-size: 0.85rem;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .stat-value {
            font-size: 1.75rem;
            font-weight: 700;
            margin-top: 0.5rem;
            color: var(--text-primary);
        }

        .stat-icon {
            position: absolute;
            right: 1.5rem;
            bottom: 1.5rem;
            font-size: 2rem;
            color: rgba(255, 255, 255, 0.05);
        }

        .controls-card {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 14px;
            padding: 1.25rem 1.5rem;
            box-shadow: var(--card-shadow);
            margin-bottom: 2rem;
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            align-items: center;
        }

        .search-wrapper {
            position: relative;
            flex-grow: 1;
            min-width: 250px;
        }

        .search-wrapper i {
            position: absolute;
            left: 1rem;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
        }

        .search-input {
            width: 100%;
            box-sizing: border-box;
            background-color: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.75rem 1rem 0.75rem 2.5rem;
            color: var(--text-primary);
            font-size: 0.95rem;
            outline: none;
            transition: all 0.2s ease;
        }

        .search-input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px var(--accent-light);
        }

        .filter-select {
            background-color: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.75rem 2rem 0.75rem 1rem;
            color: var(--text-primary);
            font-size: 0.95rem;
            outline: none;
            cursor: pointer;
            appearance: none;
            -webkit-appearance: none;
            background-image: url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 0.75rem center;
            background-size: 1rem;
            min-width: 180px;
            transition: all 0.2s ease;
        }

        .filter-select:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px var(--accent-light);
        }

        .table-container {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 14px;
            box-shadow: var(--card-shadow);
            overflow: hidden;
            margin-bottom: 2rem;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }

        th {
            background-color: rgba(15, 23, 42, 0.4);
            color: var(--text-secondary);
            font-weight: 600;
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 1rem 1.25rem;
            border-bottom: 1px solid var(--border-color);
            cursor: pointer;
            user-select: none;
            transition: all 0.2s;
        }

        th:hover {
            color: var(--text-primary);
            background-color: rgba(15, 23, 42, 0.6);
        }

        th .sort-icon {
            margin-left: 0.4rem;
            font-size: 0.75rem;
            color: var(--text-muted);
        }

        th.sorted-asc .sort-icon, th.sorted-desc .sort-icon {
            color: var(--accent);
        }

        td {
            padding: 1rem 1.25rem;
            border-bottom: 1px solid var(--border-color);
            font-size: 0.95rem;
            color: var(--text-primary);
        }

        tr:last-child td {
            border-bottom: none;
        }

        tr {
            transition: background-color 0.15s;
        }

        tr:hover {
            background-color: rgba(255, 255, 255, 0.02);
            cursor: pointer;
        }

        .ticker-badge {
            display: inline-block;
            padding: 0.25rem 0.6rem;
            border-radius: 6px;
            font-weight: 700;
            background-color: var(--accent-light);
            color: #818cf8;
            border: 1px solid rgba(99, 102, 241, 0.2);
            font-size: 0.85rem;
        }

        .sector-badge {
            display: inline-block;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            font-size: 0.8rem;
            background-color: var(--bg-tertiary);
            color: var(--text-secondary);
        }

        .value-pos {
            color: var(--success);
            font-weight: 600;
        }

        .value-neg {
            color: var(--danger);
            font-weight: 600;
        }

        .value-info {
            color: #818cf8;
            font-weight: 600;
        }

        .value-warning {
            color: var(--warning);
            font-weight: 600;
        }

        .score-badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 6px;
            font-weight: 600;
            font-size: 0.85rem;
            text-align: center;
            min-width: 2rem;
        }

        .score-badge.high {
            background-color: var(--success-light);
            color: var(--success);
            border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .score-badge.mid {
            background-color: var(--warning-light);
            color: var(--warning);
            border: 1px solid rgba(245, 158, 11, 0.2);
        }

        .score-badge.low {
            background-color: var(--danger-light);
            color: var(--danger);
            border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .score-badge.info {
            background-color: rgba(99, 102, 241, 0.15);
            color: #818cf8;
            border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(15, 23, 42, 0.8);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s ease;
        }

        .modal-overlay.active {
            opacity: 1;
            pointer-events: auto;
        }

        .modal-content {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            width: 95%;
            max-width: 1100px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            transform: translateY(20px);
            transition: transform 0.25s ease;
            position: relative;
        }

        .modal-overlay.active .modal-content {
            transform: translateY(0);
        }

        .modal-close {
            position: absolute;
            top: 1.5rem;
            right: 1.5rem;
            font-size: 1.5rem;
            color: var(--text-secondary);
            cursor: pointer;
            border: none;
            background: none;
            transition: color 0.2s;
            z-index: 10;
        }

        .modal-close:hover {
            color: var(--text-primary);
        }

        .modal-header {
            padding: 2rem 2.5rem 1rem 2.5rem;
            border-bottom: 1px solid var(--border-color);
        }

        .modal-header-top {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 0.5rem;
        }

        .modal-title {
            font-size: 2rem;
            font-weight: 700;
            margin: 0;
        }

        .modal-meta {
            color: var(--text-secondary);
            font-size: 0.95rem;
            display: flex;
            gap: 1.5rem;
            flex-wrap: wrap;
        }

        .modal-meta span {
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }

        .modal-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            padding: 2rem 2.5rem 2.5rem 2.5rem;
        }

        .modal-section {
            background-color: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.25rem;
            box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.06);
        }

        .section-title {
            font-size: 1.05rem;
            font-weight: 700;
            margin-top: 0;
            margin-bottom: 1rem;
            border-bottom: 1.5px solid var(--border-color);
            padding-bottom: 0.5rem;
            color: var(--accent);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .section-title i {
            font-size: 0.95rem;
        }

        .metric-row {
            display: flex;
            justify-content: space-between;
            padding: 0.6rem 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
            font-size: 0.9rem;
        }

        .metric-row:last-child {
            border-bottom: none;
        }

        .metric-label {
            color: var(--text-secondary);
        }

        .metric-value {
            color: var(--text-primary);
            font-weight: 600;
        }

        .empty-state {
            padding: 3rem;
            text-align: center;
            color: var(--text-secondary);
        }

        .empty-state i {
            font-size: 3rem;
            margin-bottom: 1rem;
            color: var(--text-muted);
        }

        @media (max-width: 768px) {
            .dashboard {
                padding: 1.5rem 1rem;
            }
            header {
                flex-direction: column;
                align-items: flex-start;
                gap: 1rem;
            }
            .controls-card {
                flex-direction: column;
                align-items: stretch;
            }
            .filter-select {
                width: 100%;
            }
            .modal-header {
                padding: 1.5rem 1.5rem 1rem 1.5rem;
            }
            .modal-grid {
                grid-template-columns: 1fr;
                padding: 1rem 1.5rem 1.5rem 1.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <header>
            <div class="header-title">
                <h1>Stock Intelligence Dashboard</h1>
                <p>Scraped Portfolio Financial Highlights & GuruFocus Insights</p>
            </div>
            <div class="scrape-badge">
                <i class="fa-regular fa-clock"></i>
                <span id="scrape-date">Date: N/A</span>
            </div>
        </header>

        <div class="stats-grid">
            <div class="stat-card">
                <div>
                    <span class="stat-label">Scraped Tickers</span>
                    <div id="stat-scraped-count" class="stat-value">0</div>
                </div>
                <i class="fa-solid fa-list-check stat-icon"></i>
            </div>
            <div class="stat-card success" id="stat-gainer-card">
                <div>
                    <span class="stat-label">Top Performer</span>
                    <div id="stat-top-gainer" class="stat-value">-</div>
                </div>
                <i class="fa-solid fa-chart-line stat-icon"></i>
            </div>
            <div class="stat-card warning">
                <div>
                    <span class="stat-label">Avg P/E Ratio</span>
                    <div id="stat-avg-pe" class="stat-value">-</div>
                </div>
                <i class="fa-solid fa-calculator stat-icon"></i>
            </div>
            <div class="stat-card info">
                <div>
                    <span class="stat-label">Distinct Sectors</span>
                    <div id="stat-sectors-count" class="stat-value">0</div>
                </div>
                <i class="fa-solid fa-industry stat-icon"></i>
            </div>
        </div>

        <div class="controls-card">
            <div class="search-wrapper">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="search-input" class="search-input" placeholder="Search by ticker, sector, country, index...">
            </div>
            <select id="sector-filter" class="filter-select">
                <option value="">All Sectors</option>
            </select>
            <select id="score-filter" class="filter-select">
                <option value="">All Scores</option>
                <option value="high-f">High F-Score (>= 7)</option>
                <option value="safe-z">Safe Z-Score (>= 2.99)</option>
            </select>
        </div>

        <div class="table-container">
            <table id="stocks-table">
                <thead>
                    <tr>
                        <th onclick="handleSort('Ticker')">Ticker <i class="fa-solid fa-sort sort-icon"></i></th>
                        <th onclick="handleSort('Name')">Company Name <i class="fa-solid fa-sort sort-icon"></i></th>
                        <th onclick="handleSort('Sector')">Sector <i class="fa-solid fa-sort sort-icon"></i></th>
                        <th onclick="handleSort('Market Cap')">Market Cap <i class="fa-solid fa-sort sort-icon"></i></th>
                        <th onclick="handleSort('Price')" class="text-right">Price <i class="fa-solid fa-sort sort-icon"></i></th>
                        <th onclick="handleSort('GF Value')" class="text-right">GF Value <i class="fa-solid fa-sort sort-icon"></i></th>
                        <th onclick="handleSort('Change %')" class="text-right">Change % <i class="fa-solid fa-sort sort-icon"></i></th>
                        <th onclick="handleSort('P/E')" class="text-right">P/E <i class="fa-solid fa-sort sort-icon"></i></th>
                        <th onclick="handleSort('GF Valuation')">GF Valuation <i class="fa-solid fa-sort sort-icon"></i></th>
                        <th onclick="handleSort('Piotroski F-Score')" class="text-right">F-Score <i class="fa-solid fa-sort sort-icon"></i></th>
                        <th onclick="handleSort('Altman Z-Score')" class="text-right">Z-Score <i class="fa-solid fa-sort sort-icon"></i></th>
                    </tr>
                </thead>
                <tbody id="table-body">
                </tbody>
            </table>
            <div id="empty-state" class="empty-state" style="display: none;">
                <i class="fa-regular fa-folder-open"></i>
                <p>No matching stocks found. Try adjusting your search query or filters.</p>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="details-modal" onclick="closeModal(event)">
        <div class="modal-content" onclick="event.stopPropagation()">
            <button class="modal-close" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
            <div class="modal-header">
                <div class="modal-header-top">
                    <span class="ticker-badge" id="modal-ticker">-</span>
                    <h2 class="modal-title" id="modal-company">-</h2>
                </div>
                <div class="modal-meta">
                    <span id="modal-sector"><i class="fa-solid fa-industry"></i> -</span>
                    <span id="modal-subsector"><i class="fa-solid fa-tags"></i> -</span>
                    <span id="modal-country"><i class="fa-solid fa-globe"></i> -</span>
                </div>
            </div>
            <div class="modal-grid" id="modal-grid">
            </div>
        </div>
    </div>

    <script>
        const stockData = {{ DATA_JSON }};
        const scrapeDateStr = "{{ SCRAPE_DATE }}";

        let currentSort = {
            key: 'Ticker',
            direction: 'asc'
        };

        document.getElementById('scrape-date').innerText = `Scrape Date: ${scrapeDateStr}`;

        function initDashboard() {
            populateSectors();
            calculateStats();
            renderTable(stockData);
            
            document.getElementById('search-input').addEventListener('input', applyFilters);
            document.getElementById('sector-filter').addEventListener('change', applyFilters);
            document.getElementById('score-filter').addEventListener('change', applyFilters);
        }

        function parsePercent(val) {
            if (!val || val === '-') return 0;
            return parseFloat(val.replace('%', '')) || 0;
        }

        function parseNumber(val) {
            if (!val || val === '-') return null;
            let multiplier = 1;
            let strVal = String(val).toUpperCase().trim();
            if (strVal.endsWith('B')) {
                multiplier = 1000000000;
                strVal = strVal.slice(0, -1);
            } else if (strVal.endsWith('M')) {
                multiplier = 1000000;
                strVal = strVal.slice(0, -1);
            } else if (strVal.endsWith('K')) {
                multiplier = 1000;
                strVal = strVal.slice(0, -1);
            }
            const parsed = parseFloat(strVal.replace(/,/g, ''));
            return isNaN(parsed) ? null : parsed * multiplier;
        }

        function populateSectors() {
            const sectors = new Set();
            stockData.forEach(item => {
                if (item.Sector) sectors.add(item.Sector);
            });
            
            const select = document.getElementById('sector-filter');
            Array.from(sectors).sort().forEach(sector => {
                const opt = document.createElement('option');
                opt.value = sector;
                opt.textContent = sector;
                select.appendChild(opt);
            });
        }

        function calculateStats() {
            document.getElementById('stat-scraped-count').textContent = stockData.length;
            
            const sectors = new Set(stockData.map(i => i.Sector).filter(Boolean));
            document.getElementById('stat-sectors-count').textContent = sectors.size;
            
            let peSum = 0;
            let peCount = 0;
            let topGainer = null;
            let topGainerChange = -Infinity;

            stockData.forEach(item => {
                const pe = parseNumber(item['P/E']);
                if (pe !== null && pe > 0) {
                    peSum += pe;
                    peCount++;
                }
                
                const change = parsePercent(item['Change %']);
                if (change > topGainerChange) {
                    topGainerChange = change;
                    topGainer = item;
                }
            });

            if (peCount > 0) {
                document.getElementById('stat-avg-pe').textContent = (peSum / peCount).toFixed(2);
            } else {
                document.getElementById('stat-avg-pe').textContent = 'N/A';
            }

            if (topGainer) {
                const badgeClass = topGainerChange >= 0 ? 'value-pos' : 'value-neg';
                const sign = topGainerChange >= 0 ? '+' : '';
                document.getElementById('stat-top-gainer').innerHTML = `
                    <span class="ticker-badge">${topGainer.Ticker}</span> 
                    <span class="${badgeClass}" style="font-size: 1.1rem; margin-left: 0.5rem;">${sign}${topGainerChange.toFixed(2)}%</span>
                `;
            } else {
                document.getElementById('stat-top-gainer').textContent = 'N/A';
            }
        }

        function getVisibleData() {
            const searchVal = document.getElementById('search-input').value.toLowerCase().trim();
            const sectorVal = document.getElementById('sector-filter').value;
            const scoreVal = document.getElementById('score-filter').value;

            return stockData.filter(item => {
                const matchText = `${item.Ticker} ${item.Sector} ${item['Sub-Sector']} ${item.Country} ${item.Index}`.toLowerCase();
                const matchesSearch = !searchVal || matchText.includes(searchVal);
                const matchesSector = !sectorVal || item.Sector === sectorVal;

                let matchesScore = true;
                if (scoreVal === 'high-f') {
                    const fScore = parseInt(item['Piotroski F-Score']) || 0;
                    matchesScore = fScore >= 7;
                } else if (scoreVal === 'safe-z') {
                    const zScore = parseFloat(item['Altman Z-Score']) || 0;
                    matchesScore = zScore >= 2.99;
                }

                return matchesSearch && matchesSector && matchesScore;
            });
        }

        function applyFilters() {
            const filtered = getVisibleData();
            sortArray(filtered, currentSort.key, currentSort.direction);
            renderTable(filtered);
        }

        function renderTable(data) {
            const tbody = document.getElementById('table-body');
            const emptyState = document.getElementById('empty-state');
            tbody.innerHTML = '';

            if (data.length === 0) {
                emptyState.style.display = 'block';
                return;
            }
            emptyState.style.display = 'none';

            data.forEach(item => {
                const tr = document.createElement('tr');
                tr.onclick = () => showDetails(item.Ticker);

                const changeStr = item['Change %'] || '0.00%';
                const changeVal = parsePercent(changeStr);
                const changeClass = changeVal >= 0 ? 'value-pos' : 'value-neg';
                const sign = changeVal >= 0 && !changeStr.startsWith('+') ? '+' : '';

                const fScore = item['Piotroski F-Score'];
                let fClass = '';
                if (fScore && fScore !== '-') {
                    const f = parseInt(fScore);
                    fClass = f >= 8 ? 'high' : (f <= 2 ? 'low' : 'mid');
                }
                const fBadge = fScore && fScore !== '-' ? `<span class="score-badge ${fClass}">${fScore}</span>` : '-';

                const zScore = item['Altman Z-Score'];
                let zClass = '';
                if (zScore && zScore !== '-') {
                    const z = parseFloat(zScore);
                    zClass = z >= 2.99 ? 'high' : (z < 1.81 ? 'low' : 'mid');
                }
                const zBadge = zScore && zScore !== '-' ? `<span class="score-badge ${zClass}">${zScore}</span>` : '-';

                const gfValuation = item['GF Valuation'] || '-';
                let gfClass = '';
                let gfValColorClass = '';
                if (gfValuation.includes('Possible Value Trap')) {
                    gfClass = 'low';
                    gfValColorClass = 'value-neg';
                } else if (gfValuation.includes('Undervalued')) {
                    gfClass = 'high';
                    gfValColorClass = 'value-pos';
                } else if (gfValuation.includes('Fairly')) {
                    gfClass = 'info';
                    gfValColorClass = 'value-info';
                } else if (gfValuation.includes('Modestly Overvalued')) {
                    gfClass = 'mid';
                    gfValColorClass = 'value-warning';
                } else if (gfValuation.includes('Significantly Overvalued')) {
                    gfClass = 'low';
                    gfValColorClass = 'value-neg';
                }
                const gfBadge = gfValuation !== '-' ? `<span class="score-badge ${gfClass}">${gfValuation}</span>` : '-';

                const gfValue = item['GF Value'] || '-';
                const gfValueFormatted = (gfValue !== '-' && gfValue !== '') ? `<span class="${gfValColorClass}">$${gfValue}</span>` : '-';

                tr.innerHTML = `
                    <td><span class="ticker-badge">${item.Ticker}</span></td>
                    <td style="font-weight: 500;">${item.Name || '-'}</td>
                    <td><span class="sector-badge">${item.Sector || '-'}</span></td>
                    <td>${item['Market Cap'] || '-'}</td>
                    <td class="text-right" style="font-weight: 500;">$${item.Price || '-'}</td>
                    <td class="text-right" style="font-weight: 500;">${gfValueFormatted}</td>
                    <td class="text-right ${changeClass}">${sign}${changeStr}</td>
                    <td class="text-right">${item['P/E'] || '-'}</td>
                    <td>${gfBadge}</td>
                    <td class="text-right">${fBadge}</td>
                    <td class="text-right">${zBadge}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        function handleSort(key) {
            const thList = document.querySelectorAll('th');
            let clickedTh = null;
            
            thList.forEach(th => {
                if (th.textContent.includes(key)) clickedTh = th;
            });

            if (!clickedTh) return;

            if (currentSort.key === key) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.key = key;
                currentSort.direction = 'asc';
            }

            thList.forEach(th => {
                th.classList.remove('sorted-asc', 'sorted-desc');
                const icon = th.querySelector('.sort-icon');
                if (icon) {
                    icon.className = 'fa-solid fa-sort sort-icon';
                }
            });

            clickedTh.classList.add(currentSort.direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
            const icon = clickedTh.querySelector('.sort-icon');
            if (icon) {
                icon.className = currentSort.direction === 'asc' ? 'fa-solid fa-sort-up sort-icon' : 'fa-solid fa-sort-down sort-icon';
            }

            const data = getVisibleData();
            sortArray(data, currentSort.key, currentSort.direction);
            renderTable(data);
        }

        function sortArray(arr, key, direction) {
            arr.sort((a, b) => {
                let valA = a[key];
                let valB = b[key];

                if (key === 'GF Valuation') {
                    const valMap = {
                        'Possible Value Trap, Think Twice': 1,
                        'Significantly Undervalued': 2,
                        'Modestly Undervalued': 3,
                        'Fairly Valued': 4,
                        'Modestly Overvalued': 5,
                        'Significantly Overvalued': 6,
                        '-': 7,
                        'N/A': 7
                    };
                    const rankA = valMap[valA] !== undefined ? valMap[valA] : 7;
                    const rankB = valMap[valB] !== undefined ? valMap[valB] : 7;
                    return direction === 'asc' ? rankA - rankB : rankB - rankA;
                }

                if (key.includes('Score') || key === 'Price' || key === 'GF Value' || key === 'P/E' || key === 'Change %' || key === 'Market Cap') {
                    const numA = (key === 'Change %') ? parsePercent(valA) : parseNumber(valA);
                    const numB = (key === 'Change %') ? parsePercent(valB) : parseNumber(valB);

                    if (numA === null && numB === null) return 0;
                    if (numA === null) return 1;
                    if (numB === null) return -1;

                    return direction === 'asc' ? numA - numB : numB - numA;
                }

                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();

                if (valA < valB) return direction === 'asc' ? -1 : 1;
                if (valA > valB) return direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        const groups = {
            'Valuation': {
                icon: 'fa-solid fa-calculator',
                keys: ['P/E', 'Forward P/E', 'PEG', 'P/S', 'P/B', 'P/C', 'P/FCF', 'EV/EBITDA', 'EV/Sales', 'Enterprise Value']
            },
            'Financials & Debt': {
                icon: 'fa-solid fa-balance-scale',
                keys: ['Gross Margin', 'Oper. Margin', 'Profit Margin', 'ROA', 'ROE', 'ROIC', 'WACC', 'Quick Ratio', 'Current Ratio', 'Debt/Eq', 'LT Debt/Eq', 'Book/sh', 'Cash/sh']
            },
            'Performance': {
                icon: 'fa-solid fa-chart-line',
                keys: ['Change %', 'Perf Week', 'Perf Month', 'Perf Quarter', 'Perf Half Y', 'Perf YTD', 'Perf Year', 'Perf 3Y', 'Perf 5Y', 'Perf 10Y', 'Beta', 'Volatility']
            },
            'Dividends & Target': {
                icon: 'fa-solid fa-hand-holding-dollar',
                keys: ['Dividend Est.', 'Dividend TTM', 'Dividend Ex-Date', 'Dividend Gr. 3/5Y', 'Payout', 'Recom', 'Target Price', 'Prev Close', 'Price']
            },
            'Share Statistics': {
                icon: 'fa-solid fa-share-nodes',
                keys: ['Shs Outstand', 'Shs Float', 'Short Float', 'Short Ratio', 'Short Interest', 'Insider Own', 'Insider Trans', 'Inst Own', 'Inst Trans']
            },
            'GuruFocus Scores': {
                icon: 'fa-solid fa-shield-halved',
                keys: ['Piotroski F-Score', 'Altman Z-Score', 'Beneish M-Score', 'GF Value', 'GF Valuation']
            },
            'General & Other': {
                icon: 'fa-solid fa-circle-info',
                keys: ['Index', 'Employees', 'IPO', 'Earnings', 'Trades', 'Option/Short', 'EPS (ttm)', 'EPS next Y', 'EPS next Q', 'EPS this Y', 'EPS next 5Y', 'EPS past 3/5Y', 'Sales past 3/5Y', 'EPS Y/Y TTM', 'Sales Y/Y TTM', 'EPS Q/Q', 'Sales Q/Q', 'EPS/Sales Surpr.']
            }
        };

        function showDetails(symbol) {
            const item = stockData.find(i => i.Ticker === symbol);
            if (!item) return;

            document.getElementById('modal-ticker').textContent = item.Ticker;
            document.getElementById('modal-company').textContent = item.Name || item.Ticker;
            document.getElementById('modal-sector').innerHTML = `<i class="fa-solid fa-industry"></i> ${item.Sector || 'N/A'}`;
            document.getElementById('modal-subsector').innerHTML = `<i class="fa-solid fa-tags"></i> ${item['Sub-Sector'] || 'N/A'}`;
            document.getElementById('modal-country').innerHTML = `<i class="fa-solid fa-globe"></i> ${item.Country || 'N/A'}`;

            const grid = document.getElementById('modal-grid');
            grid.innerHTML = '';

            Object.keys(groups).forEach(groupName => {
                const group = groups[groupName];
                const card = document.createElement('div');
                card.className = 'modal-section';

                let rowsHtml = '';
                group.keys.forEach(key => {
                    if (key in item) {
                        let val = item[key];
                        if (val === undefined || val === null || val === '') val = '-';
                        
                        let extraStyle = '';
                        if (key === 'Piotroski F-Score' && val !== '-') {
                            const f = parseInt(val);
                            const badge = f >= 8 ? 'high' : (f <= 2 ? 'low' : 'mid');
                            val = `<span class="score-badge ${badge}">${val}</span>`;
                        } else if (key === 'Altman Z-Score' && val !== '-') {
                            const z = parseFloat(val);
                            const badge = z >= 2.99 ? 'high' : (z < 1.81 ? 'low' : 'mid');
                            val = `<span class="score-badge ${badge}">${val}</span>`;
                        } else if (key === 'Beneish M-Score' && val !== '-') {
                            const m = parseFloat(val);
                            const badge = m >= -1.78 ? 'low' : 'high';
                            val = `<span class="score-badge ${badge}">${val}</span>`;
                        } else if (key === 'GF Valuation' && val !== '-') {
                            let badge = '';
                            if (val.includes('Possible Value Trap')) badge = 'low';
                            else if (val.includes('Undervalued')) badge = 'high';
                            else if (val.includes('Fairly')) badge = 'info';
                            else if (val.includes('Modestly Overvalued')) badge = 'mid';
                            else if (val.includes('Significantly Overvalued')) badge = 'low';
                            val = `<span class="score-badge ${badge}">${val}</span>`;
                        } else if (key === 'Change %' || key.startsWith('Perf ')) {
                            if (val !== '-') {
                                const changePercent = parsePercent(val);
                                const isPos = changePercent >= 0;
                                const colorClass = isPos ? 'value-pos' : 'value-neg';
                                const sign = isPos && !val.startsWith('+') ? '+' : '';
                                val = `<span class="${colorClass}">${sign}${val}</span>`;
                            }
                        }

                        rowsHtml += `
                            <div class="metric-row">
                                <span class="metric-label">${key}</span>
                                <span class="metric-value">${val}</span>
                            </div>
                        `;
                    }
                });

                if (rowsHtml) {
                    card.innerHTML = `
                        <h3 class="section-title"><i class="${group.icon}"></i> ${groupName}</h3>
                        <div>${rowsHtml}</div>
                    `;
                    grid.appendChild(card);
                }
            });

            document.getElementById('details-modal').classList.add('active');
        }

        function closeModal(e) {
            document.getElementById('details-modal').classList.remove('active');
        }

        window.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                closeModal();
            }
        });

        window.onload = initDashboard;
    </script>
</body>
</html>"""

# Main execution
if __name__ == '__main__':
    TICKER_NAMES = {}
    try:
        with open('tickers.csv', newline='') as csvfile:
            reader = csv.reader(csvfile, delimiter=',', quotechar='"')
            linenumber = 1
            for lineContent in reader:
                if linenumber > 1 and lineContent:
                    symbol = lineContent[0].strip()
                    CONFIG_SYMBOLS.append(symbol)
                    if len(lineContent) > 1:
                        TICKER_NAMES[symbol] = lineContent[1].strip()
                linenumber = linenumber + 1
        print("Tickers to scrape:", CONFIG_SYMBOLS)
    except FileNotFoundError:
        print("Error: tickers.csv not found. Using default symbols AAPL, MSFT, GOOG.")
        CONFIG_SYMBOLS = ['AAPL', 'MSFT', 'GOOG']
        TICKER_NAMES = {'AAPL': 'Apple Inc.', 'MSFT': 'Microsoft Corp.', 'GOOG': 'Alphabet Inc.'}
        
    data = scrape_finviz(CONFIG_SYMBOLS, ticker_names=TICKER_NAMES)
