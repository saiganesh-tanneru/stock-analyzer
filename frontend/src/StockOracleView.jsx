import React, { useState, useEffect, useMemo } from 'react';

// Helper to format currency
const fmtCurr = (val) => {
  if (val === undefined || val === null || isNaN(val)) return '-';
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Helper to format percentage
const fmtPct = (val) => {
  if (val === undefined || val === null || isNaN(val)) return '-';
  const n = Number(val);
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
};

export default function StockOracleView({ 
  stocks = [], 
  selectedTicker = 'MSFT', 
  onSelectTicker = () => {}, 
  isDemo = false 
}) {
  const [activeSymbol, setActiveSymbol] = useState(selectedTicker || 'MSFT');
  const [analysisData, setAnalysisData] = useState(null);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('methodology'); // 'methodology' | 'projections' | 'sensitivity' | 'quality' | 'sandbox'
  const [viewMode, setViewMode] = useState('stock'); // 'stock' | 'leaderboard'
  const [searchFilter, setSearchFilter] = useState('');
  const [leaderboardSortKey, setLeaderboardSortKey] = useState('thesis_1_mos');
  const [leaderboardSortDir, setLeaderboardSortDir] = useState('desc');

  // Interactive Sandbox Tuning State
  const [sandboxG1, setSandboxG1] = useState(null);
  const [sandboxG2, setSandboxG2] = useState(null);
  const [sandboxGT, setSandboxGT] = useState(null);
  const [sandboxR, setSandboxR] = useState(null);
  const [isSandboxActive, setIsSandboxActive] = useState(false);

  // Sync with prop if selectedTicker changes
  useEffect(() => {
    if (selectedTicker && selectedTicker !== activeSymbol) {
      setActiveSymbol(selectedTicker);
    }
  }, [selectedTicker]);

  // Load Leaderboard on mount
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch('/api/oracle-analysis');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setLeaderboardData(data);
            return;
          }
        }
        throw new Error("Leaderboard API returned empty or failed");
      } catch (err) {
        // Fallback to static JSON
        try {
          const sRes = await fetch('api/oracle-analysis.json');
          if (sRes.ok) {
            const sData = await sRes.json();
            setLeaderboardData(sData);
          }
        } catch (e) {
          console.warn("Failed to load static leaderboard:", e);
        }
      }
    };
    fetchLeaderboard();
  }, [stocks]);

  // Fetch detailed analysis for activeSymbol
  useEffect(() => {
    let isMounted = true;
    const fetchStockAnalysis = async () => {
      setLoading(true);
      try {
        let url = `/api/oracle-analysis/${activeSymbol}`;
        if (isSandboxActive && (sandboxG1 !== null || sandboxR !== null)) {
          const params = new URLSearchParams();
          if (sandboxG1 !== null) params.append('g1', sandboxG1);
          if (sandboxG2 !== null) params.append('g2', sandboxG2);
          if (sandboxGT !== null) params.append('g3', sandboxGT);
          if (sandboxR !== null) params.append('r', sandboxR);
          url += `?${params.toString()}`;
        }

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setAnalysisData(data);
            if (!isSandboxActive && data.thesis_1) {
              setSandboxG1(Math.round(data.thesis_1.growth_years_1_5 * 1000) / 10);
              setSandboxG2(Math.round(data.thesis_1.growth_years_6_10 * 1000) / 10);
              setSandboxGT(Math.round(data.thesis_1.growth_years_11_20 * 1000) / 10);
              setSandboxR(Math.round(data.thesis_1.discount_rate * 1000) / 10);
            }
            setLoading(false);
            return;
          }
        }
        throw new Error(`API failed for ${activeSymbol}`);
      } catch (err) {
        // Fallback to static file in demo mode
        try {
          const sRes = await fetch(`api/oracle/${activeSymbol}.json`);
          if (sRes.ok) {
            const sData = await sRes.json();
            if (isMounted) {
              setAnalysisData(sData);
              if (!isSandboxActive && sData.thesis_1) {
                setSandboxG1(Math.round(sData.thesis_1.growth_years_1_5 * 1000) / 10);
                setSandboxG2(Math.round(sData.thesis_1.growth_years_6_10 * 1000) / 10);
                setSandboxGT(Math.round(sData.thesis_1.growth_years_11_20 * 1000) / 10);
                setSandboxR(Math.round(sData.thesis_1.discount_rate * 1000) / 10);
              }
              setLoading(false);
              return;
            }
          }
        } catch (sErr) {
          console.warn("Static stock analysis fallback failed:", sErr);
        }
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    if (activeSymbol) {
      fetchStockAnalysis();
    }
    return () => { isMounted = false; };
  }, [activeSymbol, isSandboxActive, sandboxG1, sandboxG2, sandboxGT, sandboxR]);

  // Handle stock selection
  const handleSelectStock = (sym) => {
    setActiveSymbol(sym);
    setIsSandboxActive(false);
    onSelectTicker(sym);
    setViewMode('stock');
  };

  // Reset sandbox sliders
  const handleResetSandbox = () => {
    if (analysisData && analysisData.thesis_1) {
      setSandboxG1(Math.round(analysisData.thesis_1.growth_years_1_5 * 1000) / 10);
      setSandboxG2(Math.round(analysisData.thesis_1.growth_years_6_10 * 1000) / 10);
      setSandboxGT(Math.round(analysisData.thesis_1.growth_years_11_20 * 1000) / 10);
      setSandboxR(Math.round(analysisData.thesis_1.discount_rate * 1000) / 10);
      setIsSandboxActive(false);
    }
  };

  // Popular stock quick-picker symbols
  const popularSymbols = ['MSFT', 'NVDA', 'AAPL', 'AMZN', 'GOOGL', 'META', 'TSLA', 'CRM', 'ADBE', 'NOW'];

  // Filtered Leaderboard
  const filteredLeaderboard = useMemo(() => {
    let list = [...leaderboardData];
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      list = list.filter(item => 
        item.symbol.toLowerCase().includes(q) || 
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.sector && item.sector.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => {
      let valA = a[leaderboardSortKey];
      let valB = b[leaderboardSortKey];
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      if (typeof valA === 'string') {
        return leaderboardSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return leaderboardSortDir === 'asc' ? valA - valB : valB - valA;
    });
    return list;
  }, [leaderboardData, searchFilter, leaderboardSortKey, leaderboardSortDir]);

  const handleSortLeaderboard = (key) => {
    if (leaderboardSortKey === key) {
      setLeaderboardSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setLeaderboardSortKey(key);
      setLeaderboardSortDir('desc');
    }
  };

  return (
    <div className="oracle-view-container">
      {/* Top Controls & Navigation Header */}
      <div className="oracle-header-panel">
        <div className="oracle-title-area">
          <div className="oracle-brand-pill">
            <i className="fa-solid fa-brain-circuit"></i>
            <span>Stock Oracle™ 3-Thesis Valuation Lab</span>
          </div>
          <h2>Intrinsic Value Model Comparison & Reconciliation</h2>
          <p className="oracle-subtitle">
            Side-by-side calculation of the three research papers from Piranha Profits & Adam Khoo to benchmark accuracy against actual Stock Oracle and GuruFocus valuations.
          </p>
        </div>

        <div className="oracle-view-switcher">
          <button 
            className={`oracle-view-btn ${viewMode === 'stock' ? 'active' : ''}`}
            onClick={() => setViewMode('stock')}
          >
            <i className="fa-solid fa-chart-line"></i>
            <span>Single Stock Deep Dive</span>
          </button>
          <button 
            className={`oracle-view-btn ${viewMode === 'leaderboard' ? 'active' : ''}`}
            onClick={() => setViewMode('leaderboard')}
          >
            <i className="fa-solid fa-table-columns"></i>
            <span>3-Model Watchlist Leaderboard ({leaderboardData.length})</span>
          </button>
        </div>
      </div>

      {/* Quick Ticker Switcher */}
      <div className="oracle-quick-tickers">
        <span className="quick-label"><i className="fa-solid fa-bolt"></i> Quick Pick:</span>
        <div className="quick-pills-list">
          {popularSymbols.map(sym => (
            <button
              key={sym}
              className={`quick-ticker-pill ${activeSymbol === sym ? 'active' : ''}`}
              onClick={() => handleSelectStock(sym)}
            >
              {sym}
            </button>
          ))}
        </div>
        <div className="oracle-search-box">
          <i className="fa-solid fa-magnifying-glass"></i>
          <input 
            type="text" 
            placeholder="Type any ticker (e.g. AAPL, CRM, JPM)..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchFilter.trim()) {
                handleSelectStock(searchFilter.trim().toUpperCase());
                setSearchFilter('');
              }
            }}
          />
          {searchFilter && (
            <button className="oracle-search-go" onClick={() => {
              handleSelectStock(searchFilter.trim().toUpperCase());
              setSearchFilter('');
            }}>
              Go
            </button>
          )}
        </div>
      </div>

      {/* VIEW MODE 1: SINGLE STOCK DEEP DIVE */}
      {viewMode === 'stock' && (
        <>
          {loading ? (
            <div className="oracle-loading-state">
              <i className="fa-solid fa-circle-notch fa-spin"></i>
              <p>Computing 3-Thesis Valuations for {activeSymbol}...</p>
            </div>
          ) : !analysisData ? (
            <div className="oracle-error-state">
              <i className="fa-solid fa-triangle-exclamation text-warning"></i>
              <h3>No data available for {activeSymbol}</h3>
              <p>Please select another stock from the watchlist or enter a valid ticker.</p>
            </div>
          ) : (
            <div className="oracle-stock-layout">
              {/* Hero Stock Header Banner */}
              <div className="oracle-hero-card">
                <div className="hero-info-left">
                  <div className="hero-badge-row">
                    <span className="hero-ticker-badge">{analysisData.symbol}</span>
                    <span className="hero-sector-tag">{analysisData.sector || 'Equities'}</span>
                    {analysisData.sub_sector && <span className="hero-subsector-tag">{analysisData.sub_sector}</span>}
                    <span className="hero-country-tag">{analysisData.country}</span>
                  </div>
                  <h1 className="hero-company-name">{analysisData.name}</h1>
                  <div className="hero-meta-strip">
                    <span className="meta-item"><strong>Market Cap:</strong> {fmtCurr(analysisData.market_cap)}</span>
                    <span className="meta-item"><strong>Beta:</strong> {analysisData.beta ? analysisData.beta.toFixed(2) : '1.00'}</span>
                    <span className="meta-item"><strong>WACC:</strong> {analysisData.wacc ? `${analysisData.wacc}%` : 'N/A'}</span>
                    <span className="meta-item"><strong>Current Price:</strong> <span className="hero-price">{fmtCurr(analysisData.current_price)}</span></span>
                  </div>
                </div>

                {/* External Benchmark Indicators */}
                <div className="hero-benchmark-panel">
                  <div className="benchmark-title">External Benchmarks</div>
                  <div className="benchmark-grid">
                    <div className="benchmark-stat">
                      <span className="b-label">Actual GF Value:</span>
                      <span className="b-val highlight-green">{analysisData.gf_value ? fmtCurr(analysisData.gf_value) : 'N/A'}</span>
                    </div>
                    <div className="benchmark-stat">
                      <span className="b-label">Analyst Target:</span>
                      <span className="b-val highlight-blue">{analysisData.analyst_target ? fmtCurr(analysisData.analyst_target) : 'N/A'}</span>
                    </div>
                    <div className="benchmark-stat">
                      <span className="b-label">3-Model Average:</span>
                      <span className="b-val highlight-purple">{fmtCurr(analysisData.average_thesis_fair_value)}</span>
                    </div>
                  </div>
                  <div className="closest-benchmark-pill">
                    <i className="fa-solid fa-bullseye"></i>
                    <span>Closest to Stock Oracle / GF Value: <strong>{analysisData.closest_to_stock_oracle}</strong></span>
                  </div>
                </div>
              </div>

              {/* 3 THESIS VALUES SIDE-BY-SIDE HERO CARDS */}
              <div className="oracle-three-cards-grid">
                {/* THESIS 1 CARD */}
                <div className="thesis-card thesis-1-card">
                  <div className="thesis-card-header">
                    <div className="thesis-number-badge">Thesis 1</div>
                    <span className="thesis-doc-tag" title="stock-oracle-blueprint.md">Adam Khoo VMI Blueprint</span>
                  </div>
                  <h3 className="thesis-title">Adam Khoo VMI Core Model</h3>
                  <p className="thesis-concept">20-Year DFCF with Beta-Risk discount rate table & net balance sheet adjustment.</p>
                  
                  <div className="thesis-fair-value-box">
                    <span className="fv-label">Calculated Intrinsic Value</span>
                    <div className="fv-number">{fmtCurr(analysisData.thesis_1.intrinsic_value)}</div>
                    <div className={`mos-badge mos-${analysisData.thesis_1.margin_of_safety_pct >= 0 ? 'positive' : 'negative'}`}>
                      <i className={`fa-solid fa-arrow-${analysisData.thesis_1.margin_of_safety_pct >= 0 ? 'up' : 'down'}`}></i>
                      <span>Margin of Safety: {fmtPct(analysisData.thesis_1.margin_of_safety_pct)}</span>
                    </div>
                  </div>

                  <div className="thesis-details-list">
                    <div className="detail-row">
                      <span>Discount Rate Used:</span>
                      <strong>{analysisData.thesis_1.discount_rate_pct}%</strong>
                    </div>
                    <div className="detail-subtext">
                      <i className="fa-solid fa-shield-halved"></i> {analysisData.thesis_1.discount_rate_reason}
                    </div>
                    <div className="detail-row">
                      <span>Operational Cash Flow PV:</span>
                      <strong>{fmtCurr(analysisData.thesis_1.operational_pv_per_share)} / sh</strong>
                    </div>
                    <div className="detail-row">
                      <span>Net Cash / Debt Adj:</span>
                      <strong className={analysisData.thesis_1.net_debt_adj_per_share >= 0 ? 'text-success' : 'text-danger'}>
                        {fmtCurr(analysisData.thesis_1.net_debt_adj_per_share)} / sh
                      </strong>
                    </div>
                    <div className="detail-row">
                      <span>VMI 7-Step Quality Score:</span>
                      <span className="quality-pill">{analysisData.thesis_1.quality_score}</span>
                    </div>
                    <div className="detail-row">
                      <span>Conservative Buy (30% MoS):</span>
                      <strong className="text-success">{fmtCurr(analysisData.thesis_1.buy_under_30_pct)}</strong>
                    </div>
                  </div>

                  <div className="thesis-card-footer">
                    <span className={`signal-tag signal-${analysisData.thesis_1.signal_badge}`}>
                      {analysisData.thesis_1.signal}
                    </span>
                  </div>
                </div>

                {/* THESIS 2 CARD */}
                <div className="thesis-card thesis-2-card">
                  <div className="thesis-card-header">
                    <div className="thesis-number-badge">Thesis 2</div>
                    <span className="thesis-doc-tag" title="stockoracle_valuation_blueprint.md">Academic DFCF-20 Blueprint</span>
                  </div>
                  <h3 className="thesis-title">Academic DFCF-20 + Gordon Perpetuity</h3>
                  <p className="thesis-concept">20-Year forecast with Gordon Growth terminal value & Multi-Model Composite.</p>
                  
                  <div className="thesis-fair-value-box">
                    <span className="fv-label">DFCF-20 + Terminal Value</span>
                    <div className="fv-number">{fmtCurr(analysisData.thesis_2.intrinsic_value)}</div>
                    <div className={`mos-badge mos-${analysisData.thesis_2.margin_of_safety_pct >= 0 ? 'positive' : 'negative'}`}>
                      <i className={`fa-solid fa-arrow-${analysisData.thesis_2.margin_of_safety_pct >= 0 ? 'up' : 'down'}`}></i>
                      <span>Margin of Safety: {fmtPct(analysisData.thesis_2.margin_of_safety_pct)}</span>
                    </div>
                  </div>

                  <div className="thesis-details-list">
                    <div className="detail-row">
                      <span>Discount Rate / Terminal Growth:</span>
                      <strong>{analysisData.thesis_2.discount_rate_pct}% / {analysisData.thesis_2.terminal_growth_pct}%</strong>
                    </div>
                    <div className="detail-row">
                      <span>Terminal Value Contribution:</span>
                      <strong>{analysisData.thesis_2.tv_contribution_pct}% of EV</strong>
                    </div>
                    <div className="detail-row">
                      <span>Composite OracleStyleValue:</span>
                      <strong className="text-info">{fmtCurr(analysisData.thesis_2.composite_fair_value)}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Composite MoS:</span>
                      <strong className={analysisData.thesis_2.composite_mos_pct >= 0 ? 'text-success' : 'text-danger'}>
                        {fmtPct(analysisData.thesis_2.composite_mos_pct)}
                      </strong>
                    </div>
                    <div className="detail-row">
                      <span>Multi-Model DCF / DNI:</span>
                      <span>{fmtCurr(analysisData.thesis_2.multi_model_suite.dcf_no_tv)} / {fmtCurr(analysisData.thesis_2.multi_model_suite.dni_earnings)}</span>
                    </div>
                    <div className="detail-row">
                      <span>Fair P/E Benchmark:</span>
                      <span>{fmtCurr(analysisData.thesis_2.multi_model_suite.fair_pe)}</span>
                    </div>
                  </div>

                  <div className="thesis-card-footer">
                    <span className={`signal-tag signal-${analysisData.thesis_2.signal_badge}`}>
                      {analysisData.thesis_2.signal}
                    </span>
                  </div>
                </div>

                {/* THESIS 3 CARD */}
                <div className="thesis-card thesis-3-card">
                  <div className="thesis-card-header">
                    <div className="thesis-number-badge">Thesis 3</div>
                    <span className="thesis-doc-tag" title="A Comprehensive Blueprint for Algorithmic.md">Dynamic Multi-Modal Routing</span>
                  </div>
                  <h3 className="thesis-title">Dynamic Routing & OracleIQ™ 6D</h3>
                  <p className="thesis-concept">Sector-driven routing (DNI / PSG / DFCF) + 6-dimension quantitative scoring.</p>
                  
                  <div className="thesis-fair-value-box">
                    <span className="fv-label">Dynamic Routed Fair Value</span>
                    <div className="fv-number">{fmtCurr(analysisData.thesis_3.intrinsic_value)}</div>
                    <div className={`mos-badge mos-${analysisData.thesis_3.margin_of_safety_pct >= 0 ? 'positive' : 'negative'}`}>
                      <i className={`fa-solid fa-arrow-${analysisData.thesis_3.margin_of_safety_pct >= 0 ? 'up' : 'down'}`}></i>
                      <span>Margin of Safety: {fmtPct(analysisData.thesis_3.margin_of_safety_pct)}</span>
                    </div>
                  </div>

                  <div className="thesis-details-list">
                    <div className="detail-row">
                      <span>Applied Model Route:</span>
                      <span className="route-highlight-badge">{analysisData.thesis_3.routing_type}</span>
                    </div>
                    <div className="detail-subtext">
                      <i className="fa-solid fa-code-branch"></i> {analysisData.thesis_3.routing_rationale}
                    </div>
                    <div className="detail-row">
                      <span>OracleIQ™ Total Score:</span>
                      <strong className="text-warning">{analysisData.thesis_3.oracle_iq.total_score} / 100</strong>
                    </div>
                    <div className="detail-row">
                      <span>OracleMoat™ Score:</span>
                      <strong>{analysisData.thesis_3.oracle_iq.oracle_moat} / 100</strong>
                    </div>
                    <div className="detail-row">
                      <span>Financial Strength Score:</span>
                      <strong>{analysisData.thesis_3.oracle_iq.financial_strength} / 100</strong>
                    </div>
                    <div className="detail-row">
                      <span>Technical Momentum:</span>
                      <strong className="text-info">{analysisData.thesis_3.momentum.signal}</strong>
                    </div>
                  </div>

                  <div className="thesis-card-footer">
                    <span className={`signal-tag signal-${analysisData.thesis_3.signal_badge}`}>
                      {analysisData.thesis_3.signal}
                    </span>
                  </div>
                </div>
              </div>

              {/* IN-DEPTH TABS NAVIGATION */}
              <div className="oracle-tabs-container">
                <div className="oracle-tab-buttons">
                  <button 
                    className={`oracle-tab-btn ${activeTab === 'methodology' ? 'active' : ''}`}
                    onClick={() => setActiveTab('methodology')}
                  >
                    <i className="fa-solid fa-scale-balanced"></i> Side-by-Side Methodology
                  </button>
                  <button 
                    className={`oracle-tab-btn ${activeTab === 'projections' ? 'active' : ''}`}
                    onClick={() => setActiveTab('projections')}
                  >
                    <i className="fa-solid fa-timeline"></i> 20-Year Cash Flow Timeline
                  </button>
                  <button 
                    className={`oracle-tab-btn ${activeTab === 'sensitivity' ? 'active' : ''}`}
                    onClick={() => setActiveTab('sensitivity')}
                  >
                    <i className="fa-solid fa-chess-board"></i> Sensitivity Matrix (Thesis 2)
                  </button>
                  <button 
                    className={`oracle-tab-btn ${activeTab === 'quality' ? 'active' : ''}`}
                    onClick={() => setActiveTab('quality')}
                  >
                    <i className="fa-solid fa-list-check"></i> VMI Quality & OracleIQ™ 6D
                  </button>
                  <button 
                    className={`oracle-tab-btn ${activeTab === 'sandbox' ? 'active' : ''}`}
                    onClick={() => setActiveTab('sandbox')}
                  >
                    <i className="fa-solid fa-sliders"></i> What-If Scenario Sandbox
                  </button>
                </div>

                {/* TAB 1: SIDE-BY-SIDE METHODOLOGY */}
                {activeTab === 'methodology' && (
                  <div className="oracle-tab-panel">
                    <div className="panel-header">
                      <h3><i className="fa-solid fa-code-compare"></i> Side-by-Side Model Architecture & Valuation Bridge</h3>
                      <p>Compare the mathematical assumptions, starting metrics, discount rate formulas, and terminal value treatments of each thesis.</p>
                    </div>

                    <div className="comparison-table-wrapper">
                      <table className="comparison-table">
                        <thead>
                          <tr>
                            <th>Parameter / Step</th>
                            <th>Thesis 1: Adam Khoo VMI</th>
                            <th>Thesis 2: Academic DFCF-20 + TV</th>
                            <th>Thesis 3: Dynamic Multi-Modal</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td><strong>Target Document</strong></td>
                            <td><code>stock-oracle-blueprint.md</code></td>
                            <td><code>stockoracle_valuation_blueprint.md</code></td>
                            <td><code>A Comprehensive Blueprint for Algorithmic.md</code></td>
                          </tr>
                          <tr>
                            <td><strong>Starting Metric</strong></td>
                            <td>{analysisData.thesis_1.starting_metric_name} ({fmtCurr(analysisData.thesis_1.starting_metric_value)})</td>
                            <td>Normalized Free Cash Flow ({fmtCurr(analysisData.thesis_2.base_fcf)})</td>
                            <td>Dynamic Metric ({analysisData.thesis_3.routed_details.base_metric || 'FCF / Sales'})</td>
                          </tr>
                          <tr>
                            <td><strong>Near-Term Growth (Y1-5)</strong></td>
                            <td>{(analysisData.thesis_1.growth_years_1_5 * 100).toFixed(1)}%</td>
                            <td>{(analysisData.thesis_1.growth_years_1_5 * 100).toFixed(1)}%</td>
                            <td>{(analysisData.thesis_1.growth_years_1_5 * 100).toFixed(1)}%</td>
                          </tr>
                          <tr>
                            <td><strong>Mid-Term Growth (Y6-10)</strong></td>
                            <td>{(analysisData.thesis_1.growth_years_6_10 * 100).toFixed(1)}% (Conservative Stepdown)</td>
                            <td>{(analysisData.thesis_1.growth_years_6_10 * 100).toFixed(1)}% (Staged Deceleration)</td>
                            <td>{((analysisData.thesis_3.routed_details.median_mid_term_g2 || analysisData.thesis_1.growth_years_6_10) * 100).toFixed(1)}% (Median Stepdown)</td>
                          </tr>
                          <tr>
                            <td><strong>Terminal Growth (Y11-20)</strong></td>
                            <td>{(analysisData.thesis_1.growth_years_11_20 * 100).toFixed(1)}% (GDP Rate)</td>
                            <td>{analysisData.thesis_2.terminal_growth_pct}% (Explicit Forecast)</td>
                            <td>4.0% (Long-Term Sustainable GDP)</td>
                          </tr>
                          <tr>
                            <td><strong>Discount Rate Logic</strong></td>
                            <td>Beta Table Mapping: <strong>{analysisData.thesis_1.discount_rate_pct}%</strong></td>
                            <td>Cost of Equity / WACC: <strong>{analysisData.thesis_2.discount_rate_pct}%</strong></td>
                            <td>WACC with Hurdle Floor: <strong>{analysisData.thesis_1.discount_rate_pct}%</strong></td>
                          </tr>
                          <tr>
                            <td><strong>Terminal Value Beyond Y20</strong></td>
                            <td>None (Pure 20-Year Discounted Sum)</td>
                            <td>Gordon Perpetuity: <strong>{fmtCurr(analysisData.thesis_2.pv_terminal_value)}</strong></td>
                            <td>None (Explicit 20-Year Deceleration)</td>
                          </tr>
                          <tr>
                            <td><strong>Cash & Debt Bridge</strong></td>
                            <td>+Cash ({fmtCurr(analysisData.thesis_1.cash_per_share)}/sh) -Debt ({fmtCurr(analysisData.thesis_1.debt_per_share)}/sh)</td>
                            <td>+Cash -Debt applied to EV</td>
                            <td>Net Asset Adjustment applied to Enterprise PV</td>
                          </tr>
                          <tr className="highlight-row">
                            <td><strong>Final Fair Value / Share</strong></td>
                            <td><strong className="text-primary">{fmtCurr(analysisData.thesis_1.intrinsic_value)}</strong></td>
                            <td><strong className="text-info">{fmtCurr(analysisData.thesis_2.intrinsic_value)}</strong></td>
                            <td><strong className="text-warning">{fmtCurr(analysisData.thesis_3.intrinsic_value)}</strong></td>
                          </tr>
                          <tr>
                            <td><strong>Margin of Safety vs ${analysisData.current_price}</strong></td>
                            <td className={analysisData.thesis_1.margin_of_safety_pct >= 0 ? 'text-success' : 'text-danger'}>
                              <strong>{fmtPct(analysisData.thesis_1.margin_of_safety_pct)}</strong>
                            </td>
                            <td className={analysisData.thesis_2.margin_of_safety_pct >= 0 ? 'text-success' : 'text-danger'}>
                              <strong>{fmtPct(analysisData.thesis_2.margin_of_safety_pct)}</strong>
                            </td>
                            <td className={analysisData.thesis_3.margin_of_safety_pct >= 0 ? 'text-success' : 'text-danger'}>
                              <strong>{fmtPct(analysisData.thesis_3.margin_of_safety_pct)}</strong>
                            </td>
                          </tr>
                          <tr>
                            <td><strong>Core Philosophy</strong></td>
                            <td>Margin of safety on high-quality wide-moat compounders.</td>
                            <td>Academic rigor combining explicit flows, perpetuity TV, and multiples.</td>
                            <td>Adaptive sector routing for financials & high capex tech.</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB 2: 20-YEAR CASH FLOW TIMELINE */}
                {activeTab === 'projections' && (
                  <div className="oracle-tab-panel">
                    <div className="panel-header">
                      <h3><i className="fa-solid fa-chart-area"></i> 20-Year Cash Flow Projection Timeline</h3>
                      <p>Step-by-step forecast of annual cash generation, discounting factors, and discounted present values for {analysisData.symbol}.</p>
                    </div>

                    <div className="projections-table-wrapper">
                      <table className="projections-table">
                        <thead>
                          <tr>
                            <th>Year</th>
                            <th>Epoch / Stage</th>
                            <th>Growth %</th>
                            <th>Thesis 1 Projected Metric</th>
                            <th>Thesis 1 PV</th>
                            <th>Thesis 2 Projected FCF</th>
                            <th>Thesis 2 PV</th>
                            <th>Discount Factor</th>
                            <th>Cumulative PV</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysisData.thesis_1.projections && analysisData.thesis_1.projections.map((p, idx) => {
                            const p2 = (analysisData.thesis_2.projections && analysisData.thesis_2.projections[idx]) || {};
                            const epoch = p.year <= 5 ? 'Years 1-5 (High Growth)' : (p.year <= 10 ? 'Years 6-10 (Transition)' : 'Years 11-20 (Terminal Maturity)');
                            return (
                              <tr key={p.year}>
                                <td><strong>Year {p.year}</strong></td>
                                <td><span className={`epoch-pill epoch-${p.year <= 5 ? '1' : (p.year <= 10 ? '2' : '3')}`}>{epoch}</span></td>
                                <td>{(p.growth_rate * 100).toFixed(1)}%</td>
                                <td>{fmtCurr(p.projected_metric)}</td>
                                <td className="highlight-col">{fmtCurr(p.present_value)}</td>
                                <td>{fmtCurr(p2.projected_fcf)}</td>
                                <td className="highlight-col">{fmtCurr(p2.present_value)}</td>
                                <td><code>{p.discount_factor.toFixed(4)}</code></td>
                                <td><strong>{fmtCurr(p.cumulative_pv)}</strong></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB 3: SENSITIVITY MATRIX */}
                {activeTab === 'sensitivity' && (
                  <div className="oracle-tab-panel">
                    <div className="panel-header">
                      <h3><i className="fa-solid fa-table-cells"></i> 2-Variable Sensitivity Analysis Matrix (Thesis 2)</h3>
                      <p>Visualizes how {analysisData.symbol}'s intrinsic value varies under different Discount Rates ($r$) and Terminal Growth Rates ($g_T$).</p>
                    </div>

                    <div className="sensitivity-layout">
                      <div className="sensitivity-matrix-card">
                        <table className="sensitivity-table">
                          <thead>
                            <tr>
                              <th>Discount Rate ($r$) \ Terminal Growth ($g_T$)</th>
                              <th>3.0% Terminal Growth</th>
                              <th>4.0% Terminal Growth (Base)</th>
                              <th>5.0% Terminal Growth</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysisData.thesis_2.sensitivity_matrix && analysisData.thesis_2.sensitivity_matrix.map((row, rIdx) => (
                              <tr key={rIdx}>
                                <td><strong>{row.discount_rate}% Discount Rate</strong></td>
                                {row.values.map((v, cIdx) => {
                                  const isBase = (rIdx === 1 && cIdx === 1);
                                  const isUndervalued = v.intrinsic_value >= analysisData.current_price;
                                  return (
                                    <td 
                                      key={cIdx} 
                                      className={`matrix-cell ${isBase ? 'base-cell' : ''} ${isUndervalued ? 'cell-green' : 'cell-red'}`}
                                    >
                                      <div className="matrix-iv">{fmtCurr(v.intrinsic_value)}</div>
                                      <div className="matrix-mos">
                                        MoS: {fmtPct(((v.intrinsic_value - analysisData.current_price) / v.intrinsic_value) * 100)}
                                      </div>
                                      {isBase && <span className="base-tag">Baseline</span>}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="sensitivity-notes-card">
                        <h4><i className="fa-solid fa-circle-info"></i> Sensitivity Insights</h4>
                        <ul>
                          <li><strong>Interest Rate Impact:</strong> A 1.5% decrease in the discount rate boosts fair value significantly due to 20-year cash compounding.</li>
                          <li><strong>Perpetuity Dependency:</strong> Terminal value accounts for <strong>{analysisData.thesis_2.tv_contribution_pct}%</strong> of enterprise value in Thesis 2.</li>
                          <li><strong>Current Stock Price:</strong> Trading at <strong>{fmtCurr(analysisData.current_price)}</strong>.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 4: QUALITY CHECKLIST & ORACLEIQ 6D */}
                {activeTab === 'quality' && (
                  <div className="oracle-tab-panel">
                    <div className="panel-header">
                      <h3><i className="fa-solid fa-award"></i> Quality Filters & Holistic Diagnostic Dimensions</h3>
                      <p>Compare Adam Khoo's 7-Step VMI Quality Filters (Thesis 1) with the AI-assisted OracleIQ™ 6-Dimension Assessment (Thesis 3).</p>
                    </div>

                    <div className="quality-dual-grid">
                      {/* Left: VMI 7-Step Quality Filter */}
                      <div className="quality-card vmi-quality-card">
                        <div className="quality-card-header">
                          <h4><i className="fa-solid fa-list-check"></i> Adam Khoo VMI 7-Step Quality Filter</h4>
                          <span className="quality-score-badge">{analysisData.thesis_1.quality_score} Passed</span>
                        </div>
                        <p className="quality-intro">"Valuation is meaningless on poor-quality businesses. Filter for high ROE, durable moats, and low debt first."</p>

                        <div className="checklist-items">
                          {analysisData.thesis_1.quality_checklist && analysisData.thesis_1.quality_checklist.map((item) => (
                            <div key={item.id} className={`checklist-item ${item.passed ? 'passed' : 'failed'}`}>
                              <div className="item-status-icon">
                                <i className={`fa-solid fa-${item.passed ? 'circle-check text-success' : 'circle-xmark text-danger'}`}></i>
                              </div>
                              <div className="item-content">
                                <div className="item-name">{item.name}</div>
                                <div className="item-desc">{item.desc}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Right: OracleIQ 6-Dimension Radar / Bars */}
                      <div className="quality-card oracleiq-card">
                        <div className="quality-card-header">
                          <h4><i className="fa-solid fa-gauge-high"></i> OracleIQ™ 6-Dimension Framework</h4>
                          <span className="oracleiq-score-badge">{analysisData.thesis_3.oracle_iq.total_score} / 100</span>
                        </div>
                        <p className="quality-intro">Comprehensive quantitative scoring across fundamental predictability, profitability, growth, balance sheet, and moat durability.</p>

                        <div className="oracleiq-bars-list">
                          <div className="oracleiq-dim-row">
                            <div className="dim-labels">
                              <span><i className="fa-solid fa-star text-warning"></i> Business Predictability</span>
                              <strong>{analysisData.thesis_3.oracle_iq.predictability} / 100</strong>
                            </div>
                            <div className="dim-progress-track">
                              <div className="dim-progress-fill fill-predictability" style={{ width: `${analysisData.thesis_3.oracle_iq.predictability}%` }}></div>
                            </div>
                          </div>

                          <div className="oracleiq-dim-row">
                            <div className="dim-labels">
                              <span><i className="fa-solid fa-chart-line text-success"></i> Profitability (ROE / ROIC / Margins)</span>
                              <strong>{analysisData.thesis_3.oracle_iq.profitability} / 100</strong>
                            </div>
                            <div className="dim-progress-track">
                              <div className="dim-progress-fill fill-profitability" style={{ width: `${analysisData.thesis_3.oracle_iq.profitability}%` }}></div>
                            </div>
                          </div>

                          <div className="oracleiq-dim-row">
                            <div className="dim-labels">
                              <span><i className="fa-solid fa-arrow-trend-up text-primary"></i> Growth Velocity</span>
                              <strong>{analysisData.thesis_3.oracle_iq.growth} / 100</strong>
                            </div>
                            <div className="dim-progress-track">
                              <div className="dim-progress-fill fill-growth" style={{ width: `${analysisData.thesis_3.oracle_iq.growth}%` }}></div>
                            </div>
                          </div>

                          <div className="oracleiq-dim-row">
                            <div className="dim-labels">
                              <span><i className="fa-solid fa-shield text-info"></i> Financial Strength (F-Score & Debt)</span>
                              <strong>{analysisData.thesis_3.oracle_iq.financial_strength} / 100</strong>
                            </div>
                            <div className="dim-progress-track">
                              <div className="dim-progress-fill fill-strength" style={{ width: `${analysisData.thesis_3.oracle_iq.financial_strength}%` }}></div>
                            </div>
                          </div>

                          <div className="oracleiq-dim-row">
                            <div className="dim-labels">
                              <span><i className="fa-solid fa-crown text-purple"></i> OracleMoat™ Advantage</span>
                              <strong>{analysisData.thesis_3.oracle_iq.oracle_moat} / 100</strong>
                            </div>
                            <div className="dim-progress-track">
                              <div className="dim-progress-fill fill-moat" style={{ width: `${analysisData.thesis_3.oracle_iq.oracle_moat}%` }}></div>
                            </div>
                          </div>

                          <div className="oracleiq-dim-row">
                            <div className="dim-labels">
                              <span><i className="fa-solid fa-tag text-teal"></i> Valuation Attractiveness</span>
                              <strong>{analysisData.thesis_3.oracle_iq.valuation} / 100</strong>
                            </div>
                            <div className="dim-progress-track">
                              <div className="dim-progress-fill fill-valuation" style={{ width: `${analysisData.thesis_3.oracle_iq.valuation}%` }}></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 5: WHAT-IF SCENARIO SANDBOX */}
                {activeTab === 'sandbox' && (
                  <div className="oracle-tab-panel">
                    <div className="panel-header">
                      <h3><i className="fa-solid fa-sliders"></i> Interactive What-If Scenario Sandbox</h3>
                      <p>Adjust near-term growth, transition growth, terminal rates, and discount hurdles in real-time to observe dynamic changes in all 3 models.</p>
                    </div>

                    <div className="sandbox-layout">
                      <div className="sandbox-sliders-card">
                        <div className="slider-group">
                          <div className="slider-header">
                            <label>Near-Term Growth Rate (Years 1–5):</label>
                            <span className="slider-val-badge">{sandboxG1 !== null ? `${sandboxG1}%` : '10.0%'}</span>
                          </div>
                          <input 
                            type="range" 
                            min="-10" 
                            max="35" 
                            step="0.5"
                            value={sandboxG1 !== null ? sandboxG1 : 10}
                            onChange={(e) => {
                              setSandboxG1(parseFloat(e.target.value));
                              setIsSandboxActive(true);
                            }}
                          />
                        </div>

                        <div className="slider-group">
                          <div className="slider-header">
                            <label>Transition Growth Rate (Years 6–10):</label>
                            <span className="slider-val-badge">{sandboxG2 !== null ? `${sandboxG2}%` : '7.5%'}</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="25" 
                            step="0.5"
                            value={sandboxG2 !== null ? sandboxG2 : 7.5}
                            onChange={(e) => {
                              setSandboxG2(parseFloat(e.target.value));
                              setIsSandboxActive(true);
                            }}
                          />
                        </div>

                        <div className="slider-group">
                          <div className="slider-header">
                            <label>Terminal Growth Rate (Years 11–20):</label>
                            <span className="slider-val-badge">{sandboxGT !== null ? `${sandboxGT}%` : '4.0%'}</span>
                          </div>
                          <input 
                            type="range" 
                            min="1.0" 
                            max="6.0" 
                            step="0.2"
                            value={sandboxGT !== null ? sandboxGT : 4.0}
                            onChange={(e) => {
                              setSandboxGT(parseFloat(e.target.value));
                              setIsSandboxActive(true);
                            }}
                          />
                        </div>

                        <div className="slider-group">
                          <div className="slider-header">
                            <label>Discount Rate ($r$):</label>
                            <span className="slider-val-badge">{sandboxR !== null ? `${sandboxR}%` : '6.0%'}</span>
                          </div>
                          <input 
                            type="range" 
                            min="4.5" 
                            max="15.0" 
                            step="0.2"
                            value={sandboxR !== null ? sandboxR : 6.0}
                            onChange={(e) => {
                              setSandboxR(parseFloat(e.target.value));
                              setIsSandboxActive(true);
                            }}
                          />
                        </div>

                        <div className="sandbox-actions">
                          <button className="btn btn-secondary" onClick={handleResetSandbox}>
                            <i className="fa-solid fa-rotate-left"></i> Reset to Baseline
                          </button>
                        </div>
                      </div>

                      <div className="sandbox-results-card">
                        <h4>Live Recalculated Output ({isSandboxActive ? 'Custom Scenario' : 'Baseline'})</h4>
                        <div className="sandbox-output-grid">
                          <div className="sb-card sb-1">
                            <span className="sb-label">Thesis 1 (Adam Khoo VMI)</span>
                            <div className="sb-val">{fmtCurr(analysisData.thesis_1.intrinsic_value)}</div>
                            <div className="sb-mos">MoS: {fmtPct(analysisData.thesis_1.margin_of_safety_pct)}</div>
                          </div>
                          <div className="sb-card sb-2">
                            <span className="sb-label">Thesis 2 (Academic DFCF-20 + TV)</span>
                            <div className="sb-val">{fmtCurr(analysisData.thesis_2.intrinsic_value)}</div>
                            <div className="sb-mos">MoS: {fmtPct(analysisData.thesis_2.margin_of_safety_pct)}</div>
                          </div>
                          <div className="sb-card sb-3">
                            <span className="sb-label">Thesis 3 (Dynamic Routing)</span>
                            <div className="sb-val">{fmtCurr(analysisData.thesis_3.intrinsic_value)}</div>
                            <div className="sb-mos">MoS: {fmtPct(analysisData.thesis_3.margin_of_safety_pct)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* VIEW MODE 2: WATCHLIST 3-MODEL COMPARISON LEADERBOARD */}
      {viewMode === 'leaderboard' && (
        <div className="oracle-leaderboard-layout">
          <div className="leaderboard-header-bar">
            <div className="lb-title-group">
              <h3><i className="fa-solid fa-ranking-star"></i> All-Watchlist 3-Thesis Valuation Comparison</h3>
              <p>Compare calculated fair values across Thesis 1, Thesis 2, and Thesis 3 for every tracked stock to find the deepest discounts.</p>
            </div>

            <div className="lb-controls">
              <div className="oracle-table-search">
                <i className="fa-solid fa-magnifying-glass"></i>
                <input 
                  type="text" 
                  placeholder="Filter table by symbol, name, or sector..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="leaderboard-table-wrapper">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th onClick={() => handleSortLeaderboard('symbol')}>
                    Ticker {leaderboardSortKey === 'symbol' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSortLeaderboard('name')}>
                    Company Name {leaderboardSortKey === 'name' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSortLeaderboard('sector')}>
                    Sector {leaderboardSortKey === 'sector' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSortLeaderboard('current_price')}>
                    Price {leaderboardSortKey === 'current_price' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSortLeaderboard('thesis_1_val')}>
                    Thesis 1 (Khoo VMI) {leaderboardSortKey === 'thesis_1_val' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSortLeaderboard('thesis_1_mos')}>
                    T1 MoS % {leaderboardSortKey === 'thesis_1_mos' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSortLeaderboard('thesis_2_val')}>
                    Thesis 2 (Academic) {leaderboardSortKey === 'thesis_2_val' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSortLeaderboard('thesis_2_mos')}>
                    T2 MoS % {leaderboardSortKey === 'thesis_2_mos' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSortLeaderboard('thesis_3_val')}>
                    Thesis 3 (Dynamic) {leaderboardSortKey === 'thesis_3_val' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSortLeaderboard('gf_value')}>
                    GF / Stock Oracle {leaderboardSortKey === 'gf_value' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => handleSortLeaderboard('oracle_iq_score')}>
                    OracleIQ {leaderboardSortKey === 'oracle_iq_score' && (leaderboardSortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeaderboard.length === 0 ? (
                  <tr>
                    <td colSpan="12" style={{ textAlign: 'center', padding: '2rem' }}>
                      No matching stocks found.
                    </td>
                  </tr>
                ) : (
                  filteredLeaderboard.map((row) => (
                    <tr key={row.symbol} className="leaderboard-row" onClick={() => handleSelectStock(row.symbol)}>
                      <td>
                        <strong className="ticker-pill">{row.symbol}</strong>
                      </td>
                      <td className="company-cell">{row.name}</td>
                      <td><span className="sector-tag">{row.sector}</span></td>
                      <td><strong>{fmtCurr(row.current_price)}</strong></td>
                      <td>
                        <span className="t1-cell">{fmtCurr(row.thesis_1_val)}</span>
                      </td>
                      <td>
                        <span className={`mos-tag mos-${row.thesis_1_mos >= 0 ? 'pos' : 'neg'}`}>
                          {fmtPct(row.thesis_1_mos)}
                        </span>
                      </td>
                      <td>
                        <span className="t2-cell">{fmtCurr(row.thesis_2_val)}</span>
                      </td>
                      <td>
                        <span className={`mos-tag mos-${row.thesis_2_mos >= 0 ? 'pos' : 'neg'}`}>
                          {fmtPct(row.thesis_2_mos)}
                        </span>
                      </td>
                      <td>
                        <span className="t3-cell">{fmtCurr(row.thesis_3_val)}</span>
                        <small className="t3-route">({row.thesis_3_type})</small>
                      </td>
                      <td>
                        <span className="gf-cell">{row.gf_value ? fmtCurr(row.gf_value) : '-'}</span>
                      </td>
                      <td>
                        <span className="iq-cell">{row.oracle_iq_score ? `${row.oracle_iq_score}` : '-'}</span>
                      </td>
                      <td>
                        <button className="btn btn-xs btn-primary" onClick={(e) => {
                          e.stopPropagation();
                          handleSelectStock(row.symbol);
                        }}>
                          Deep Dive <i className="fa-solid fa-arrow-right"></i>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
