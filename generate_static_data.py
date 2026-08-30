import os
import json
import pandas as pd

STOCKS_CSV = 'stocks_data.csv'
TICKERS_CSV = 'tickers.csv'
PUBLIC_API_DIR = 'frontend/public/api'

def load_tickers():
    tickers = []
    if os.path.exists(TICKERS_CSV):
        try:
            df = pd.read_csv(TICKERS_CSV)
            # Find the correct column names (case-insensitive or by position)
            # Typically headers are 'Symbol', 'Name'
            for _, row in df.iterrows():
                symbol = str(row.iloc[0]).strip()
                name = str(row.iloc[1]).strip() if len(row) > 1 else ''
                if symbol and symbol != 'nan' and symbol != 'Symbol':
                    tickers.append({'symbol': symbol, 'name': name})
        except Exception as e:
            print(f"Error loading tickers.csv: {e}")
    return tickers

def generate_json():
    # Make sure output directory exists
    os.makedirs(PUBLIC_API_DIR, exist_ok=True)

    # 1. Load and save tickers.json
    tickers = load_tickers()
    with open(os.path.join(PUBLIC_API_DIR, 'tickers.json'), 'w') as f:
        json.dump(tickers, f, indent=2)
    print(f"Saved tickers.json to {PUBLIC_API_DIR}")

    # 2. Load and merge stocks.json
    scraped_df = pd.DataFrame()
    if os.path.exists(STOCKS_CSV):
        try:
            scraped_df = pd.read_csv(STOCKS_CSV).fillna('')
        except Exception as e:
            print(f"Error reading stocks_data.csv: {e}")

    scraped_symbols = set(scraped_df['Ticker'].astype(str).str.upper()) if not scraped_df.empty else set()

    stub_rows = []
    for t in tickers:
        sym = t['symbol'].upper()
        if sym not in scraped_symbols:
            stub_rows.append({'Ticker': sym, 'Name': t['name'], '_pending': True})

    if stub_rows:
        stub_df = pd.DataFrame(stub_rows).fillna('')
        if scraped_df.empty:
            combined = stub_df
        else:
            combined = pd.concat([scraped_df, stub_df], ignore_index=True).fillna('')
    else:
        combined = scraped_df

    # Convert numeric columns to actual float/int types if they represent numbers
    # to avoid double JSON serialization errors or string types in frontend
    records = combined.to_dict(orient='records')
    with open(os.path.join(PUBLIC_API_DIR, 'stocks.json'), 'w') as f:
        json.dump(records, f, indent=2)
    print(f"Saved stocks.json to {PUBLIC_API_DIR}")

    # 3. Save status.json
    status = {
        'running': False,
        'progress': 0,
        'total': len(tickers),
        'message': 'Read-only Demo Mode'
    }
    with open(os.path.join(PUBLIC_API_DIR, 'status.json'), 'w') as f:
        json.dump(status, f, indent=2)
    print(f"Saved status.json to {PUBLIC_API_DIR}")

if __name__ == '__main__':
    generate_json()
