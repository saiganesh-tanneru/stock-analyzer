from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import pandas as pd
import csv
import os
import threading
import requests
from bs4 import BeautifulSoup

import json

# Import scraping logic from existing scraper script
import importlib
FinvizScraper = importlib.import_module("Finviz-Scraper")

app = Flask(__name__, static_folder='frontend/dist', static_url_path='/')
CORS(app)  # Enable CORS for local cross-origin React dev server testing

import db

# Background scrape status
scrape_status = {
    'running': False,
    'progress': 0,
    'total': 0,
    'message': 'Idle'
}

def clean_company_name(title_str, symbol):
    """Clean Finviz title to get standard company name."""
    name_part = title_str.split('Stock Price')[0].split('Stock Quote')[0].split('Stock')[0].strip()
    prefix = f"{symbol} -"
    if name_part.startswith(prefix):
        name = name_part[len(prefix):].strip()
    else:
        name = name_part
    return name.strip(', ')

def fetch_name_from_finviz(symbol):
    """Fetch company name directly from Finviz quote page."""
    hdr = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'}
    try:
        r = requests.get(f"https://finviz.com/quote.ashx?t={symbol}", headers=hdr, timeout=5)
        if r.status_code == 200:
            soup = BeautifulSoup(r.content, 'html.parser')
            title = soup.title.string if soup.title else ""
            return clean_company_name(title, symbol)
    except Exception as e:
        print(f"Error fetching name for {symbol}: {e}")
    return ""

def load_tickers():
    """Load tickers and names."""
    return db.load_tickers()

def save_tickers(tickers):
    """Save tickers list."""
    return db.save_tickers_bulk(tickers)

def run_full_scrape_thread():
    """Run full scraping process in a separate background thread."""
    global scrape_status
    scrape_status['running'] = True
    scrape_status['message'] = 'Loading tickers...'
    
    try:
        tickers_list = load_tickers()
        scrape_status['total'] = len(tickers_list)
        scrape_status['progress'] = 0
        
        symbols = [t['symbol'] for t in tickers_list]
        names_dict = {t['symbol']: t['name'] for t in tickers_list}
        
        scrape_status['message'] = 'Starting parallel scrape...'
        
        def on_progress(completed, total, current_symbol):
            global scrape_status
            scrape_status['progress'] = completed
            scrape_status['total'] = total
            scrape_status['message'] = f"Scraped {completed}/{total} stocks ({current_symbol})..."

        # Run the parallel scraping method with progress callback
        df = FinvizScraper.scrape_finviz(symbols, names_dict, progress_callback=on_progress, max_workers=6)
        
        scrape_status['progress'] = len(symbols)
        scrape_status['message'] = 'Finished'
    except Exception as e:
        scrape_status['message'] = f"Scrape failed: {str(e)}"
        print(f"Error in background scrape: {e}")
    finally:
        scrape_status['running'] = False

# API routes
@app.route('/api/tickers', methods=['GET'])
def get_tickers():
    return jsonify(load_tickers())

@app.route('/api/tickers', methods=['POST'])
def add_ticker():
    data = request.get_json() or {}
    symbol = data.get('symbol', '').strip().upper()
    if not symbol:
        return jsonify({'error': 'Ticker symbol is required'}), 400
        
    tickers = load_tickers()
    
    # Check for duplicate — return 409 with warning (not a hard error)
    if any(t['symbol'] == symbol for t in tickers):
        return jsonify({'warning': f'Ticker {symbol} is already in your watchlist and was skipped.'}), 409

    # Fetch company name
    name = fetch_name_from_finviz(symbol)
    if not name:
        return jsonify({'error': f'Failed to resolve name for {symbol}. Ticker may be invalid.'}), 400
        
    # Save ticker to database
    db.save_ticker(symbol, name)
    
    # Scrape data for this single stock in the background
    try:
        stock_data = FinvizScraper.scrape_single_stock_dict(symbol, name)
        if stock_data:
            db.save_stocks_batch([stock_data])
            
            # Re-generate the HTML dashboard template too
            try:
                all_stocks_df = pd.DataFrame(db.load_stocks())
                if not all_stocks_df.empty:
                    FinvizScraper.save_to_html(all_stocks_df, 'stocks_data.html')
            except Exception as html_err:
                print(f"Warning: Failed to save HTML cache: {html_err}")
                
    except Exception as scrape_err:
        print(f"Warning: Single stock scrape failed for {symbol}: {scrape_err}")

    # Return the full updated stocks list
    return get_stocks()


