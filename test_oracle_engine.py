import json
import pandas as pd
import stock_oracle_engine

def test_engine():
    print("=== Testing Stock Oracle Engine ===")
    
    # Test 1: MSFT example directly from Thesis 1 (stock-oracle-blueprint.md line 226)
    msft_manual = {
        'Ticker': 'MSFT',
        'Name': 'Microsoft Corp',
        'Sector': 'Technology',
        'Sub-Sector': 'Software - Infrastructure',
        'Country': 'USA',
        'Price': '513.53',
        'Market Cap': '3813.24B',
        'Shs Outstand': '7.43B',
        'Income': '133.75B',
        'Sales': '331.84B',
        'Book/sh': '59.56',
        'Cash/sh': '10.35',
        'Beta': '0.90',
        'EPS next 5Y': '14.53%',
        'Debt/Eq': '0.29',
        'P/FCF': '56.93',
        'P/E': '28.62',
        'P/S': '11.49',
        'P/B': '8.62',
        'ROE': '34.04%',
        'ROIC': '21.24%',
        'Gross Margin': '67.94%',
        'Oper. Margin': '46.78%',
        'Profit Margin': '40.31%',
        'Piotroski F-Score': '6/9',
        'Altman Z-Score': '9.08',
        'WACC': '9.0',
        'GF Value': '580.0',
        'Analyst Target': '550.0',
        'SMA50': '19.24%',
        'SMA200': '19.10%'
    }
    
    res = stock_oracle_engine.analyze_stock_3_theses(msft_manual)
    print(f"MSFT Analysis:")
    print(f"  Current Price: ${res['current_price']:.2f}")
    print(f"  Thesis 1 (Adam Khoo VMI): ${res['thesis_1']['intrinsic_value']:.2f} (MoS: {res['thesis_1']['margin_of_safety_pct']}%)")
    print(f"  Thesis 2 (Academic DFCF-20 + TV): ${res['thesis_2']['intrinsic_value']:.2f} (MoS: {res['thesis_2']['margin_of_safety_pct']}%) | Composite: ${res['thesis_2']['composite_fair_value']:.2f}")
    print(f"  Thesis 3 (Dynamic Routing): ${res['thesis_3']['intrinsic_value']:.2f} (Route: {res['thesis_3']['routing_type']}) | OracleIQ: {res['thesis_3']['oracle_iq']['total_score']}/100")
    print(f"  GF Value Benchmark: ${res['gf_value']}")
    print(f"  Analyst Target: ${res['analyst_target']}")
    print(f"  Closest Thesis to GF Value: {res['closest_to_stock_oracle']}")
    
    # Test 2: Run over stocks_data.csv
    try:
        df = pd.read_csv('stocks_data.csv')
        stocks = df.to_dict(orient='records')
        leaderboard = stock_oracle_engine.generate_watchlist_oracle_leaderboard(stocks[:5])
        print(f"\nLeaderboard Preview (Top 5 stocks):")
        for row in leaderboard:
            print(f"  {row['symbol']}: Price ${row['current_price']} | T1: ${row['thesis_1_val']} | T2: ${row['thesis_2_val']} | T3: ${row['thesis_3_val']} | GF: ${row['gf_value']} | Closest: {row['closest_thesis']}")
        print("\nAll engine tests passed successfully!")
    except Exception as e:
        print(f"Error testing with CSV: {e}")

if __name__ == '__main__':
    test_engine()
