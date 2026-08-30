/**
 * Live Stock Enrichment Service
 * Provides client-side real-time stock lookup via TradingView Scanner API.
 * Only populates verified real-world metrics (Price, P/E, Margins, Technicals, Analyst Targets).
 * GuruFocus-exclusive metrics (GF Value, F-Score, Z-Score, WACC) are marked as pending real scrape
 * rather than fabricating dummy values.
 */

export async function fetchLiveStockDetails(symbols) {
  if (!symbols || symbols.length === 0) return [];

  const cleanSymbols = symbols.map(s => String(s).trim().toUpperCase().replace('.', '-')).filter(Boolean);
  const querySymbols = cleanSymbols.map(s => s.replace('-', '.'));

  try {
    const res = await fetch("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: [{ left: "name", operation: "in_range", right: querySymbols }],
        columns: [
          "name", "description", "close", "change", "sector",
          "market_cap_basic", "price_earnings_ttm", "price_book_ratio", "price_sales_ratio",
          "enterprise_value_ebitda_ttm", "current_ratio", "quick_ratio", "debt_to_equity",
          "return_on_assets", "return_on_equity", "gross_margin", "operating_margin", "net_margin",
          "Recommend.All", "RSI", "price_target_median", "price_target_high", "price_target_low",
          "recommendation_mark", "earnings_release_next_date", "dividends_yield_current"
        ],
        range: [0, Math.max(50, querySymbols.length + 10)]
      })
    });

    if (!res.ok) {
      return cleanSymbols.map(sym => ({
        Ticker: sym,
        Name: sym,
        Sector: '-',
        Price: '-',
        _pending: true,
        _pendingGF: true
      }));
    }

    const data = await res.json();
    const rows = data.data || [];
    const nowSec = Math.floor(Date.now() / 1000);

    const resultMap = {};
    for (const item of rows) {
      const vals = item.d || [];
      if (vals.length < 20) continue;
      const [
        tvName, desc, close, change, sector,
        mcap, pe, pb, ps,
        evEbitda, cr, qr, de,
        roa, roe, gm, om, nm,
        recAll, rsi, tgtMed, tgtH, tgtL,
        recMark, earnDate
      ] = vals;

      const sym = String(tvName).toUpperCase().replace('.', '-');

      // Technical label
      let tvTech = '';
      if (recAll !== null && recAll !== undefined) {
        if (recAll >= 0.5) tvTech = 'Strong Buy';
        else if (recAll >= 0.1) tvTech = 'Buy';
        else if (recAll <= -0.5) tvTech = 'Strong Sell';
        else if (recAll <= -0.1) tvTech = 'Sell';
        else tvTech = 'Neutral';
      }

      // Analyst Consensus
      let analystRating = '';
      if (recMark !== null && recMark !== undefined) {
        if (recMark < 1.8) analystRating = 'Strong Buy';
        else if (recMark < 2.3) analystRating = 'Buy';
        else if (recMark < 3.3) analystRating = 'Hold';
        else if (recMark < 4.3) analystRating = 'Underperform';
        else analystRating = 'Sell';
      }

      // Target Upside %
      let upsideStr = '';
      if (tgtMed && close && close > 0) {
        const up = ((tgtMed - close) / close) * 100;
        upsideStr = `${up >= 0 ? '+' : ''}${up.toFixed(2)}%`;
      }

      // Days to earnings
      let daysToEarnings = null;
      let earnDateStr = '';
      if (earnDate && earnDate > 0) {
        const d = new Date(earnDate * 1000);
        earnDateStr = d.toISOString().split('T')[0];
        const diff = Math.floor((earnDate - nowSec) / 86400);
        if (diff >= 0) daysToEarnings = diff;
      }

      // Market cap formatted
      let mcapStr = '';
      if (mcap) {
        if (mcap >= 1e12) mcapStr = `${(mcap / 1e12).toFixed(2)}B`;
        else if (mcap >= 1e9) mcapStr = `${(mcap / 1e9).toFixed(2)}B`;
        else if (mcap >= 1e6) mcapStr = `${(mcap / 1e6).toFixed(2)}M`;
      }

      resultMap[sym] = {
        Ticker: sym,
        Name: desc || sym,
        Sector: sector || '-',
        Price: close !== null && close !== undefined ? close.toFixed(2) : '-',
        'Change %': change !== null && change !== undefined ? `${change.toFixed(2)}%` : '-',
        'Market Cap': mcapStr || '-',
        'P/E': pe !== null && pe !== undefined ? pe.toFixed(2) : '-',
        'P/B': pb !== null && pb !== undefined ? pb.toFixed(2) : '-',
        'P/S': ps !== null && ps !== undefined ? ps.toFixed(2) : '-',
        'EV/EBITDA': evEbitda !== null && evEbitda !== undefined ? evEbitda.toFixed(2) : '-',
        'Current Ratio': cr !== null && cr !== undefined ? cr.toFixed(2) : '-',
        'Quick Ratio': qr !== null && qr !== undefined ? qr.toFixed(2) : '-',
        'Debt/Eq': de !== null && de !== undefined ? de.toFixed(2) : '-',
        ROA: roa !== null && roa !== undefined ? `${roa.toFixed(2)}%` : '-',
        ROE: roe !== null && roe !== undefined ? `${roe.toFixed(2)}%` : '-',
        'Gross Margin': gm !== null && gm !== undefined ? `${gm.toFixed(2)}%` : '-',
        'Oper. Margin': om !== null && om !== undefined ? `${om.toFixed(2)}%` : '-',
        'Profit Margin': nm !== null && nm !== undefined ? `${nm.toFixed(2)}%` : '-',
        'Piotroski F-Score': '-',
        'Altman Z-Score': '-',
        'Beneish M-Score': '-',
        'WACC': '-',
        'ROIC': '-',
        'GF Value': '-',
        'GF Valuation': '-',
        'TV Symbol': item.s || `NASDAQ:${sym}`,
        'TV Technical': tvTech,
        'TV Score': recAll !== null && recAll !== undefined ? recAll.toFixed(2) : '',
        'TV RSI': rsi !== null && rsi !== undefined ? rsi.toFixed(1) : '',
        'Analyst Target': tgtMed ? tgtMed.toFixed(2) : '',
        'Analyst High': tgtH ? tgtH.toFixed(2) : '',
        'Analyst Low': tgtL ? tgtL.toFixed(2) : '',
        'Target Upside %': upsideStr,
        'Analyst Rating': analystRating,
        'Next Earnings Date': earnDateStr,
        'Days to Earnings': daysToEarnings,
        'TV Close': close !== null && close !== undefined ? close.toFixed(2) : '',
        'Composite Score': '-',
        'Score Breakdown': '',
        _pendingGF: true
      };
    }

    return cleanSymbols.map(sym => resultMap[sym] || {
      Ticker: sym,
      Name: sym,
      Sector: '-',
      Price: '-',
      _pending: true,
      _pendingGF: true
    });
  } catch (err) {
    console.error("Live stock fetch error:", err);
    return cleanSymbols.map(sym => ({
      Ticker: sym,
      Name: sym,
      Sector: '-',
      Price: '-',
      _pending: true,
      _pendingGF: true
    }));
  }
}