@app.route('/api/tickers/bulk', methods=['POST'])
def add_tickers_bulk():
    """Bulk add tickers from a comma-separated list.
    Accepts: { "symbols": "AAPL, MSFT, GOOGL" }  OR  { "symbols": ["AAPL","MSFT"] }
    Returns: { added: [...], skipped: [...], errors: [...] }
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    data = request.get_json() or {}
    raw = data.get('symbols', '')

    # Accept either a string or a list
    if isinstance(raw, list):
        candidates = [s.strip().upper() for s in raw if s.strip()]
    else:
        candidates = [s.strip().upper() for s in str(raw).replace(';', ',').split(',') if s.strip()]

    if not candidates:
        return jsonify({'error': 'No valid ticker symbols provided'}), 400

    # Deduplicate within the request itself
    seen = set()
    unique_candidates = []
    for sym in candidates:
        if sym not in seen:
            seen.add(sym)
            unique_candidates.append(sym)

    tickers = load_tickers()
    existing_symbols = {t['symbol'].upper() for t in tickers}

    added = []
    skipped = []
    errors = []
    new_entries = []  # {symbol, name} to append

    # Separate already-existing from truly new
    truly_new = []
    for sym in unique_candidates:
        if sym in existing_symbols:
            skipped.append(sym)
        else:
            truly_new.append(sym)

    # Fetch names in parallel (up to 10 threads)
    def fetch(sym):
        name = fetch_name_from_finviz(sym)
        return sym, name

    if truly_new:
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {executor.submit(fetch, sym): sym for sym in truly_new}
            for future in as_completed(futures):
                sym = futures[future]
                try:
                    sym, name = future.result()
                    if name:
                        new_entries.append({'symbol': sym, 'name': name})
                        added.append(sym)
                    else:
                        errors.append({'symbol': sym, 'reason': 'Could not resolve name — ticker may be invalid'})
                except Exception as exc:
                    errors.append({'symbol': sym, 'reason': str(exc)})

    # Save all new entries to database
    if new_entries:
        db.save_tickers_bulk(new_entries)

        # Trigger background scrape for just the new symbols
        def scrape_new_symbols():
            for entry in new_entries:
                sym, name = entry['symbol'], entry['name']
                try:
                    stock_data = FinvizScraper.scrape_single_stock_dict(sym, name)
                    if stock_data:
                        db.save_stocks_batch([stock_data])
                        try:
                            all_stocks_df = pd.DataFrame(db.load_stocks())
                            if not all_stocks_df.empty:
                                FinvizScraper.save_to_html(all_stocks_df, 'stocks_data.html')
                        except Exception:
                            pass
                except Exception as e:
                    print(f"Warning: Bulk scrape failed for {sym}: {e}")

        thread = threading.Thread(target=scrape_new_symbols)
        thread.daemon = True
        thread.start()

    return jsonify({
        'added': added,
        'skipped': skipped,
        'errors': errors,
        'message': f"Added {len(added)}, skipped {len(skipped)} duplicates, {len(errors)} errors."
    })


@app.route('/api/tickers/<symbol>', methods=['DELETE'])
def delete_ticker(symbol):
    symbol = symbol.strip().upper()
    tickers = db.load_tickers()
    stocks = db.load_stocks()
    
    in_tickers = any(t['symbol'].strip().upper() == symbol for t in tickers)
    in_stocks = any(str(s.get('Ticker', '')).strip().upper() == symbol for s in stocks)
    
    if not in_tickers and not in_stocks:
        return jsonify({'error': f'Ticker {symbol} not found'}), 404
        
    db.delete_ticker(symbol)
    
    # Re-generate HTML
    try:
        all_stocks_df = pd.DataFrame(db.load_stocks())
        if not all_stocks_df.empty:
            FinvizScraper.save_to_html(all_stocks_df, 'stocks_data.html')
    except Exception as html_err:
        print(f"Warning: Failed to save HTML cache: {html_err}")
            
    return get_stocks()

@app.route('/api/stocks', methods=['GET'])
def get_stocks():
    # Load scraped data
    stocks_list = db.load_stocks()
    scraped_df = pd.DataFrame(stocks_list) if stocks_list else pd.DataFrame()

    # Merge so unscraped tickers still appear as stub rows
    tickers = db.load_tickers()
    scraped_symbols = set(scraped_df['Ticker'].astype(str).str.upper()) if not scraped_df.empty else set()

    stub_rows = []
    for t in tickers:
        sym = t['symbol'].upper()
        if sym not in scraped_symbols:
            stub_rows.append({'Ticker': sym, 'Name': t['name'], '_pending': True})

    if stub_rows:
        stub_df = pd.DataFrame(stub_rows)
        if scraped_df.empty:
            combined = stub_df
        else:
            combined = pd.concat([scraped_df, stub_df], ignore_index=True)
    else:
        combined = scraped_df

    combined = combined.fillna('')
    records = combined.to_dict(orient='records')
    return jsonify(records)


@app.route('/api/scrape', methods=['POST'])
def trigger_scrape():
    global scrape_status
    if scrape_status['running']:
        return jsonify({'error': 'Scrape is already running'}), 400
        
    # Start thread
    thread = threading.Thread(target=run_full_scrape_thread)
    thread.daemon = True
    thread.start()
    
    return jsonify({'status': 'Scrape started'})

@app.route('/api/scrape/status', methods=['GET'])
def get_scrape_status():
    global scrape_status
    return jsonify(scrape_status)


@app.route('/api/db/seed', methods=['GET', 'POST'])
def seed_db():
    if not db.is_db_enabled():
        return jsonify({'error': 'Database is not enabled (running in CSV fallback mode)'}), 400
        
    conn = None
    try:
        conn = db.get_connection()
        cur = conn.cursor()
        
        # 1. Seed tickers (upsert missing default tickers)
        cur.execute("SELECT COUNT(*) FROM tickers;")
        tickers_count = cur.fetchone()[0]
        tickers_seeded = 0
        if os.path.exists('tickers.csv'):
            with open('tickers.csv', newline='') as f:
                reader = csv.reader(f)
                header = next(reader, None)  # skip header
                for row in reader:
                    if row:
                        symbol = row[0].strip().upper()
                        name = row[1].strip() if len(row) > 1 else ''
                        if symbol and symbol != 'SYMBOL':
                            cur.execute("""
                                INSERT INTO tickers (symbol, name)
                                VALUES (%s, %s)
                                ON CONFLICT (symbol) DO NOTHING;
                            """, (symbol, name))
                            tickers_seeded += 1
            conn.commit()
                
        # 2. Seed stocks (upsert missing default stocks)
        cur.execute("SELECT COUNT(*) FROM stocks;")
        stocks_count = cur.fetchone()[0]
        stocks_seeded = 0
        if os.path.exists('stocks_data.csv'):
            df = pd.read_csv('stocks_data.csv').fillna('')
            stocks_list = df.to_dict(orient='records')
            for s in stocks_list:
                ticker = s.get('Ticker', s.get('symbol', '')).strip().upper()
                if not ticker:
                    continue
                name = s.get('Name', '')
                sector = s.get('Sector', '')
                comp_score = s.get('Composite Score', None)
                if comp_score is not None and comp_score != '' and comp_score != '-':
                    try:
                        comp_score = int(float(str(comp_score).replace('%', '')))
                    except:
                        comp_score = None
                else:
                    comp_score = None
                
                # Convert dict keys to match database expectations
                data_json = json.dumps(s)
                cur.execute("""
                    INSERT INTO stocks (ticker, name, sector, composite_score, data)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (ticker) DO NOTHING;
                """, (ticker, name, sector, comp_score, data_json))
                stocks_seeded += 1
            conn.commit()
                
        return jsonify({
            'status': 'success',
            'message': 'Database seeded successfully',
            'tickers_in_db_before': tickers_count,
            'tickers_seeded_now': tickers_seeded,
            'stocks_in_db_before': stocks_count,
            'stocks_seeded_now': stocks_seeded
        })
    except Exception as e:
        import traceback
        if conn:
            conn.rollback()
        return jsonify({
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/tradingview/refresh', methods=['POST'])
def refresh_tradingview():
    """Quick-refresh real-time TradingView technicals and analyst targets for all stocks in ~300ms."""
    import tradingview_service
    stocks_list = db.load_stocks()
    if not stocks_list:
        return jsonify({'error': 'No stocks data available to refresh'}), 400

    try:
        df = pd.DataFrame(stocks_list)
        symbols = df['Ticker'].dropna().tolist()
        tv_batch = tradingview_service.fetch_tradingview_batch(symbols)

        tv_cols = [
            'TV Technical', 'TV Score', 'TV RSI', 'Analyst Target', 
            'Analyst High', 'Analyst Low', 'Target Upside %', 
            'Analyst Rating', 'Next Earnings Date', 'Days to Earnings'
        ]
        for col in tv_cols:
            df[col] = df['Ticker'].map(lambda s: tv_batch.get(str(s).strip().upper(), {}).get(col, ''))

        # Recalculate Composite Scores
        scores = []
        for _, row in df.iterrows():
            s, _ = tradingview_service.calculate_composite_score(row.to_dict())
            scores.append(s)
        df['Composite Score'] = scores

        db.save_stocks_batch(df.to_dict(orient='records'))
        
        try:
            FinvizScraper.save_to_html(df, 'stocks_data.html')
        except Exception:
            pass
            
        return jsonify({'message': f'Refreshed TradingView metrics and scores for {len(symbols)} stocks'})
    except Exception as e:
        return jsonify({'error': f'Failed to refresh TradingView metrics: {str(e)}'}), 500


@app.route('/api/news/<symbol>', methods=['GET'])
def get_news(symbol):
    """Fetch live breaking news headlines and catalysts for a stock symbol."""
    import tradingview_service
    symbol = symbol.strip().upper()
    try:
        limit = request.args.get('limit', default=10, type=int)
        news_items = tradingview_service.fetch_tradingview_news(symbol, limit=limit)
        return jsonify({'symbol': symbol, 'news': news_items})
    except Exception as e:
        return jsonify({'error': f'Failed to fetch news: {str(e)}', 'news': []}), 500


def decode_guru_nuxt_state(script_text):
    """Decodes variable mapping in GuruFocus window.__NUXT__ state."""
    import re
    param_match = re.search(r'\(function\(([^)]+)\)', script_text)
    if not param_match:
        return {}
    params = [p.strip() for p in param_match.group(1).split(',')]
    
    idx = script_text.rfind('}(')
    if idx == -1:
        return {}
    args_str = script_text[idx+2:]
    if args_str.endswith('));'):
        args_str = args_str[:-3]
    elif args_str.endswith(');'):
        args_str = args_str[:-2]
    
    args = []
    curr = []
    in_quotes = False
    quote_char = ''
    depth = 0
    i = 0
    n = len(args_str)
    while i < n:
        c = args_str[i]
        if in_quotes:
            curr.append(c)
            if c == '\\':
                if i + 1 < n:
                    i += 1
                    curr.append(args_str[i])
            elif c == quote_char:
                in_quotes = False
        else:
            if c in ('"', "'"):
                in_quotes = True
                quote_char = c
                curr.append(c)
            elif c in ('{', '['):
                depth += 1
                curr.append(c)
            elif c in ('}', ']'):
                depth -= 1
                curr.append(c)
            elif c == ',' and depth == 0:
                args.append(''.join(curr).strip())
                curr = []
            else:
                curr.append(c)
        i += 1
    if curr:
        args.append(''.join(curr).strip())

    mapping = dict(zip(params, args))
    
    def resolve_val(raw):
        if raw in mapping:
            raw = mapping[raw]
        if isinstance(raw, str):
            if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
                return raw[1:-1]
            try:
                if '.' in raw:
                    return float(raw)
                return int(raw)
            except:
                return raw
        return raw

    res = {}
    for key in ['wacc', 'gf_value', 'gf_score', 'moat_score', 'predictability', 'financial_strength', 'profitability_rank', 'growth_rank']:
        m = re.search(r'\b' + key + r'\s*:\s*([a-zA-Z0-9_$]+)', script_text)
        if m:
            res[key] = resolve_val(m.group(1))
    return res


@app.route('/api/overview/<symbol>', methods=['GET'])
def get_overview(symbol):
    """Fetch structured company business description, economic moat rating, and key metadata."""
    from curl_cffi import requests as curl_requests
    import re
    symbol = symbol.strip().upper()
    guru_symbol = symbol.replace('-', '.')
    
    description = ''
    moat_rating = ''
    moat_score = None
    moat_label = 'Not available'
    gf_score = None
    gf_value = None
    predictability = None
    wacc = None
    meta = {}
    
    try:
        r = curl_requests.get(
            f"https://www.gurufocus.com/stock/{guru_symbol}/summary",
            impersonate="chrome",
            timeout=12
        )
        
        if r.status_code == 200:
            soup = BeautifulSoup(r.content, 'html.parser')

            # 1. Clean narrative business description (div.desc-node contains only narrative)
            desc_node = soup.select_one('div.desc-node')
            if desc_node and desc_node.text.strip():
                raw_desc = desc_node.text.strip()
                if raw_desc.lower().startswith('description'):
                    description = raw_desc[11:].strip()
                else:
                    description = raw_desc
            
            # 2. Extract structured corporate metadata from business-description container
            desc_container = soup.select_one('div.business-description')
            if desc_container:
                container_text = desc_container.text
                
                # Official Website
                web_match = re.search(r'(https?://[^\s]+)', container_text)
                if web_match:
                    meta['website'] = web_match.group(1).rstrip('.,;')
                
                # Employees
                emp_match = re.search(r'Total Employee Number:\s*([\d,]+)', container_text)
                if emp_match:
                    meta['employees'] = emp_match.group(1)
                
                # IPO Date
                ipo_match = re.search(r'IPO Date\s*:\s*([\d-]+)|IPO Date\s*\n\s*([\d-]+)', container_text)
                if ipo_match:
                    meta['ipo_date'] = ipo_match.group(1) or ipo_match.group(2)
                
                # ISIN / SIC / NAICS
                isin_match = re.search(r'ISIN\s*:\s*([A-Z0-9]+)', container_text)
                if isin_match:
                    meta['isin'] = isin_match.group(1)
                    
                sic_match = re.search(r'SIC\s*:\s*(\d+)', container_text)
                if sic_match:
                    meta['sic'] = sic_match.group(1)
                    
                naics_match = re.search(r'NAICS\s*:\s*(\d+)', container_text)
                if naics_match:
                    meta['naics'] = naics_match.group(1)
                
                # Benchmark Indices
                idx_match = re.search(r'Index Membership\s+([A-Za-z0-9\s&,]+?)(?=IPO Date|Traded in|Description|$)', container_text)
                if idx_match:
                    raw_indices = idx_match.group(1).strip()
                    cleaned_indices = []
                    for known in ['Dow 30', 'S&P 500', 'NASDAQ 100', 'Russell 1000', 'Russell 2000', 'Russell 3000', 'MSCI World Index', 'Dividend King', 'Dividend Aristocrat', 'S&P 100']:
                        if known in raw_indices:
                            cleaned_indices.append(known)
                    meta['indices'] = cleaned_indices if cleaned_indices else [raw_indices]
                
                # Address / Headquarters
                addr_match = re.search(r'https?://[^\s]+\s+([^,\n]+,[^,\n]+,[^,\n]+,[^,\n]+(?:,\s*[\d-]+)?)\s+(?:Total Employee|Share Class|Compare)', container_text)
                if addr_match:
                    meta['address'] = addr_match.group(1).strip()

            # 3. Decode Nuxt state for Moat, GF Score, Predictability, etc.
            for script in soup.find_all('script'):
                if script.string and 'window.__NUXT__' in script.string:
                    nuxt_data = decode_guru_nuxt_state(script.string)
                    if nuxt_data:
                        moat_score = nuxt_data.get('moat_score')
                        gf_score = nuxt_data.get('gf_score')
                        gf_value = nuxt_data.get('gf_value')
                        predictability = nuxt_data.get('predictability')
                        wacc = nuxt_data.get('wacc')
                    break

        # Fallback to Finviz profile description if GuruFocus description is missing
        if not description or len(description) < 40:
            try:
                finviz_sym = symbol.replace('.', '-')
                rf = curl_requests.get(f"https://finviz.com/quote.ashx?t={finviz_sym}", impersonate="chrome", timeout=8)
                if rf.status_code == 200:
                    fsoup = BeautifulSoup(rf.content, 'html.parser')
                    fdesc = fsoup.select_one('td.fullview-profile')
                    if fdesc and fdesc.text.strip():
                        description = fdesc.text.strip()
            except Exception:
                pass

        # Calculate qualitative moat label & tier
        if moat_score is not None and moat_score != '':
            try:
                ms_num = int(moat_score)
                if ms_num >= 9:
                    moat_rating = 'Wide'
                    moat_label = f'Wide Moat ({ms_num}/10)'
                elif ms_num >= 7:
                    moat_rating = 'Narrow'
                    moat_label = f'Narrow Moat ({ms_num}/10)'
                elif ms_num >= 5:
                    moat_rating = 'Moderate'
                    moat_label = f'Moderate Moat ({ms_num}/10)'
                else:
                    moat_rating = 'None'
                    moat_label = f'No Moat ({ms_num}/10)'
            except Exception:
                moat_rating = str(moat_score)
                moat_label = f'Moat Score: {moat_score}'

        return jsonify({
            'symbol': symbol,
            'description': description,
            'moat': moat_rating,
            'moat_score': moat_score,
            'moat_label': moat_label,
            'gf_score': gf_score,
            'gf_value': gf_value,
            'predictability': predictability,
            'wacc': wacc,
            'meta': meta
        })
    except Exception as e:
        print(f"Error fetching overview for {symbol}: {e}")
        return jsonify({
            'symbol': symbol,
            'description': '',
            'moat': '',
            'moat_score': None,
            'moat_label': 'Not available',
            'gf_score': None,
            'gf_value': None,
            'predictability': None,
            'wacc': None,
            'meta': {}
        })

# Serve React static app
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(app.static_folder + '/' + path):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    # Start the server on port 5001 (standard for local API servers)
    app.run(host='0.0.0.0', port=5001, debug=True)
