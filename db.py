import os
import csv
import json
import urllib.parse

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, Json
    psycopg2_available = True
except ImportError:
    psycopg2_available = False
    RealDictCursor = None
    Json = None

DATABASE_URL = os.environ.get('DATABASE_URL')
TICKERS_CSV = 'tickers.csv'
STOCKS_CSV = 'stocks_data.csv'

def is_db_enabled():
    if DATABASE_URL and not psycopg2_available:
        print("Warning: DATABASE_URL is set but psycopg2-binary is not installed. Falling back to CSV mode.")
    return bool(DATABASE_URL) and psycopg2_available

def get_connection():
    if not DATABASE_URL:
        return None
    # Support connection pooling or direct connection.
    # Parse URL if psycopg2 fails to parse it directly (psycopg2 supports postgres:// and postgresql://)
    url = DATABASE_URL
    if url.startswith("postgres://"):
        # psycopg2 sometimes prefers postgresql://
        url = url.replace("postgres://", "postgresql://", 1)
    
    return psycopg2.connect(url, sslmode='require')

def init_db():
    if not is_db_enabled():
        return
    
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()
        
        # Create tickers table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tickers (
                symbol TEXT PRIMARY KEY,
                name TEXT
            );
        """)
        
        # Create stocks table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stocks (
                ticker TEXT PRIMARY KEY,
                name TEXT,
                sector TEXT,
                composite_score INTEGER,
                data JSONB
            );
        """)
        
        # Commit schema creation first
        conn.commit()
        
        # 1. Seed tickers if table is empty
        cur.execute("SELECT COUNT(*) FROM tickers;")
        tickers_count = cur.fetchone()[0]
        if tickers_count == 0:
            print("Tickers table is empty. Seeding default tickers from tickers.csv...")
            if os.path.exists(TICKERS_CSV):
                try:
                    with open(TICKERS_CSV, newline='') as f:
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
                    conn.commit()
                    print("Default tickers seeded successfully.")
                except Exception as seed_err:
                    print(f"Error seeding tickers: {seed_err}")
                    conn.rollback()

        # 2. Seed stocks if table is empty
        cur.execute("SELECT COUNT(*) FROM stocks;")
        stocks_count = cur.fetchone()[0]
        if stocks_count == 0:
            print("Stocks table is empty. Seeding default stocks from stocks_data.csv...")
            if os.path.exists(STOCKS_CSV):
                try:
                    import pandas as pd
                    df = pd.read_csv(STOCKS_CSV).fillna('')
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
                        
                        data_json = json.dumps(s)
                        cur.execute("""
                            INSERT INTO stocks (ticker, name, sector, composite_score, data)
                            VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT (ticker) DO NOTHING;
                        """, (ticker, name, sector, comp_score, data_json))
                    conn.commit()
                    print("Default stocks seeded successfully.")
                except Exception as seed_err:
                    print(f"Error seeding stocks: {seed_err}")
                    conn.rollback()

        print("Database initialized successfully.")
    except Exception as e:
        print(f"Error initializing database: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()

# Initialize database on import
init_db()

# ==============================================================================
# TICKERS API
# ==============================================================================

def load_tickers():
    if is_db_enabled():
        conn = None
        try:
            conn = get_connection()
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute("SELECT symbol, name FROM tickers ORDER BY symbol ASC")
            rows = cur.fetchall()
            return [{'symbol': r['symbol'], 'name': r['name']} for r in rows]
        except Exception as e:
            print(f"DB Error loading tickers: {e}")
            return []
        finally:
            if conn:
                conn.close()
    else:
        # Fallback to CSV
        tickers = []
        if os.path.exists(TICKERS_CSV):
            try:
                with open(TICKERS_CSV, newline='') as f:
                    reader = csv.reader(f)
                    header = next(reader, None)  # skip header
                    for row in reader:
                        if row:
                            tickers.append({
                                'symbol': row[0].strip(),
                                'name': row[1].strip() if len(row) > 1 else ''
                            })
            except Exception as e:
                print(f"CSV Error loading tickers: {e}")
        return tickers

def save_ticker(symbol, name):
    symbol = symbol.strip().upper()
    name = name.strip()
    
    if is_db_enabled():
        conn = None
        try:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO tickers (symbol, name)
                VALUES (%s, %s)
                ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name;
            """, (symbol, name))
            conn.commit()
            return True
        except Exception as e:
            print(f"DB Error saving ticker: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                conn.close()
    else:
        # Fallback to CSV
        tickers = load_tickers()
        # Update or append
        found = False
        for t in tickers:
            if t['symbol'] == symbol:
                t['name'] = name
                found = True
                break
        if not found:
            tickers.append({'symbol': symbol, 'name': name})
        
        try:
            with open(TICKERS_CSV, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['Symbol', 'Name'])
                for t in tickers:
                    writer.writerow([t['symbol'], t['name']])
            return True
        except Exception as e:
            print(f"CSV Error saving tickers: {e}")
            return False

def save_tickers_bulk(tickers_list):
    """Save a list of dicts: [{'symbol': ..., 'name': ...}]"""
    if is_db_enabled():
        conn = None
        try:
            conn = get_connection()
            cur = conn.cursor()
            for t in tickers_list:
                sym = t['symbol'].strip().upper()
                name = t['name'].strip()
                cur.execute("""
                    INSERT INTO tickers (symbol, name)
                    VALUES (%s, %s)
                    ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name;
                """, (sym, name))
            conn.commit()
            return True
        except Exception as e:
            print(f"DB Error bulk saving tickers: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                conn.close()
    else:
        # Fallback to CSV
        existing = {t['symbol']: t['name'] for t in load_tickers()}
        for t in tickers_list:
            existing[t['symbol'].strip().upper()] = t['name'].strip()
        
        try:
            with open(TICKERS_CSV, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['Symbol', 'Name'])
                for sym, name in existing.items():
                    writer.writerow([sym, name])
            return True
        except Exception as e:
            print(f"CSV Error bulk saving tickers: {e}")
            return False

def delete_ticker(symbol):
    symbol = symbol.strip().upper()
    
    if is_db_enabled():
        conn = None
        try:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("DELETE FROM tickers WHERE symbol = %s", (symbol,))
            cur.execute("DELETE FROM stocks WHERE ticker = %s", (symbol,))
            conn.commit()
            return True
        except Exception as e:
            print(f"DB Error deleting ticker {symbol}: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                conn.close()
    else:
        # Fallback to CSV
        tickers = load_tickers()
        updated_tickers = [t for t in tickers if t['symbol'] != symbol]
        if len(updated_tickers) == len(tickers):
            return False
        
        try:
            with open(TICKERS_CSV, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['Symbol', 'Name'])
                for t in updated_tickers:
                    writer.writerow([t['symbol'], t['name']])
        except Exception as e:
            print(f"CSV Error deleting ticker: {e}")
            return False
            
        # Also remove from stocks_data.csv
        if os.path.exists(STOCKS_CSV):
            try:
                import pandas as pd
                df = pd.read_csv(STOCKS_CSV)
                df = df[df['Ticker'] != symbol]
                df.to_csv(STOCKS_CSV, index=False)
            except Exception as e:
                print(f"CSV Error deleting stock record: {e}")
        return True

# ==============================================================================
# STOCKS DATA API
# ==============================================================================

def load_stocks():
    if is_db_enabled():
        conn = None
        try:
            conn = get_connection()
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute("SELECT ticker, name, sector, composite_score, data FROM stocks")
            rows = cur.fetchall()
            
            records = []
            for r in rows:
                # Merge the JSONB data field with outer columns
                record = dict(r['data'])
                record['Ticker'] = r['ticker']
                record['Name'] = r['name']
                record['Sector'] = r['sector']
                record['Composite Score'] = r['composite_score']
                records.append(record)
            return records
        except Exception as e:
            print(f"DB Error loading stocks: {e}")
            return []
        finally:
            if conn:
                conn.close()
    else:
        # Fallback to CSV
        if os.path.exists(STOCKS_CSV):
            try:
                import pandas as pd
                df = pd.read_csv(STOCKS_CSV).fillna('')
                return df.to_dict(orient='records')
            except Exception as e:
                print(f"CSV Error loading stocks: {e}")
                return []
        return []

def save_stocks_batch(stocks_list):
    """Upsert a list of stocks (list of dictionaries) into the database or local CSV."""
    if not stocks_list:
        return True
        
    if is_db_enabled():
        conn = None
        try:
            conn = get_connection()
            cur = conn.cursor()
            
            for s in stocks_list:
                ticker = s.get('Ticker', s.get('symbol', '')).strip().upper()
                if not ticker:
                    continue
                
                name = s.get('Name', '')
                sector = s.get('Sector', '')
                
                # Extract composite score safely
                comp_score = s.get('Composite Score', None)
                if comp_score is not None and comp_score != '' and comp_score != '-':
                    try:
                        comp_score = int(float(str(comp_score).replace('%', '')))
                    except:
                        comp_score = None
                else:
                    comp_score = None
                
                # Filter out outer keys from JSONB field for redundancy reduction (optional, but clean)
                # Keep them all inside data for robust backwards compatibility
                data_json = Json(s)
                
                cur.execute("""
                    INSERT INTO stocks (ticker, name, sector, composite_score, data)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (ticker) DO UPDATE SET 
                        name = EXCLUDED.name,
                        sector = EXCLUDED.sector,
                        composite_score = EXCLUDED.composite_score,
                        data = EXCLUDED.data;
                """, (ticker, name, sector, comp_score, data_json))
                
            conn.commit()
            print(f"Successfully saved {len(stocks_list)} stocks to database.")
            return True
        except Exception as e:
            print(f"DB Error bulk saving stocks: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                conn.close()
    else:
        # Fallback to CSV
        import pandas as pd
        df_new = pd.DataFrame(stocks_list)
        
        if os.path.exists(STOCKS_CSV):
            try:
                df_old = pd.read_csv(STOCKS_CSV)
                # Remove duplicates based on Ticker
                tickers_to_save = set(df_new['Ticker'].astype(str).str.upper())
                df_old = df_old[~df_old['Ticker'].astype(str).str.upper().isin(tickers_to_save)]
                df = pd.concat([df_old, df_new], ignore_index=True)
            except Exception as e:
                print(f"CSV read error during merge: {e}")
                df = df_new
        else:
            df = df_new
            
        try:
            df.to_csv(STOCKS_CSV, index=False)
            print(f"Successfully saved {len(stocks_list)} stocks to CSV file.")
            return True
        except Exception as e:
            print(f"CSV save error: {e}")
            return False
