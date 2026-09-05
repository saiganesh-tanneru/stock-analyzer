import React, { useState, useEffect, useRef, useMemo } from 'react';
import StockOracleView from './StockOracleView.jsx';

// Helper to parse strings to numbers for sorting
const parseNumber = (val) => {
  if (val === undefined || val === null || val === '-' || val === '') return null;
  let str = String(val).replace(/[\$,]/g, '').trim();
  let multiplier = 1;
  if (str.endsWith('T')) {
    multiplier = 1e12;
    str = str.slice(0, -1);
  } else if (str.endsWith('B')) {
    multiplier = 1e9;
    str = str.slice(0, -1);
  } else if (str.endsWith('M')) {
    multiplier = 1e6;
    str = str.slice(0, -1);
  } else if (str.endsWith('%')) {
    multiplier = 0.01;
    str = str.slice(0, -1);
  }
  const parsed = parseFloat(str);
  return isNaN(parsed) ? null : parsed * multiplier;
};

// Valuation ranks for custom sorting
const valuationRanks = {
  'Possible Value Trap, Think Twice': 1,
  'Significantly Undervalued': 2,
  'Modestly Undervalued': 3,
  'Fairly Valued': 4,
  'Modestly Overvalued': 5,
  'Significantly Overvalued': 6,
  '-': 7,
  '': 7
};

export default function App() {
  const [stocks, setStocks] = useState([]);
  const [tickers, setTickers] = useState([]);
  const [scrapeStatus, setScrapeStatus] = useState({ running: false, progress: 0, total: 0, message: 'Idle' });
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  // Application Top-Level Routing state ('screener' | 'oracle')
  const [currentRoute, setCurrentRoute] = useState('screener');
  const [oracleSelectedTicker, setOracleSelectedTicker] = useState('MSFT');

  // URL Hash routing listener
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash || '';
      if (hash.startsWith('#/oracle')) {
        setCurrentRoute('oracle');
        const parts = hash.split('/');
        if (parts.length > 2 && parts[2]) {
          setOracleSelectedTicker(parts[2].toUpperCase());
        }
      } else {
        setCurrentRoute('screener');
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateToRoute = (route, ticker = null) => {
    setCurrentRoute(route);
    if (route === 'oracle') {
      const sym = ticker || oracleSelectedTicker || 'MSFT';
      setOracleSelectedTicker(sym);
      window.location.hash = `#/oracle/${sym}`;
    } else {
      window.location.hash = '#/';
    }
  };

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSector, setSelectedSector] = useState('');
  const [selectedValuation, setSelectedValuation] = useState('');
  const [selectedScoreFilter, setSelectedScoreFilter] = useState('');
  const [selectedTVFilter, setSelectedTVFilter] = useState('');
  const [selectedConvictionFilter, setSelectedConvictionFilter] = useState('');
  const [isTVRefreshing, setIsTVRefreshing] = useState(false);

  // Sorting state
  const [sortKey, setSortKey] = useState('Ticker');
  const [sortDirection, setSortDirection] = useState('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(-1);

  // Column Visibility Toggles
  const [visibleColumns, setVisibleColumns] = useState([
    'Score', 'Name', 'Sector', 'Price', 'GF Value', 'GF Valuation', 'TV Technical', 'Analyst Target', 'F-Score', 'Z-Score'
  ]);
  const [isColumnDropdownOpen, setIsColumnDropdownOpen] = useState(false);
  const columnDropdownRef = useRef(null);

  // Modal states
  const [selectedStock, setSelectedStock] = useState(null);
  const [detailsViewMode, setDetailsViewMode] = useState('metrics'); // 'metrics' | 'chart'
  const [activeStockTab, setActiveStockTab] = useState('overview');
  const [overviewData, setOverviewData] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [newsData, setNewsData] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTickerSymbol, setNewTickerSymbol] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [deleteConfirmStock, setDeleteConfirmStock] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Multi-stock compare state
  const [selectedCompare, setSelectedCompare] = useState([]);
  const [isCompareOpen, setIsCompareOpen] = useState(false);

  // Phase 4: Portfolio Allocator state
  const [isAllocatorOpen, setIsAllocatorOpen] = useState(false);
  const [allocatorCapital, setAllocatorCapital] = useState(50000);
  const [allocatorMinScore, setAllocatorMinScore] = useState(65);
  const [allocatorStrategy, setAllocatorStrategy] = useState('conviction'); // 'conviction' | 'equal' | 'undervalued'

  // Toast notifications
  const [toasts, setToasts] = useState([]);
  const addToast = (msg, type = 'warning') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };
  const dismissToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  const allColumns = [
    { id: 'Score', label: 'Composite Score (0-100)' },
    { id: 'Name', label: 'Company Name' },
    { id: 'Sector', label: 'Sector' },
    { id: 'Market Cap', label: 'Market Cap' },
    { id: 'Price', label: 'Price' },
    { id: 'GF Value', label: 'GF Value' },
    { id: 'GF Valuation', label: 'GF Valuation' },
    { id: 'TV Technical', label: 'TV Technical' },
    { id: 'Analyst Target', label: 'Analyst Target' },
    { id: 'Change %', label: 'Change %' },
    { id: 'P/E', label: 'P/E' },
    { id: 'F-Score', label: 'F-Score' },
    { id: 'Z-Score', label: 'Z-Score' }
  ];

  // Fetch initial data
  const fetchData = async () => {
    try {
      // 1. Try real API endpoints first
      const [stocksRes, tickersRes, statusRes] = await Promise.all([
        fetch('/api/stocks'),
        fetch('/api/tickers'),
        fetch('/api/scrape/status')
      ]);

      const ctS = stocksRes.headers.get('content-type');
      if (ctS && ctS.includes('text/html')) {
        throw new Error("API returned HTML instead of JSON (likely dev server fallback)");
      }

      const stocksData = await stocksRes.json();
      const tickersData = await tickersRes.json();
      const statusData = await statusRes.json();

      setStocks(stocksData);
      setTickers(tickersData);
      setScrapeStatus(statusData);
      setIsDemo(false);
    } catch (err) {
      console.warn("API endpoints failed, falling back to static files (Demo Mode):", err);
      try {
        // Fallback to static JSON files in public/api/
        const [stocksRes, tickersRes, statusRes] = await Promise.all([
          fetch('api/stocks.json'),
          fetch('api/tickers.json'),
          fetch('api/status.json')
        ]);

        const stocksData = await stocksRes.json();
        const tickersData = await tickersRes.json();
        const statusData = await statusRes.json();

        setStocks(stocksData);
        setTickers(tickersData);
        setScrapeStatus(statusData);
        setIsDemo(true);
      } catch (fallbackErr) {
        console.error("Fallback static files also failed:", fallbackErr);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchOverview = async (symbol) => {
    setOverviewLoading(true);
    setOverviewData(null);
    try {
      if (isDemo || window.location.hostname.includes('github.io')) {
        // Try to fetch static overview file if it exists, otherwise fall back
        const res = await fetch(`api/overview/${symbol}.json`);
        if (!res.ok) throw new Error("Static file not found");
        const data = await res.json();
        setOverviewData(data);
      } else {
        const res = await fetch(`/api/overview/${symbol}`);
        const data = await res.json();
        if (!data.error) {
          setOverviewData(data);
        }
      }
    } catch (e) {
      // Construct fallback description from stock item
      const stock = stocks.find(s => s.Ticker === symbol);
      if (stock) {
        setOverviewData({
          symbol: symbol,
          description: "Detailed description is not available in the read-only static demo. To view live descriptions and profiles, run the application locally with the Python backend server.",
          moat: stock.Moat || '',
          moat_score: null,
          moat_label: stock.Moat ? `${stock.Moat} Moat` : 'Not available',
          gf_score: stock['GF Score'] || null,
          gf_value: stock['GF Value'] || null,
          wacc: stock['WACC'] || null,
          meta: {
            employees: stock['Employees'] || 'N/A',
            ipo_date: stock['IPO'] || 'N/A',
            indices: stock['Index'] ? [stock['Index']] : []
          }
        });
      }
    } finally {
      setOverviewLoading(false);
    }
  };

  const fetchNews = async (symbol) => {
    setNewsLoading(true);
    setNewsData([]);
    try {
      if (isDemo || window.location.hostname.includes('github.io')) {
        const res = await fetch(`api/news/${symbol}.json`);
        if (!res.ok) throw new Error("Static file not found");
        const data = await res.json();
        setNewsData(data.news || []);
      } else {
        const res = await fetch(`/api/news/${symbol}?limit=10`);
        const data = await res.json();
        if (data.news) {
          setNewsData(data.news);
        }
      }
    } catch (e) {
      setNewsData([
        {
          title: "Live breaking news headlines are only available in the live application mode.",
          source: "System",
          time: "Now",
          url: "#"
        }
      ]);
    } finally {
      setNewsLoading(false);
    }
  };

  const handleSelectStock = (stock) => {
    setSelectedStock(stock);
    setActiveStockTab('overview');
    fetchOverview(stock.Ticker);
    fetchNews(stock.Ticker);
  };

  // Poll status if scrape is running
  useEffect(() => {
    let interval = null;
    if (scrapeStatus.running && !isDemo) {
      interval = setInterval(async () => {
        try {
          const res = await fetch('/api/scrape/status');
          const data = await res.json();
          setScrapeStatus(data);
          if (!data.running) {
            const stocksRes = await fetch('/api/stocks');
            const stocksData = await stocksRes.json();
            setStocks(stocksData);
          }
        } catch (err) {
          console.error("Error polling status:", err);
        }
      }, 1000);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [scrapeStatus.running, isDemo]);

  // Click outside listener to close column toggle dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (columnDropdownRef.current && !columnDropdownRef.current.contains(event.target)) {
        setIsColumnDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset page to 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedSector, selectedValuation, selectedScoreFilter, selectedTVFilter, selectedConvictionFilter, pageSize]);

  const triggerFullScrape = async () => {
    if (isDemo) {
      addToast("Full scraping is disabled in Read-only Demo Mode.", "warning");
      return;
    }
    try {
      const res = await fetch('/api/scrape', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setScrapeStatus({ running: true, progress: 0, total: tickers.length, message: 'Scrape started...' });
      }
    } catch (err) {
      console.error("Error triggering scrape:", err);
      alert("Failed to start scrape");
    }
  };

  const handleRefreshTradingView = async () => {
    if (isDemo) {
      addToast("TradingView refresh is disabled in Read-only Demo Mode.", "warning");
      return;
    }
    setIsTVRefreshing(true);
    try {
      const res = await fetch('/api/tradingview/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        addToast(data.error, 'warning');
      } else {
        addToast(data.message || 'TradingView technicals refreshed!', 'success');
        const stocksRes = await fetch('/api/stocks');
        const stocksData = await stocksRes.json();
        setStocks(stocksData);
      }
    } catch (err) {
      addToast('Failed to refresh TradingView data', 'warning');
    } finally {
      setIsTVRefreshing(false);
    }
  };

  const handleAddTicker = async (e) => {
    e.preventDefault();
    const raw = newTickerSymbol.trim();
    if (!raw) return;

    // Detect bulk vs single
    const isBulk = raw.includes(',') || raw.includes(';');
    const symbols = raw.split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (symbols.length === 0) return;

    // In Demo Mode (or on GitHub Pages static deployment)
    if (isDemo || window.location.hostname.includes('github.io')) {
      const uniqueSymbols = symbols.filter(sym => !tickers.some(t => (t.symbol || '').toUpperCase() === sym));
      if (uniqueSymbols.length === 0) {
        addToast("Entered ticker(s) already in your watchlist.", "warning");
        setIsAddOpen(false);
        setNewTickerSymbol('');
        return;
      }

      const newStubs = uniqueSymbols.map(sym => ({
        Ticker: sym,
        Name: sym,
        Sector: '-',
        Price: '-',
        'Change %': '-',
        'Market Cap': '-',
        'P/E': '-',
        'P/B': '-',
        'P/S': '-',
        'Current Ratio': '-',
        'Debt/Eq': '-',
        ROA: '-',
        ROE: '-',
        'Gross Margin': '-',
        'Oper. Margin': '-',
        'Profit Margin': '-',
        'Piotroski F-Score': '-',
        'Altman Z-Score': '-',
        'Beneish M-Score': '-',
        'WACC': '-',
        'ROIC': '-',
        'GF Value': '-',
        'GF Valuation': '-',
        'TV Technical': '',
        'TV Score': '',
        'TV RSI': '',
        'Analyst Target': '',
        'Target Upside %': '',
        'Composite Score': '-',
        _pending: true,
        _pendingGF: true
      }));

      const newTickers = uniqueSymbols.map(sym => ({ symbol: sym, name: sym }));

      setTickers(prev => [...prev, ...newTickers]);
      setStocks(prev => [...newStubs, ...prev]);
      addToast(`Added ${uniqueSymbols.join(', ')} (Pending Scrape). Run GitHub Actions 'Stock Scraper' or ./start.sh to populate metrics.`, 'info');
      setIsAddOpen(false);
      setNewTickerSymbol('');
      return;
    }

    setIsAdding(true);
    setAddError('');

    try {
      if (isBulk) {
        // ── Bulk add path ──────────────────────────────────────────────
        const res = await fetch('/api/tickers/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: symbols })
        });
        const data = await res.json();
        if (!res.ok) {
          setAddError(data.error || 'Bulk add failed');
          return;
        }

        // Refresh ticker/stock lists
        const [tickersRes, stocksRes] = await Promise.all([fetch('/api/tickers'), fetch('/api/stocks')]);
        setTickers(await tickersRes.json());
        const serverStocks = await stocksRes.json();
        setStocks(serverStocks);
        setIsAddOpen(false);
        setNewTickerSymbol('');

        // Build a detailed summary toast
        const parts = [];
        if (data.added?.length) parts.push(`✅ Added: ${data.added.join(', ')}`);
        if (data.skipped?.length) parts.push(`⚠️ Already tracked: ${data.skipped.join(', ')}`);
        if (data.errors?.length) parts.push(`❌ Failed: ${data.errors.map(e => e.symbol).join(', ')}`);
        const toastType = data.added?.length > 0 ? 'success' : 'warning';
        addToast(parts.join('  |  ') || data.message, toastType);

        if (data.added?.length) {
          setTimeout(() => addToast(
            `Scraping Finviz & GuruFocus metrics for ${data.added.length} stock${data.added.length > 1 ? 's' : ''} in the background…`,
            'info'
          ), 600);
        }

      } else {
        // ── Single add path ────────────────────────────────────────────
        const symbol = symbols[0];
        if (!symbol) { setAddError('Please enter a ticker symbol.'); return; }

        const res = await fetch('/api/tickers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol })
        });
        const data = await res.json();
        if (res.status === 409 && data.warning) {
          addToast(data.warning, 'warning');
          setIsAddOpen(false);
          setNewTickerSymbol('');
        } else if (res.ok) {
          setStocks(data);
          const tickersRes = await fetch('/api/tickers');
          setTickers(await tickersRes.json());
          setIsAddOpen(false);
          setNewTickerSymbol('');
          addToast(`${symbol} added & scraping in the background!`, 'success');
        } else {
          setAddError(data.error || 'Failed to add ticker');
        }
      }
    } catch (err) {
      setAddError('Server connection error. Please try again.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteTicker = async () => {
    if (!deleteConfirmStock) return;
    const symbol = (deleteConfirmStock.Ticker || deleteConfirmStock.symbol || '').trim().toUpperCase();
    if (!symbol) return;

    if (isDemo || window.location.hostname.includes('github.io')) {
      setStocks(prev => prev.filter(s => (s.Ticker || s.symbol || '').trim().toUpperCase() !== symbol));
      setTickers(prev => prev.filter(t => (t.symbol || '').trim().toUpperCase() !== symbol));
      setSelectedCompare(prev => prev.filter(t => t !== symbol));
      if (selectedStock && (selectedStock.Ticker === symbol || selectedStock.symbol === symbol)) {
        setSelectedStock(null);
      }
      setDeleteConfirmStock(null);
      addToast(`Removed ${symbol} from current view (Demo Mode).`, 'info');
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/tickers/${symbol}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setStocks(data);
        const tickersRes = await fetch('/api/tickers');
        const tickersData = await tickersRes.json();
        setTickers(tickersData);
        setSelectedCompare(prev => prev.filter(t => t !== symbol));
        if (selectedStock && (selectedStock.Ticker === symbol || selectedStock.symbol === symbol)) {
          setSelectedStock(null);
        }
        setDeleteConfirmStock(null);
        addToast(`Successfully removed ${symbol}.`, 'success');
      } else {
        addToast(data.error || 'Failed to delete ticker', 'warning');
      }
    } catch (err) {
      console.error("Error deleting ticker:", err);
      addToast("Failed to delete ticker due to connection error", 'warning');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const toggleColumnVisibility = (columnId) => {
    if (visibleColumns.includes(columnId)) {
      if (visibleColumns.length > 1) {
        setVisibleColumns(visibleColumns.filter(c => c !== columnId));
      }
    } else {
      setVisibleColumns([...visibleColumns, columnId]);
    }
  };

  // Get unique sectors for dropdown filter
  const sectors = [...new Set(stocks.map(s => s.Sector).filter(Boolean))].sort();

  // Filter Stocks
  const filteredStocks = stocks.filter(item => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      item.Ticker?.toLowerCase().includes(query) ||
      item.Name?.toLowerCase().includes(query) ||
      item.Sector?.toLowerCase().includes(query) ||
      item.Country?.toLowerCase().includes(query) ||
      item.Index?.toLowerCase().includes(query);

    const matchesSector = !selectedSector || item.Sector === selectedSector;

    let matchesValuation = true;
    if (selectedValuation) {
      if (selectedValuation === 'Value Trap') {
        matchesValuation = item['GF Valuation']?.includes('Possible Value Trap');
      } else {
        matchesValuation = item['GF Valuation'] === selectedValuation;
      }
    }

    let matchesScore = true;
    if (selectedScoreFilter) {
      if (selectedScoreFilter === 'high-f') {
        const f = parseInt(item['Piotroski F-Score'] || '0');
        matchesScore = f >= 7;
      } else if (selectedScoreFilter === 'safe-z') {
        const z = parseFloat(item['Altman Z-Score'] || '0');
        matchesScore = z >= 2.99;
      }
    }

    let matchesTV = true;
    if (selectedTVFilter) {
      const tv = item['TV Technical'] || '';
      if (selectedTVFilter === 'bullish') {
        matchesTV = tv === 'Buy' || tv === 'Strong Buy';
      } else if (selectedTVFilter === 'strong-buy') {
        matchesTV = tv === 'Strong Buy';
      } else if (selectedTVFilter === 'neutral') {
        matchesTV = tv === 'Neutral';
      } else if (selectedTVFilter === 'bearish') {
        matchesTV = tv === 'Sell' || tv === 'Strong Sell';
      }
    }

    let matchesConviction = true;
    if (selectedConvictionFilter) {
      const score = parseFloat(item['Composite Score'] || '0');
      if (selectedConvictionFilter === 'high') {
        matchesConviction = score >= 80;
      } else if (selectedConvictionFilter === 'buy') {
        matchesConviction = score >= 65;
      } else if (selectedConvictionFilter === 'hold') {
        matchesConviction = score >= 50 && score < 65;
      } else if (selectedConvictionFilter === 'risk') {
        matchesConviction = score < 50;
      } else if (selectedConvictionFilter === 'dip') {
        const isNeg = String(item['Change %'] || '').startsWith('-');
        matchesConviction = score >= 65 && isNeg;
      }
    }

    return matchesSearch && matchesSector && matchesValuation && matchesScore && matchesTV && matchesConviction;
  });

  const tvTechnicalRanks = {
    'Strong Buy': 1,
    'Buy': 2,
    'Neutral': 3,
    'Sell': 4,
    'Strong Sell': 5
  };

  // Sort Stocks
  const sortedStocks = [...filteredStocks].sort((a, b) => {
    let valA = a[sortKey];
    let valB = b[sortKey];

    if (sortKey === 'GF Valuation') {
      const rankA = valuationRanks[valA] || 7;
      const rankB = valuationRanks[valB] || 7;
      return sortDirection === 'asc' ? rankA - rankB : rankB - rankA;
    }

    if (sortKey === 'TV Technical') {
      const rankA = tvTechnicalRanks[valA] || 6;
      const rankB = tvTechnicalRanks[valB] || 6;
      return sortDirection === 'asc' ? rankA - rankB : rankB - rankA;
    }

    if (
      sortKey.includes('Score') ||
      sortKey === 'Composite Score' ||
      sortKey === 'Price' ||
      sortKey === 'GF Value' ||
      sortKey === 'Analyst Target' ||
      sortKey === 'Target Upside %' ||
      sortKey === 'TV RSI' ||
      sortKey === 'P/E' ||
      sortKey === 'Change %' ||
      sortKey === 'Market Cap'
    ) {
      const numA = parseNumber(valA);
      const numB = parseNumber(valB);

      if (numA === null && numB === null) return 0;
      if (numA === null) return 1;
      if (numB === null) return -1;
      return sortDirection === 'asc' ? numA - numB : numB - numA;
    }

    valA = String(valA || '').toLowerCase();
    valB = String(valB || '').toLowerCase();
    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Paginated Stocks Slice
  const totalPages = pageSize === -1 ? 1 : Math.ceil(sortedStocks.length / pageSize);
  const paginatedStocks = pageSize === -1
    ? sortedStocks
    : sortedStocks.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Stats
  const totalTrackedCount = stocks.length;
  const isFiltered = Boolean(
    searchQuery.trim() ||
    selectedSector ||
    selectedValuation ||
    selectedScoreFilter ||
    selectedTVFilter ||
    selectedConvictionFilter
  );
  const activeDataset = isFiltered ? filteredStocks : stocks;
  const matchingCount = sortedStocks.length;

  const activeSectors = [...new Set(activeDataset.map(s => s.Sector).filter(Boolean))].sort();
  const sectorCount = activeSectors.length;
  const trapCount = activeDataset.filter(s => s['GF Valuation'] && s['GF Valuation'].includes('Value Trap')).length;
  const undervaluedCount = activeDataset.filter(s => s['GF Valuation'] && s['GF Valuation'].includes('Undervalued')).length;

  // Watchlist Pulse analytics (Top Gainers & High-Conviction Dips)
  const topGainers = useMemo(() => {
    return [...stocks]
      .filter(s => s.Price && s['Change %'] && !String(s['Change %']).startsWith('-') && s['Change %'] !== '0.00%')
      .sort((a, b) => (parseNumber(b['Change %']) || 0) - (parseNumber(a['Change %']) || 0))
      .slice(0, 3);
  }, [stocks]);

  const topDips = useMemo(() => {
    return [...stocks]
      .filter(s => s.Price && s['Change %'] && String(s['Change %']).startsWith('-') && (parseFloat(s['Composite Score'] || '0') >= 65))
      .sort((a, b) => (parseNumber(a['Change %']) || 0) - (parseNumber(b['Change %']) || 0))
      .slice(0, 3);
  }, [stocks]);

  const handleToggleCompare = (e, ticker) => {
    e.stopPropagation();
    setSelectedCompare(prev =>
      prev.includes(ticker) ? prev.filter(t => t !== ticker) : [...prev, ticker]
    );
  };

  const handleSelectAllCompare = (e) => {
    if (e.target.checked) {
      setSelectedCompare(paginatedStocks.map(s => s.Ticker));
    } else {
      setSelectedCompare([]);
    }
  };

  const getFScoreClass = (score) => {
    if (!score || score === '-') return '';
    const f = parseInt(score);
    return f >= 8 ? 'high' : (f <= 2 ? 'low' : 'mid');
  };

  const getZScoreClass = (score) => {
    if (!score || score === '-') return '';
    const z = parseFloat(score);
    return z >= 2.99 ? 'high' : (z < 1.81 ? 'low' : 'mid');
  };

  const getGFValuationClass = (val) => {
    if (!val || val === '-') return '';
    if (val.includes('Possible Value Trap')) return 'low';
    if (val.includes('Undervalued')) return 'high';
    if (val.includes('Fairly')) return 'info';
    if (val.includes('Modestly Overvalued')) return 'mid';
    if (val.includes('Significantly Overvalued')) return 'low';
    return '';
  };

  const getGFValuationColorClass = (val) => {
    if (!val || val === '-') return '';
    if (val.includes('Possible Value Trap')) return 'value-neg';
    if (val.includes('Undervalued')) return 'value-pos';
    if (val.includes('Fairly')) return 'value-info';
    if (val.includes('Modestly Overvalued')) return 'value-warning';
    if (val.includes('Significantly Overvalued')) return 'value-neg';
    return '';
  };

  const getTVTechnicalClass = (val) => {
    if (!val || val === '-') return '';
    if (val === 'Strong Buy') return 'tv-strong-buy';
    if (val === 'Buy') return 'tv-buy';
    if (val === 'Neutral') return 'tv-neutral';
    if (val === 'Sell') return 'tv-sell';
    if (val === 'Strong Sell') return 'tv-strong-sell';
    return '';
  };

  const getScoreClass = (score) => {
    const s = parseFloat(score);
    if (isNaN(s)) return '';
    if (s >= 80) return 'score-pill-high';
    if (s >= 65) return 'score-pill-good';
    if (s >= 50) return 'score-pill-neutral';
    return 'score-pill-low';
  };

  const getConvictionTier = (score) => {
    const s = parseFloat(score);
    if (isNaN(s)) return 'Unrated';
    if (s >= 80) return 'High-Conviction Compounder';
    if (s >= 65) return 'Buy Candidate';
    if (s >= 50) return 'Neutral / Hold';
    return 'Caution / High Risk';
  };

  const getPillarBreakdown = (stock) => {
    if (!stock) return { valuation: 0, quality: 0, moat: 0, momentum: 0, total: 0 };

    // 1. Valuation (0-25)
    let val_pts = 10;
    const val_status = String(stock['GF Valuation'] || '');
    if (val_status.includes('Significantly Undervalued')) val_pts = 25;
    else if (val_status.includes('Modestly Undervalued')) val_pts = 20;
    else if (val_status.includes('Fairly')) val_pts = 12;
    else if (val_status.includes('Modestly Overvalued')) val_pts = 6;
    else if (val_status.includes('Significantly Overvalued')) val_pts = 2;
    else if (val_status.includes('Value Trap')) val_pts = 0;

    const upsideNum = parseNumber(stock['Target Upside %']);
    if (upsideNum !== null && upsideNum >= 20.0) {
      val_pts = Math.min(25, val_pts + 3);
    }

    // 2. Quality & Safety (0-35)
    let f_pts = 8;
    const f = parseInt(String(stock['Piotroski F-Score'] || '0').split('/')[0]);
    if (!isNaN(f)) {
      if (f >= 8) f_pts = 20;
      else if (f === 7) f_pts = 16;
      else if (f === 6) f_pts = 12;
      else if (f === 5) f_pts = 8;
      else f_pts = 3;
    }

    let z_pts = 8;
    const z = parseFloat(stock['Altman Z-Score'] || '0');
    if (!isNaN(z)) {
      if (z >= 3.0) z_pts = 15;
      else if (z >= 1.81) z_pts = 8;
      else z_pts = 0;
    }
    const quality_pts = f_pts + z_pts;

    // 3. Moat (0-15)
    let moat_pts = 4;
    const moat = String(stock['Moat'] || '');
    if (moat.includes('Wide')) moat_pts = 15;
    else if (moat.includes('Narrow')) moat_pts = 8;

    // 4. Momentum (0-25)
    let tv_pts = 10;
    const tv = String(stock['TV Technical'] || '');
    if (tv === 'Strong Buy') tv_pts = 25;
    else if (tv === 'Buy') tv_pts = 18;
    else if (tv === 'Neutral') tv_pts = 10;
    else if (tv === 'Sell') tv_pts = 4;
    else if (tv === 'Strong Sell') tv_pts = 0;

    const total = val_pts + quality_pts + moat_pts + tv_pts;
    return {
      valuation: val_pts,
      quality: quality_pts,
      moat: moat_pts,
      momentum: tv_pts,
      total: stock['Composite Score'] ? parseInt(stock['Composite Score']) : total
    };
  };

  // Returns 'pending' | 'partial' | 'complete'
  const getDataStatus = (item) => {
    const hasPrice = item.Price && item.Price !== '' && item.Price !== '-';
    if (!hasPrice) return 'pending';  // never scraped

    const missingGF = [
      !item['GF Value'] || item['GF Value'] === '-',
      !item['Piotroski F-Score'] || item['Piotroski F-Score'] === '-',
      !item['Altman Z-Score'] || item['Altman Z-Score'] === '-',
      !item['GF Valuation'] || item['GF Valuation'] === '-',
    ].filter(Boolean).length;

    return missingGF >= 2 ? 'partial' : 'complete';
  };

  const getMissingFieldsList = (item) => {
    if (!item) return [];
    const missing = [];
    const isEmpty = (v) => v === undefined || v === null || v === '' || v === '-' || v === 'N/A' || v === 'null';
    if (isEmpty(item.Price)) missing.push('Price (Finviz)');
    if (isEmpty(item['GF Value'])) missing.push('GF Value');
    if (isEmpty(item['GF Valuation'])) missing.push('GF Valuation');
    if (isEmpty(item['Piotroski F-Score'])) missing.push('Piotroski F-Score');
    if (isEmpty(item['Altman Z-Score'])) missing.push('Altman Z-Score');
    if (isEmpty(item['P/E'])) missing.push('P/E Ratio');
    if (isEmpty(item['TV Technical'])) missing.push('TradingView Technical');
    return missing;
  };

  const getDetailGroups = (stock) => {
    if (!stock) return [];
    return [
      {
        title: 'Valuation Metrics',
        icon: 'fa-solid fa-chart-line',
        items: [
          { key: 'Price', value: stock['Price'] ? `$${stock['Price']}` : '-' },
          { key: 'GF Value', value: stock['GF Value'] ? `$${stock['GF Value']}` : '-' },
          { key: 'GF Valuation', value: stock['GF Valuation'] || '-', badge: getGFValuationClass(stock['GF Valuation']) },
          { key: 'P/E', value: stock['P/E'] || '-' },
          { key: 'Forward P/E', value: stock['Forward P/E'] || '-' },
          { key: 'PEG', value: stock['PEG'] || '-' },
          { key: 'P/S', value: stock['P/S'] || '-' },
          { key: 'P/B', value: stock['P/B'] || '-' },
          { key: 'P/FCF', value: stock['P/FCF'] || '-' }
        ]
      },
      {
        title: 'GuruFocus Quality Scores',
        icon: 'fa-solid fa-shield-halved',
        items: [
          { key: 'Piotroski F-Score', value: stock['Piotroski F-Score'] || '-', badge: getFScoreClass(stock['Piotroski F-Score']) },
          { key: 'Altman Z-Score', value: stock['Altman Z-Score'] || '-', badge: getZScoreClass(stock['Altman Z-Score']) },
          { key: 'Beneish M-Score', value: stock['Beneish M-Score'] || '-' },
          { key: 'ROIC', value: stock['ROIC'] || '-' },
          { key: 'WACC', value: stock['WACC'] ? `${stock['WACC']}%` : '-' }
        ]
      },
      {
        title: 'Financial Strength',
        icon: 'fa-solid fa-building-columns',
        items: [
          { key: 'Market Cap', value: stock['Market Cap'] || '-' },
          { key: 'Enterprise Value', value: stock['Enterprise Value'] || '-' },
          { key: 'Current Ratio', value: stock['Current Ratio'] || '-' },
          { key: 'Quick Ratio', value: stock['Quick Ratio'] || '-' },
          { key: 'Debt/Equity', value: stock['Debt/Eq'] || '-' },
          { key: 'LT Debt/Equity', value: stock['LT Debt/Eq'] || '-' },
          { key: 'Cash/Share', value: stock['Cash/sh'] || '-' },
          { key: 'Book Value/Share', value: stock['Book/sh'] || '-' }
        ]
      },
      {
        title: 'Performance & Growth',
        icon: 'fa-solid fa-arrow-trend-up',
        items: [
          { key: 'Change %', value: stock['Change %'] || '-', class: (stock['Change %'] || '').startsWith('-') ? 'value-neg' : 'value-pos' },
          { key: 'Perf Week', value: stock['Perf Week'] || '-' },
          { key: 'Perf Month', value: stock['Perf Month'] || '-' },
          { key: 'Perf Quarter', value: stock['Perf Quarter'] || '-' },
          { key: 'Perf Year', value: stock['Perf Year'] || '-' },
          { key: 'Perf YTD', value: stock['Perf YTD'] || '-' },
          { key: 'EPS next 5Y', value: stock['EPS next 5Y'] || '-' },
          { key: 'Sales Y/Y TTM', value: stock['Sales Y/Y TTM'] || '-' }
        ]
      },
      {
        title: 'TradingView Momentum & Targets',
        icon: 'fa-solid fa-chart-simple',
        items: [
          { key: 'Technical Rating', value: stock['TV Technical'] || '-', badge: getTVTechnicalClass(stock['TV Technical']) },
          { key: 'Technical Score', value: stock['TV Score'] || '-' },
          { key: '14-Day RSI', value: stock['TV RSI'] || '-' },
          { key: 'Analyst Target (12M)', value: stock['Analyst Target'] ? `$${stock['Analyst Target']}` : '-' },
          { key: 'Target Upside', value: stock['Target Upside %'] || '-', class: (stock['Target Upside %'] || '').startsWith('-') ? 'value-neg' : 'value-pos' },
          { key: 'Analyst Consensus', value: stock['Analyst Rating'] || '-' },
          { key: 'Analyst Range', value: (stock['Analyst Low'] && stock['Analyst High']) ? `$${stock['Analyst Low']} - $${stock['Analyst High']}` : '-' },
          { key: 'Next Earnings Date', value: stock['Next Earnings Date'] ? (stock['Days to Earnings'] !== null && stock['Days to Earnings'] !== undefined && stock['Days to Earnings'] !== '' ? `${stock['Next Earnings Date']} (${stock['Days to Earnings']}d)` : stock['Next Earnings Date']) : '-' }
        ]
      }
    ];
  };

  const getMoatClass = (moat) => {
    if (!moat) return 'neutral';
    const m = String(moat).toLowerCase();
    if (m.includes('wide')) return 'wide';
    if (m.includes('narrow')) return 'narrow';
    if (m.includes('moderate') || m.includes('mid')) return 'moderate';
    if (m.includes('none') || m.includes('weak') || m.includes('no')) return 'none';
    return 'neutral';
  };

  // Phase 4: Automated Bull / Bear Investment Thesis Generator
  const generateInvestmentThesis = (stock) => {
    if (!stock) return null;
    const score = parseFloat(stock['Composite Score'] || '50');
    const gfVal = stock['GF Valuation'] || '';
    const fScore = parseFloat(stock['Piotroski F-Score'] || '0');
    const zScore = parseFloat(stock['Altman Z-Score'] || '0');
    const tvTech = stock['TV Technical'] || 'Neutral';
    const upsideStr = stock['Target Upside %'] || '';
    const upside = parseNumber(upsideStr) || 0;
    const moat = stock['Moat'] || '';
    const de = parseFloat(stock['Debt/Eq'] || '0');

    const bullPoints = [];
    const bearPoints = [];

    // Valuation Bull / Bear
    if (gfVal.includes('Significantly Undervalued')) {
      bullPoints.push(`Deep Valuation Margin of Safety: Substantial discount to estimated intrinsic value ($${stock['GF Value'] || '-'}).`);
    } else if (gfVal.includes('Modestly Undervalued')) {
      bullPoints.push(`Favorable Valuation: Trading below estimated intrinsic value ($${stock['GF Value'] || '-'}).`);
    } else if (gfVal.includes('Value Trap')) {
      bearPoints.push(`Value Trap Caution: Depressed valuation may reflect structural business headwinds or earnings erosion.`);
    } else if (gfVal.includes('Overvalued')) {
      bearPoints.push(`Valuation Premium: Trading above estimated intrinsic value ($${stock['GF Value'] || '-'}), leaving little room for error.`);
    }

    // Analyst Upside
    if (upside >= 15) {
      bullPoints.push(`Wall Street Consensus: 12-month analyst target of $${stock['Analyst Target']} implies +${upside.toFixed(1)}% upside.`);
    } else if (upside < 0) {
      bearPoints.push(`Analyst Headwinds: Consensus target of $${stock['Analyst Target']} is below current market price (${upside.toFixed(1)}%).`);
    }

    // Financial Quality (F-Score)
    if (fScore >= 8) {
      bullPoints.push(`Elite Operational Momentum: Piotroski F-Score of ${fScore}/9 signals accelerating profitability and cash flow.`);
    } else if (fScore <= 4 && fScore > 0) {
      bearPoints.push(`Weak Quality Momentum: Low Piotroski F-Score (${fScore}/9) signals operational margin compression.`);
    }

    // Balance Sheet Safety (Z-Score)
    if (zScore >= 3.0) {
      bullPoints.push(`Fortress Balance Sheet: Altman Z-Score of ${zScore.toFixed(2)} places company firmly in safe zone.`);
    } else if (zScore < 1.81 && zScore > 0) {
      bearPoints.push(`Financial Stress Risk: Altman Z-Score of ${zScore.toFixed(2)} indicates leverage vulnerability.`);
    }

    // Debt Leverage
    if (de > 2.0) {
      bearPoints.push(`Elevated Leverage: Debt-to-Equity ratio of ${de.toFixed(2)} increases interest expense sensitivity.`);
    }

    // Economic Moat
    if (moat === 'Wide' || moat === 'Wide Moat') {
      bullPoints.push(`Wide Economic Moat: High pricing power, durable competitive barriers, and resilient return on capital.`);
    } else if (moat === 'None') {
      bearPoints.push(`Commoditized Profile: Lacks a defensible moat, exposing long-term margins to industry rivalry.`);
    }

    // Technical Momentum
    if (tvTech === 'Strong Buy' || tvTech === 'Buy') {
      bullPoints.push(`Bullish Technical Confirmation: TradingView technical consensus signals '${tvTech}'.`);
    } else if (tvTech === 'Sell' || tvTech === 'Strong Sell') {
      bearPoints.push(`Bearish Momentum: Technical indicators signal '${tvTech}', indicating short-term price pressure.`);
    }

    // Fallbacks
    if (bullPoints.length === 0) bullPoints.push('Established market footprint with stable recurring commercial demand.');
    if (bullPoints.length === 1) bullPoints.push('Diversified revenue streams with sound institutional sponsorship.');
    if (bearPoints.length === 0) bearPoints.push('Subject to broader macroeconomic headwinds and sector volatility.');
    if (bearPoints.length === 1) bearPoints.push('Potential margin pressure from inflationary cost inputs or competitive forces.');

    let summary = '';
    if (score >= 80) {
      summary = `Top-tier conviction compounder combining deep valuation support, fortress financial safety, and positive momentum. Prime candidate for core accumulation.`;
    } else if (score >= 65) {
      summary = `Attractive risk-reward profile with solid fundamentals and reasonable valuation. Suitable for position entry on tactical pullbacks.`;
    } else if (score >= 50) {
      summary = `Balanced hold candidate. While core operations are stable, upside potential is currently balanced by valuation or technical headwinds.`;
    } else {
      summary = `High-risk profile with fundamental or valuation concerns. Caution is warranted until operational momentum or balance sheet strength improves.`;
    }

    return { summary, bullPoints: bullPoints.slice(0, 3), bearPoints: bearPoints.slice(0, 3) };
  };

  // Phase 4: Export CSV Watchlist Report
  const handleExportCSV = () => {
    if (stocks.length === 0) {
      addToast('No stock data available to export', 'warning');
      return;
    }
    const headers = [
      'Ticker', 'Name', 'Sector', 'Market Cap', 'Price', 'Change %',
      'Composite Score', 'GF Value', 'GF Valuation', 'Moat',
      'Piotroski F-Score', 'Altman Z-Score', 'P/E', 'Forward P/E', 'PEG', 'Debt/Eq',
      'TV Technical', 'TV RSI', 'Analyst Target', 'Target Upside %', 'Next Earnings Date'
    ];
    const csvRows = [headers.join(',')];
    stocks.forEach(s => {
      const row = headers.map(h => {
        let val = s[h] !== undefined && s[h] !== null ? String(s[h]) : '';
        val = val.replace(/"/g, '""');
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = `"${val}"`;
        }
        return val;
      });
      csvRows.push(row.join(','));
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Stock_Intelligence_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast('Stock Intelligence Report exported to CSV successfully!', 'success');
  };

  return (
    <div className="app-container">
      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <i className={`fa-solid ${t.type === 'warning' ? 'fa-triangle-exclamation' : t.type === 'success' ? 'fa-circle-check' : 'fa-circle-info'}`}></i>
            <span>{t.msg}</span>
            <button className="toast-dismiss" onClick={() => dismissToast(t.id)}>
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        ))}
      </div>
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <i className="fa-solid fa-chart-pie"></i>
          <div>
            <h1>Stock Intelligence Portal</h1>
          </div>
        </div>

        {/* Top-Level Route Switcher */}
        <div className="app-nav-tabs">
          <button
            className={`nav-tab-btn ${currentRoute === 'screener' ? 'active' : ''}`}
            onClick={() => navigateToRoute('screener')}
          >
            <i className="fa-solid fa-table-list"></i>
            <span>Watchlist Screener</span>
          </button>
          <button
            className={`nav-tab-btn ${currentRoute === 'oracle' ? 'active' : ''}`}
            onClick={() => navigateToRoute('oracle')}
          >
            <i className="fa-solid fa-brain-circuit"></i>
            <span>Stock Oracle™ Analysis</span>
            <span className="nav-badge-pulse">3 Theses</span>
          </button>
        </div>

        <div className="header-actions">
          <div className="last-updated">
            <i className="fa-solid fa-clock-rotate-left mr-2"></i> {isFiltered ? `${matchingCount} of ${totalTrackedCount} Tickers` : `${totalTrackedCount} Tickers Tracked`}
          </div>
          {currentRoute === 'screener' && (
            <>
              <button
                className="btn btn-primary"
                onClick={triggerFullScrape}
                disabled={scrapeStatus.running}
              >
                {scrapeStatus.running ? (
                  <>
                    <i className="fa-solid fa-circle-notch fa-spin"></i> Scraping...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-arrows-rotate"></i> Run Full Scrape
                  </>
                )}
              </button>
              <button className="btn btn-secondary" onClick={() => setIsAddOpen(true)}>
                <i className="fa-solid fa-plus"></i> Add Ticker
              </button>
              <button className="btn btn-secondary" onClick={() => setIsAllocatorOpen(true)} title="Portfolio Conviction Sizing Tool">
                <i className="fa-solid fa-wallet"></i> Allocator
              </button>
              <button className="btn btn-secondary" onClick={handleExportCSV} title="Export Watchlist to CSV">
                <i className="fa-solid fa-file-arrow-down"></i> Export CSV
              </button>
            </>
          )}
          {currentRoute === 'oracle' && (
            <button className="btn btn-secondary" onClick={() => navigateToRoute('screener')}>
              <i className="fa-solid fa-arrow-left"></i> Back to Screener
            </button>
          )}
        </div>
      </header>

      {/* Demo Mode Banner */}
      {isDemo && (
        <div className="notification-banner demo" style={{ marginBottom: '1.5rem', backgroundColor: 'rgba(59, 130, 246, 0.08)', borderColor: 'rgba(59, 130, 246, 0.2)' }}>
          <div className="d-flex align-items-center gap-2">
            <i className="fa-solid fa-circle-info text-info"></i>
            <span><strong>Read-only Demo Mode:</strong> You are viewing a static copy of the dashboard hosted on GitHub Pages. Backend scraping and modification actions are disabled.</span>
          </div>
          <div className="last-updated">
            <span className="badge badge-info" style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>Static Data</span>
          </div>
        </div>
      )}

      {/* Scrape Progress Banner */}
      {scrapeStatus.running && (
        <div className="notification-banner scraping">
          <div className="d-flex align-items-center gap-2">
            <i className="fa-solid fa-circle-notch fa-spin text-warning"></i>
            <span><strong>Status:</strong> {scrapeStatus.message}</span>
          </div>
          <div className="scrape-progress-bar">
            <div
              className="scrape-progress-fill"
              style={{ width: `${scrapeStatus.total > 0 ? (scrapeStatus.progress / scrapeStatus.total) * 100 : 0}%` }}
            ></div>
          </div>
          <span>{scrapeStatus.progress} / {scrapeStatus.total} Stocks Scraped</span>
        </div>
      )}

      {/* SCREENER VIEW */}
      {currentRoute === 'screener' && (
        <>
          {/* Summary Cards */}
          <div className="summary-grid">
            <div className="summary-card">
              <div className="card-icon-wrapper primary">
                <i className="fa-solid fa-list-check"></i>
              </div>
              <div className="card-content">
                <h3>{isFiltered ? 'Matching Tickers' : 'Total Tickers'}</h3>
                <div className="card-value">{isFiltered ? matchingCount : totalTrackedCount}</div>
                {isFiltered && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>of {totalTrackedCount} total</div>}
              </div>
            </div>

            <div className="summary-card">
              <div className="card-icon-wrapper success">
                <i className="fa-solid fa-circle-arrow-down"></i>
              </div>
              <div className="card-content">
                <h3>Undervalued Stocks</h3>
                <div className="card-value">{undervaluedCount}</div>
                {isFiltered && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>in filtered view</div>}
              </div>
            </div>

            <div className="summary-card">
              <div className="card-icon-wrapper danger">
                <i className="fa-solid fa-circle-exclamation"></i>
              </div>
              <div className="card-content">
                <h3>Value Traps</h3>
                <div className="card-value">{trapCount}</div>
                {isFiltered && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>in filtered view</div>}
              </div>
            </div>

            <div className="summary-card">
              <div className="card-icon-wrapper warning">
                <i className="fa-solid fa-tags"></i>
              </div>
              <div className="card-content">
                <h3>Sectors Tracked</h3>
                <div className="card-value">{sectorCount}</div>
                {isFiltered && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>in filtered view</div>}
              </div>
            </div>
          </div>

          {/* Watchlist Pulse & Buy-the-Dip Radar */}
          <div className="watchlist-pulse-bar">
            <div className="pulse-section">
              <span className="pulse-label"><i className="fa-solid fa-arrow-trend-up" style={{ color: '#34d399' }}></i> Top Gainers:</span>
              <div className="pulse-items">
                {topGainers.map(s => (
                  <button key={s.Ticker} className="pulse-pill" onClick={() => handleSelectStock(s)} title="Click to view stock details">
                    <strong>{s.Ticker}</strong> <span className="value-pos">{s['Change %']}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pulse-section">
              <span className="pulse-label"><i className="fa-solid fa-bullseye" style={{ color: '#fbbf24' }}></i> Quality Dips (Score &ge; 65):</span>
              <div className="pulse-items">
                {topDips.length === 0 ? (
                  <span className="pulse-empty">No high-conviction dips today</span>
                ) : (
                  topDips.map(s => (
                    <button key={s.Ticker} className="pulse-pill dip" onClick={() => handleSelectStock(s)} title="Click to view stock details">
                      <strong>{s.Ticker}</strong> <span className="value-neg">{s['Change %']}</span> <span className="pulse-score-tag">⭐{s['Composite Score']}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <button
              className={`pulse-filter-btn ${selectedConvictionFilter === 'dip' ? 'active' : ''}`}
              onClick={() => setSelectedConvictionFilter(prev => prev === 'dip' ? '' : 'dip')}
              title="Filter for high-conviction stocks trading down today"
            >
              <i className="fa-solid fa-bolt"></i> {selectedConvictionFilter === 'dip' ? 'Clear Dip Filter' : '🎯 Buy the Dip Radar'}
            </button>
          </div>

          {/* Controls & Filter Bar */}
          <div className="controls-card">
            <div className="search-wrapper">
              <i className="fa-solid fa-magnifying-glass"></i>
              <input
                type="text"
                className="search-input"
                placeholder="Search by ticker, company, sector, country..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="filter-select"
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
            >
              <option value="">All Sectors</option>
              {sectors.map(sec => (
                <option key={sec} value={sec}>{sec}</option>
              ))}
            </select>

            <select
              className="filter-select"
              value={selectedValuation}
              onChange={(e) => setSelectedValuation(e.target.value)}
            >
              <option value="">All Valuations</option>
              <option value="Significantly Undervalued">Significantly Undervalued</option>
              <option value="Modestly Undervalued">Modestly Undervalued</option>
              <option value="Fairly Valued">Fairly Valued</option>
              <option value="Modestly Overvalued">Modestly Overvalued</option>
              <option value="Significantly Overvalued">Significantly Overvalued</option>
              <option value="Value Trap">Possible Value Trap</option>
            </select>

            <select
              className="filter-select"
              value={selectedScoreFilter}
              onChange={(e) => setSelectedScoreFilter(e.target.value)}
            >
              <option value="">All Scores</option>
              <option value="high-f">High F-Score (&gt;= 7)</option>
              <option value="safe-z">Safe Z-Score (&gt;= 2.99)</option>
            </select>

            <select
              className="filter-select"
              value={selectedTVFilter}
              onChange={(e) => setSelectedTVFilter(e.target.value)}
            >
              <option value="">All Technicals</option>
              <option value="bullish">Bullish (Buy / Strong Buy)</option>
              <option value="strong-buy">Strong Buy Only</option>
              <option value="neutral">Neutral</option>
              <option value="bearish">Bearish (Sell / Strong Sell)</option>
            </select>

            <select
              className="filter-select"
              value={selectedConvictionFilter}
              onChange={(e) => setSelectedConvictionFilter(e.target.value)}
            >
              <option value="">All Conviction Scores</option>
              <option value="high">High Conviction (&gt;= 80)</option>
              <option value="buy">Buy Candidates (&gt;= 65)</option>
              <option value="dip">🎯 Buy the Dip (Score &gt;= 65 &amp; Down)</option>
              <option value="hold">Neutral / Hold (50-64)</option>
              <option value="risk">Caution (&lt; 50)</option>
            </select>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRefreshTradingView}
              disabled={isTVRefreshing}
              title="Instant refresh of live prices, technicals, scores, and targets via TradingView (0.3s)"
            >
              {isTVRefreshing ? (
                <><i className="fa-solid fa-circle-notch fa-spin"></i> Refreshing...</>
              ) : (
                <><i className="fa-solid fa-bolt text-warning"></i> Fast TV Refresh</>
              )}
            </button>

            {/* Column Visibility Selector */}
            <div className="column-toggle-wrapper" ref={columnDropdownRef}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsColumnDropdownOpen(!isColumnDropdownOpen)}
              >
                <i className="fa-solid fa-columns"></i> Columns
              </button>
              {isColumnDropdownOpen && (
                <div className="column-toggle-dropdown">
                  {allColumns.map(col => (
                    <label key={col.id} className="column-toggle-item">
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.id)}
                        onChange={() => toggleColumnVisibility(col.id)}
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {isFiltered && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedSector('');
                  setSelectedValuation('');
                  setSelectedScoreFilter('');
                  setSelectedTVFilter('');
                  setSelectedConvictionFilter('');
                }}
                title="Reset all search and filter dropdowns"
                style={{ color: '#fbbf24', borderColor: 'rgba(245, 158, 11, 0.4)' }}
              >
                <i className="fa-solid fa-rotate-left"></i> Reset Filters
              </button>
            )}
          </div>

          {/* Table Section */}
          {loading ? (
            <div className="loader-wrapper">
              <div className="spinner"></div>
              <p>Loading Stock Dashboard...</p>
            </div>
          ) : (
            <div>
              <div className="table-wrapper">
                {paginatedStocks.length === 0 ? (
                  <div className="empty-state">
                    <i className="fa-solid fa-folder-open"></i>
                    <p>No matching stocks found. Try broadening your filters.</p>
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '38px', textAlign: 'center', cursor: 'default' }}>
                          <input
                            type="checkbox"
                            onChange={handleSelectAllCompare}
                            checked={paginatedStocks.length > 0 && paginatedStocks.every(s => selectedCompare.includes(s.Ticker))}
                            title="Select all for comparison"
                          />
                        </th>
                        <th onClick={() => handleSort('Ticker')}>
                          Ticker
                          <i className={`fa-solid ${sortKey === 'Ticker' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                        </th>
                        {visibleColumns.includes('Score') && (
                          <th onClick={() => handleSort('Composite Score')}>
                            Score
                            <i className={`fa-solid ${sortKey === 'Composite Score' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('Name') && (
                          <th onClick={() => handleSort('Name')}>
                            Company Name
                            <i className={`fa-solid ${sortKey === 'Name' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('Sector') && (
                          <th onClick={() => handleSort('Sector')}>
                            Sector
                            <i className={`fa-solid ${sortKey === 'Sector' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('Market Cap') && (
                          <th onClick={() => handleSort('Market Cap')}>
                            Market Cap
                            <i className={`fa-solid ${sortKey === 'Market Cap' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('Price') && (
                          <th className="text-right" onClick={() => handleSort('Price')}>
                            Price
                            <i className={`fa-solid ${sortKey === 'Price' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('GF Value') && (
                          <th className="text-right" onClick={() => handleSort('GF Value')}>
                            GF Value
                            <i className={`fa-solid ${sortKey === 'GF Value' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('Change %') && (
                          <th className="text-right" onClick={() => handleSort('Change %')}>
                            Change %
                            <i className={`fa-solid ${sortKey === 'Change %' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('P/E') && (
                          <th className="text-right" onClick={() => handleSort('P/E')}>
                            P/E
                            <i className={`fa-solid ${sortKey === 'P/E' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('GF Valuation') && (
                          <th onClick={() => handleSort('GF Valuation')}>
                            GF Valuation
                            <i className={`fa-solid ${sortKey === 'GF Valuation' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('TV Technical') && (
                          <th onClick={() => handleSort('TV Technical')}>
                            TV Technical
                            <i className={`fa-solid ${sortKey === 'TV Technical' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('Analyst Target') && (
                          <th className="text-right" onClick={() => handleSort('Analyst Target')}>
                            Analyst Target
                            <i className={`fa-solid ${sortKey === 'Analyst Target' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('F-Score') && (
                          <th className="text-right" onClick={() => handleSort('Piotroski F-Score')}>
                            F-Score
                            <i className={`fa-solid ${sortKey === 'Piotroski F-Score' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        {visibleColumns.includes('Z-Score') && (
                          <th className="text-right" onClick={() => handleSort('Altman Z-Score')}>
                            Z-Score
                            <i className={`fa-solid ${sortKey === 'Altman Z-Score' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon`}></i>
                          </th>
                        )}
                        <th className="text-center" style={{ width: '60px', cursor: 'default' }}>Del</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedStocks.map((item) => {
                        const changeStr = item['Change %'] || '0.00%';
                        const isChangeNeg = changeStr.startsWith('-');
                        const dataStatus = getDataStatus(item);
                        const daysToEarnings = item['Days to Earnings'];
                        const hasUpcomingEarnings = daysToEarnings !== null && daysToEarnings !== undefined && daysToEarnings !== '' && parseInt(daysToEarnings) <= 14 && parseInt(daysToEarnings) >= 0;
                        const pBreakdown = getPillarBreakdown(item);

                        return (
                          <tr
                            key={item.Ticker}
                            onClick={() => handleSelectStock(item)}
                            className={`${dataStatus === 'pending' ? 'row-pending' : dataStatus === 'partial' ? 'row-partial' : ''} ${selectedCompare.includes(item.Ticker) ? 'row-selected' : ''}`}
                          >
                            <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={selectedCompare.includes(item.Ticker)}
                                onChange={(e) => handleToggleCompare(e, item.Ticker)}
                                title={`Select ${item.Ticker} to compare`}
                              />
                            </td>
                            <td>
                              <div className="ticker-cell">
                                <span className="ticker-badge">{item.Ticker}</span>
                                {hasUpcomingEarnings && (
                                  <div className="tooltip-wrapper tooltip-align-left" onClick={(e) => e.stopPropagation()}>
                                    <span className="earnings-alert-badge">
                                      📅 {daysToEarnings}d
                                    </span>
                                    <div className="custom-tooltip">
                                      <div className="tooltip-title">
                                        <i className="fa-solid fa-calendar-days" style={{ color: '#fbbf24' }}></i>
                                        Earnings Catalyst
                                      </div>
                                      <div className="tooltip-body">
                                        Expected on <strong>{item['Next Earnings Date']}</strong> ({daysToEarnings} day{daysToEarnings !== '1' && daysToEarnings !== 1 ? 's' : ''} away).
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {dataStatus === 'pending' && (
                                  <div className="tooltip-wrapper tooltip-align-left" onClick={(e) => e.stopPropagation()}>
                                    <span className="data-status-icon pending">
                                      <i className="fa-solid fa-clock"></i>
                                    </span>
                                    <div className="custom-tooltip">
                                      <div className="tooltip-title">
                                        <i className="fa-solid fa-clock" style={{ color: 'var(--text-secondary)' }}></i>
                                        Pending Scrape
                                      </div>
                                      <div className="tooltip-body">
                                        <p style={{ margin: '0 0 4px 0' }}>This stock was recently added and has not been scraped yet.</p>
                                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Click "Start Scraping" above to pull live financials.</span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {dataStatus === 'partial' && (() => {
                                  const missingList = getMissingFieldsList(item);
                                  return (
                                    <div className="tooltip-wrapper tooltip-align-left" onClick={(e) => e.stopPropagation()}>
                                      <span className="data-status-icon partial">
                                        <i className="fa-solid fa-triangle-exclamation"></i>
                                      </span>
                                      <div className="custom-tooltip">
                                        <div className="tooltip-title">
                                          <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--warning)' }}></i>
                                          GuruFocus Details Pending
                                        </div>
                                        <div className="tooltip-body">
                                          <p style={{ margin: '0 0 4px 0', fontSize: '0.78rem', color: '#e2e8f0' }}>
                                            GuruFocus metrics ({missingList.join(', ') || 'GF Value, F-Score, Z-Score'}) require server-side Python scraping.
                                          </p>
                                          <span style={{ fontSize: '0.7rem', color: '#fbbf24' }}>
                                            Run GitHub Actions "Stock Scraper" or local ./start.sh to populate full GF metrics.
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            </td>
                            {visibleColumns.includes('Score') && (
                              <td>
                                {item['Composite Score'] !== undefined && item['Composite Score'] !== '' && item['Composite Score'] !== '-' ? (
                                  <div className="tooltip-wrapper" onClick={(e) => e.stopPropagation()}>
                                    <div className={`score-pill ${getScoreClass(item['Composite Score'])}`}>
                                      <span className="score-num">{item['Composite Score']}</span>
                                      <span className="score-denom">/100</span>
                                    </div>
                                    <div className="custom-tooltip">
                                      <div className="tooltip-title">
                                        <span>Composite Score: {item['Composite Score']}/100</span>
                                        <span className={`score-badge ${getScoreClass(item['Composite Score'])}`} style={{ padding: '0.1rem 0.35rem', fontSize: '0.65rem' }}>
                                          {getConvictionTier(item['Composite Score'])}
                                        </span>
                                      </div>
                                      <div className="tooltip-body">
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', marginTop: '4px' }}>
                                          <div>Valuation: <strong style={{ color: '#38bdf8' }}>{pBreakdown.valuation}/25</strong></div>
                                          <div>Quality: <strong style={{ color: '#34d399' }}>{pBreakdown.quality}/35</strong></div>
                                          <div>Moat: <strong style={{ color: '#a78bfa' }}>{pBreakdown.moat}/15</strong></div>
                                          <div>Momentum: <strong style={{ color: '#f59e0b' }}>{pBreakdown.momentum}/25</strong></div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : '-'}
                              </td>
                            )}
                            {visibleColumns.includes('Name') && (
                              <td style={{ fontWeight: 500, whiteSpace: 'normal', maxWidth: '240px' }}>{item.Name || '-'}</td>
                            )}
                            {visibleColumns.includes('Sector') && (
                              <td><span className="sector-badge">{item.Sector || '-'}</span></td>
                            )}
                            {visibleColumns.includes('Market Cap') && (
                              <td>{item['Market Cap'] || '-'}</td>
                            )}
                            {visibleColumns.includes('Price') && (
                              <td className="text-right" style={{ fontWeight: 500 }}>
                                {item.Price ? `$${item.Price}` : '-'}
                              </td>
                            )}
                            {visibleColumns.includes('GF Value') && (
                              <td className={`text-right ${getGFValuationColorClass(item['GF Valuation'])}`}>
                                {item['GF Value'] ? `$${item['GF Value']}` : '-'}
                              </td>
                            )}
                            {visibleColumns.includes('Change %') && (
                              <td className={`text-right ${isChangeNeg ? 'value-neg' : 'value-pos'}`}>
                                {!isChangeNeg && changeStr !== '0.00%' && changeStr !== '-' ? `+${changeStr}` : changeStr}
                              </td>
                            )}
                            {visibleColumns.includes('P/E') && (
                              <td className="text-right">{item['P/E'] || '-'}</td>
                            )}
                            {visibleColumns.includes('GF Valuation') && (
                              <td>
                                {item['GF Valuation'] !== '-' && item['GF Valuation'] ? (
                                  <span className={`score-badge ${getGFValuationClass(item['GF Valuation'])}`}>
                                    {item['GF Valuation']}
                                  </span>
                                ) : '-'}
                              </td>
                            )}
                            {visibleColumns.includes('TV Technical') && (
                              <td>
                                {item['TV Technical'] ? (
                                  <span className={`score-badge ${getTVTechnicalClass(item['TV Technical'])}`}>
                                    {item['TV Technical']}
                                  </span>
                                ) : '-'}
                              </td>
                            )}
                            {visibleColumns.includes('Analyst Target') && (
                              <td className="text-right">
                                {item['Analyst Target'] ? (
                                  <div className="target-price-cell">
                                    <span style={{ fontWeight: 500 }}>${item['Analyst Target']}</span>
                                    {item['Target Upside %'] && (
                                      <span className={`target-upside ${item['Target Upside %'].startsWith('-') ? 'value-neg' : 'value-pos'}`}>
                                        {item['Target Upside %']}
                                      </span>
                                    )}
                                  </div>
                                ) : '-'}
                              </td>
                            )}
                            {visibleColumns.includes('F-Score') && (
                              <td className="text-right">
                                {item['Piotroski F-Score'] !== '-' && item['Piotroski F-Score'] ? (
                                  <span className={`score-badge ${getFScoreClass(item['Piotroski F-Score'])}`}>
                                    {item['Piotroski F-Score']}
                                  </span>
                                ) : '-'}
                              </td>
                            )}
                            {visibleColumns.includes('Z-Score') && (
                              <td className="text-right">
                                {item['Altman Z-Score'] !== '-' && item['Altman Z-Score'] ? (
                                  <span className={`score-badge ${getZScoreClass(item['Altman Z-Score'])}`}>
                                    {item['Altman Z-Score']}
                                  </span>
                                ) : '-'}
                              </td>
                            )}
                            <td className="text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="tooltip-wrapper tooltip-align-right">
                                <button
                                  className="delete-btn"
                                  onClick={() => setDeleteConfirmStock(item)}
                                >
                                  <i className="fa-solid fa-trash-can"></i>
                                </button>
                                <div className="custom-tooltip">
                                  <div className="tooltip-body" style={{ whiteSpace: 'nowrap' }}>
                                    Remove {item.Ticker}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination Controls */}
              {sortedStocks.length > 0 && (
                <div className="pagination-container">
                  <div>
                    Showing {sortedStocks.length === 0 ? 0 : (pageSize === -1 ? 1 : (currentPage - 1) * pageSize + 1)} to{' '}
                    {pageSize === -1 ? sortedStocks.length : Math.min(currentPage * pageSize, sortedStocks.length)} of{' '}
                    {isFiltered ? `${sortedStocks.length} matching stocks (filtered from ${totalTrackedCount} total)` : `${sortedStocks.length} stocks`}
                  </div>
                  <div className="pagination-controls">
                    <span style={{ marginRight: '1rem' }}>Rows per page:</span>
                    <select
                      className="filter-select"
                      style={{ padding: '0.375rem 2rem 0.375rem 0.75rem', marginRight: '1.5rem' }}
                      value={pageSize}
                      onChange={(e) => setPageSize(parseInt(e.target.value))}
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={-1}>All</option>
                    </select>

                    <button
                      className="pagination-btn"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1 || pageSize === -1}
                    >
                      <i className="fa-solid fa-angles-left"></i>
                    </button>
                    <button
                      className="pagination-btn"
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1 || pageSize === -1}
                    >
                      <i className="fa-solid fa-angle-left"></i>
                    </button>
                    <span className="page-indicator">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      className="pagination-btn"
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages || pageSize === -1}
                    >
                      <i className="fa-solid fa-angle-right"></i>
                    </button>
                    <button
                      className="pagination-btn"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages || pageSize === -1}
                    >
                      <i className="fa-solid fa-angles-right"></i>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* STOCK ORACLE 3-THESIS ANALYSIS LAB ROUTE */}
      {currentRoute === 'oracle' && (
        <StockOracleView
          stocks={stocks}
          selectedTicker={oracleSelectedTicker}
          onSelectTicker={(sym) => {
            setOracleSelectedTicker(sym);
            window.location.hash = `#/oracle/${sym}`;
          }}
          isDemo={isDemo}
        />
      )}

      {/* Unified Stock Details & Intelligence Modal with 4 Full Tabs */}
      {selectedStock && (
        <div className="modal-overlay" onClick={() => setSelectedStock(null)}>
          <div className="modal-container stock-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-desc">
                <h2>
                  <span className="ticker-badge">{selectedStock.Ticker}</span>
                  {selectedStock.Name}
                </h2>
                <p>
                  {selectedStock.Sector || '-'} &bull; {selectedStock.Country || '-'}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const sym = selectedStock.Ticker;
                    setSelectedStock(null);
                    navigateToRoute('oracle', sym);
                  }}
                  title="Open Stock Oracle 3-Thesis Valuation Lab for this stock"
                >
                  <i className="fa-solid fa-brain-circuit mr-1 text-primary"></i> Stock Oracle Lab
                </button>
                <button className="modal-close-btn" onClick={() => setSelectedStock(null)}>
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>

            {/* GuruFocus Pending Scrape Banner */}
            {(selectedStock._pendingGF || !selectedStock['GF Value'] || selectedStock['GF Value'] === '-') && (
              <div style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '8px',
                padding: '0.75rem 1.25rem',
                margin: '1rem 1.5rem 0',
                fontSize: '0.82rem',
                color: '#fbbf24',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem'
              }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '1rem', marginTop: '2px' }}></i>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>GuruFocus Details Pending Scrape for {selectedStock.Ticker}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.4 }}>
                    GuruFocus metrics (GF Value, Piotroski F-Score, Altman Z-Score, WACC) cannot be scraped in-browser due to third-party Cloudflare TLS antibot protections.
                    To populate verified GuruFocus data, trigger the <strong>Run Stock Scraper</strong> workflow on GitHub Actions or launch locally via <code>./start.sh</code>.
                  </div>
                </div>
              </div>
            )}

            {/* 4 Navigation Tabs */}
            <div className="modal-tabs">
              <button
                className={`modal-tab-btn ${activeStockTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveStockTab('overview')}
              >
                <i className="fa-solid fa-shield-halved"></i> Business &amp; Moat
              </button>
              <button
                className={`modal-tab-btn ${activeStockTab === 'indicators' ? 'active' : ''}`}
                onClick={() => setActiveStockTab('indicators')}
              >
                <i className="fa-solid fa-chart-pie"></i> Financials &amp; Thesis
              </button>
              <button
                className={`modal-tab-btn ${activeStockTab === 'chart' ? 'active' : ''}`}
                onClick={() => setActiveStockTab('chart')}
              >
                <i className="fa-solid fa-chart-candlestick"></i> TradingView Chart
              </button>
              <button
                className={`modal-tab-btn ${activeStockTab === 'news' ? 'active' : ''}`}
                onClick={() => setActiveStockTab('news')}
              >
                <i className="fa-solid fa-newspaper"></i> Live News &amp; Catalysts {newsData.length > 0 && <span className="tab-counter">{newsData.length}</span>}
              </button>
            </div>

            <div className="modal-body">
              {/* TAB 1: Business & Moat */}
              {activeStockTab === 'overview' && (
                overviewLoading ? (
                  <div className="loader-wrapper" style={{ minHeight: '220px' }}>
                    <div className="spinner" style={{ width: '2rem', height: '2rem' }}></div>
                    <p style={{ fontSize: '0.875rem', marginTop: '0.75rem' }}>Fetching company intelligence and economic moat...</p>
                  </div>
                ) : overviewData ? (
                  <div className="overview-content-layout">
                    {/* Economic Moat Showcase Card */}
                    <div className={`moat-showcase-card moat-${getMoatClass(overviewData.moat)}`}>
                      <div className="moat-showcase-left">
                        <div className="moat-title-row">
                          <span className={`moat-icon-badge moat-badge-${getMoatClass(overviewData.moat)}`}>
                            <i className="fa-solid fa-shield-halved"></i>
                          </span>
                          <div>
                            <div className="moat-header-label">Economic Moat Rating</div>
                            <div className="moat-tier-name">
                              {overviewData.moat_label || (overviewData.moat ? `${overviewData.moat} Moat` : 'Not Available')}
                            </div>
                          </div>
                        </div>

                        {/* 10-Point Score Visual Meter */}
                        {overviewData.moat_score !== null && overviewData.moat_score !== undefined && (
                          <div className="moat-meter-container">
                            <div className="moat-meter-bar">
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(step => (
                                <div
                                  key={step}
                                  className={`moat-meter-segment ${step <= Number(overviewData.moat_score) ? 'filled ' + getMoatClass(overviewData.moat) : ''}`}
                                  title={`Moat Score: ${step}/10`}
                                />
                              ))}
                            </div>
                            <span className="moat-meter-score">{overviewData.moat_score}/10 Moat Score</span>
                          </div>
                        )}

                        <p className="moat-description-text">
                          {overviewData.moat === 'Wide' && 'Dominant sustainable competitive advantage, pricing power, and durable economic barriers.'}
                          {overviewData.moat === 'Narrow' && 'Solid competitive moat with substantial barriers to entry and resilient profitability.'}
                          {overviewData.moat === 'Moderate' && 'Moderate defensibility with steady market presence against industry competition.'}
                          {overviewData.moat === 'None' && 'Vulnerable or commoditized position with intense pricing and competitive pressure.'}
                          {(!overviewData.moat || overviewData.moat === 'Not available') && 'Moat evaluation not determined or not applicable for this instrument.'}
                        </p>
                      </div>

                      {/* Quality & Predictability Column */}
                      <div className="moat-showcase-right">
                        {overviewData.gf_score && (
                          <div className="moat-metric-pill">
                            <span className="metric-pill-label">GF Score</span>
                            <span className="metric-pill-val highlight-green">{overviewData.gf_score} <small>/ 100</small></span>
                          </div>
                        )}
                        {overviewData.predictability !== null && overviewData.predictability !== undefined && (
                          <div className="moat-metric-pill">
                            <span className="metric-pill-label">Predictability</span>
                            <span className="metric-pill-val highlight-amber">
                              {overviewData.predictability} <i className="fa-solid fa-star" style={{ fontSize: '0.75rem' }}></i>
                            </span>
                          </div>
                        )}
                        {overviewData.wacc && (
                          <div className="moat-metric-pill">
                            <span className="metric-pill-label">WACC</span>
                            <span className="metric-pill-val">{overviewData.wacc}%</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Corporate Profile Metadata Grid */}
                    {overviewData.meta && Object.keys(overviewData.meta).length > 0 && (
                      <div className="overview-meta-section">
                        <div className="meta-grid">
                          {overviewData.meta.website && (
                            <div className="meta-card">
                              <div className="meta-card-label"><i className="fa-solid fa-globe"></i> Official Website</div>
                              <div className="meta-card-value">
                                <a
                                  href={overviewData.meta.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="meta-link"
                                >
                                  {overviewData.meta.website.replace(/^https?:\/\/(www\.)?/, '')}
                                  <i className="fa-solid fa-arrow-up-right-from-square"></i>
                                </a>
                              </div>
                            </div>
                          )}
                          {overviewData.meta.employees && (
                            <div className="meta-card">
                              <div className="meta-card-label"><i className="fa-solid fa-users"></i> Employees</div>
                              <div className="meta-card-value">{overviewData.meta.employees}</div>
                            </div>
                          )}
                          {overviewData.meta.ipo_date && (
                            <div className="meta-card">
                              <div className="meta-card-label"><i className="fa-solid fa-calendar-check"></i> IPO Date</div>
                              <div className="meta-card-value">{overviewData.meta.ipo_date}</div>
                            </div>
                          )}
                          {overviewData.meta.address && (
                            <div className="meta-card meta-card-wide">
                              <div className="meta-card-label"><i className="fa-solid fa-location-dot"></i> Headquarters</div>
                              <div className="meta-card-value">{overviewData.meta.address}</div>
                            </div>
                          )}
                        </div>

                        {/* Benchmark Index Membership Chips */}
                        {overviewData.meta.indices && overviewData.meta.indices.length > 0 && (
                          <div className="index-membership-row">
                            <span className="index-membership-title"><i className="fa-solid fa-layer-group"></i> Benchmark Indices:</span>
                            <div className="index-pill-list">
                              {overviewData.meta.indices.map((idxName, i) => (
                                <span key={i} className="index-chip">{idxName}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Regulatory & Classification IDs */}
                        {(overviewData.meta.isin || overviewData.meta.sic || overviewData.meta.naics) && (
                          <div className="regulatory-ids-row">
                            {overviewData.meta.isin && <span className="id-badge"><strong>ISIN:</strong> {overviewData.meta.isin}</span>}
                            {overviewData.meta.sic && <span className="id-badge"><strong>SIC:</strong> {overviewData.meta.sic}</span>}
                            {overviewData.meta.naics && <span className="id-badge"><strong>NAICS:</strong> {overviewData.meta.naics}</span>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Executive Narrative Description Card */}
                    <div className="overview-narrative-card">
                      <div className="narrative-card-header">
                        <div className="narrative-card-title">
                          <i className="fa-solid fa-align-left"></i> Business Model &amp; Operations
                        </div>
                        {overviewData.description && (
                          <button
                            className="btn-copy-desc"
                            onClick={() => {
                              navigator.clipboard.writeText(overviewData.description);
                              addToast('Business description copied to clipboard', 'info');
                            }}
                            title="Copy Description"
                          >
                            <i className="fa-regular fa-copy"></i> Copy Narrative
                          </button>
                        )}
                      </div>
                      {overviewData.description ? (
                        <div className="overview-desc-text">
                          {overviewData.description}
                        </div>
                      ) : (
                        <div className="overview-no-desc">
                          <i className="fa-solid fa-circle-info"></i>
                          <span>No business narrative available. Visit GuruFocus or Finviz for full coverage.</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '2rem' }}>
                    <p>No overview data available for {selectedStock.Ticker}.</p>
                  </div>
                )
              )}

              {/* TAB 2: Financials & Thesis */}
              {activeStockTab === 'indicators' && (
                <>
                  {/* 4-Pillar Conviction Banner */}
                  {(() => {
                    const b = getPillarBreakdown(selectedStock);
                    const thesis = generateInvestmentThesis(selectedStock);
                    return (
                      <>
                        <div className="conviction-meter-banner">
                          <div className="conviction-header-left">
                            <div className={`score-pill large ${getScoreClass(b.total)}`}>
                              <span className="score-num">{b.total}</span>
                              <span className="score-denom">/100</span>
                            </div>
                            <div className="conviction-info">
                              <h3>{getConvictionTier(b.total)}</h3>
                              <p>Multi-Factor Quality, Valuation, Moat & Momentum Rating</p>
                            </div>
                          </div>

                          <div className="conviction-pillars-grid">
                            <div className="pillar-item">
                              <div className="pillar-header">
                                <span><i className="fa-solid fa-tag"></i> Valuation</span>
                                <strong>{b.valuation} / 25</strong>
                              </div>
                              <div className="pillar-progress-track">
                                <div className="pillar-progress-bar val-bar" style={{ width: `${(b.valuation / 25) * 100}%` }}></div>
                              </div>
                            </div>

                            <div className="pillar-item">
                              <div className="pillar-header">
                                <span><i className="fa-solid fa-shield-heart"></i> Quality &amp; Safety</span>
                                <strong>{b.quality} / 35</strong>
                              </div>
                              <div className="pillar-progress-track">
                                <div className="pillar-progress-bar qual-bar" style={{ width: `${(b.quality / 35) * 100}%` }}></div>
                              </div>
                            </div>

                            <div className="pillar-item">
                              <div className="pillar-header">
                                <span><i className="fa-solid fa-fort-awesome"></i> Moat</span>
                                <strong>{b.moat} / 15</strong>
                              </div>
                              <div className="pillar-progress-track">
                                <div className="pillar-progress-bar moat-bar" style={{ width: `${(b.moat / 15) * 100}%` }}></div>
                              </div>
                            </div>

                            <div className="pillar-item">
                              <div className="pillar-header">
                                <span><i className="fa-solid fa-gauge-high"></i> Momentum</span>
                                <strong>{b.momentum} / 25</strong>
                              </div>
                              <div className="pillar-progress-track">
                                <div className="pillar-progress-bar mom-bar" style={{ width: `${(b.momentum / 25) * 100}%` }}></div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Automated Bull vs. Bear Thesis Card */}
                        {thesis && (
                          <div className="thesis-card">
                            <div className="thesis-header">
                              <i className="fa-solid fa-brain" style={{ color: '#818cf8' }}></i>
                              <h4>Executive Investment Thesis &amp; Catalyst Breakdown</h4>
                            </div>
                            <div className="thesis-summary-box">
                              <p><strong>Conviction Verdict:</strong> {thesis.summary}</p>
                            </div>
                            <div className="bull-bear-grid">
                              <div className="bull-card">
                                <h5><i className="fa-solid fa-arrow-trend-up text-pos"></i> Key Bull Catalysts</h5>
                                <ul>
                                  {thesis.bullPoints.map((pt, i) => (
                                    <li key={i}>{pt}</li>
                                  ))}
                                </ul>
                              </div>
                              <div className="bear-card">
                                <h5><i className="fa-solid fa-triangle-exclamation text-neg"></i> Key Bear Risks</h5>
                                <ul>
                                  {thesis.bearPoints.map((pt, i) => (
                                    <li key={i}>{pt}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  <div className="modal-grid">
                    {getDetailGroups(selectedStock).map((group, gIdx) => (
                      <div className="modal-group-card" key={gIdx}>
                        <h3>
                          <i className={group.icon}></i> {group.title}
                        </h3>
                        {group.items.map((row, rIdx) => (
                          <div className="modal-row" key={rIdx}>
                            <span className="modal-key">{row.key}</span>
                            {row.badge ? (
                              <span className={`score-badge ${row.badge}`}>
                                {row.value}
                              </span>
                            ) : (
                              <span className={`modal-val ${row.class || ''}`}>
                                {row.value}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* TAB 3: Interactive TradingView Chart */}
              {activeStockTab === 'chart' && (
                <div className="tv-chart-container">
                  <iframe
                    src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(selectedStock['TV Symbol'] || `NASDAQ:${selectedStock.Ticker}`)}&interval=D&symboledit=1&saveimage=1&toolbarbg=1e293b&studies=%5B%22RSI%40tv-basicstudies%22%2C%22MASimple%40tv-basicstudies%22%5D&theme=dark&style=1&timezone=exchange`}
                    className="tv-chart-iframe"
                    title={`TradingView Chart for ${selectedStock.Ticker}`}
                  />
                </div>
              )}

              {/* TAB 4: Live News & Catalysts */}
              {activeStockTab === 'news' && (
                newsLoading ? (
                  <div className="loader-wrapper" style={{ minHeight: '140px' }}>
                    <div className="spinner" style={{ width: '1.75rem', height: '1.75rem' }}></div>
                    <p style={{ fontSize: '0.875rem' }}>Fetching live breaking headlines...</p>
                  </div>
                ) : newsData.length === 0 ? (
                  <div className="empty-state" style={{ padding: '2rem' }}>
                    <i className="fa-solid fa-newspaper"></i>
                    <p>No recent news headlines found for {selectedStock.Ticker}.</p>
                  </div>
                ) : (
                  <div className="news-list">
                    {newsData.map((article, idx) => (
                      <div className="news-card" key={idx}>
                        <div className="news-card-header">
                          <span className="news-source-badge">{article.source}</span>
                          <span className="news-time"><i className="fa-regular fa-clock"></i> {article.time_ago}</span>
                        </div>
                        <a
                          href={article.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="news-title-link"
                        >
                          {article.title}
                          <i className="fa-solid fa-arrow-up-right-from-square news-ext-icon"></i>
                        </a>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            <div className="modal-footer">
              {overviewData?.meta?.website && (
                <a
                  href={overviewData.meta.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                >
                  <i className="fa-solid fa-globe"></i> Website
                </a>
              )}
              <a
                href={`https://www.gurufocus.com/stock/${selectedStock.Ticker}/summary`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                <i className="fa-solid fa-arrow-up-right-from-square"></i> GuruFocus
              </a>
              <a
                href={`https://finviz.com/quote.ashx?t=${selectedStock.Ticker.replace('.', '-')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                <i className="fa-solid fa-arrow-up-right-from-square"></i> Finviz
              </a>
              <a
                href={`https://www.tradingview.com/symbols/${selectedStock.Ticker}/news/`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                <i className="fa-solid fa-arrow-up-right-from-square"></i> TradingView
              </a>
              <button
                className="btn btn-danger"
                onClick={() => setDeleteConfirmStock(selectedStock)}
                style={{ marginRight: 'auto' }}
              >
                <i className="fa-solid fa-trash-can"></i> Remove
              </button>
              <button className="btn btn-primary" onClick={() => setSelectedStock(null)}>
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Add Ticker Modal */}
      {isAddOpen && (() => {
        // Detect bulk mode live from input
        const raw = newTickerSymbol.trim();
        const isBulkMode = raw.includes(',') || raw.includes(';');
        const bulkCount = isBulkMode
          ? raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean).length
          : 0;

        return (
          <div className="modal-overlay" onClick={() => !isAdding && setIsAddOpen(false)}>
            <div className="modal-container add-ticker-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title-desc">
                  <h2>
                    {isBulkMode
                      ? <><i className="fa-solid fa-layer-group"></i> Bulk Add Tickers</>
                      : <><i className="fa-solid fa-plus-circle"></i> Add Stock Ticker</>}
                  </h2>
                  <p>
                    {isBulkMode
                      ? `${bulkCount} symbol${bulkCount !== 1 ? 's' : ''} detected — duplicates will be skipped automatically`
                      : 'Enter one or more comma-separated ticker symbols'}
                  </p>
                </div>
                <button className="modal-close-btn" onClick={() => !isAdding && setIsAddOpen(false)} disabled={isAdding}>
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>

              <form onSubmit={handleAddTicker}>
                <div className="modal-body">
                  {addError && (
                    <div className="score-badge low" style={{ display: 'block', marginBottom: '1rem', whiteSpace: 'normal', padding: '0.625rem 1rem' }}>
                      <i className="fa-solid fa-circle-exclamation"></i> {addError}
                    </div>
                  )}

                  <div style={{
                    background: 'rgba(59, 130, 246, 0.08)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    borderRadius: '8px',
                    padding: '0.75rem 1rem',
                    marginBottom: '1rem',
                    fontSize: '0.8rem',
                    lineHeight: 1.5,
                    color: 'var(--text-secondary)'
                  }}>
                    <div style={{ fontWeight: 600, color: '#60a5fa', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <i className="fa-solid fa-cloud-arrow-up"></i> Live Market Lookup &amp; GuruFocus Notice
                    </div>
                    <div>
                      Adding tickers retrieves real-time prices, ratios &amp; analyst targets directly from TradingView.
                      <strong>GuruFocus metrics</strong> (GF Value, F-Score, Z-Score, WACC) require server-side Python scraping via GitHub Actions cloud workflow or <code>./start.sh</code>.
                    </div>
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <label className="form-label" style={{ margin: 0 }} htmlFor="symbol-input">
                        Ticker Symbol{isBulkMode ? 's' : ''}
                      </label>
                      {isBulkMode && (
                        <span className="bulk-count-badge">
                          <i className="fa-solid fa-layer-group"></i> {bulkCount} symbols
                        </span>
                      )}
                    </div>
                    <textarea
                      id="symbol-input"
                      className="form-input"
                      style={{ resize: 'vertical', minHeight: '3.5rem', fontFamily: 'monospace', fontSize: '0.9rem', letterSpacing: '0.03em' }}
                      placeholder={isBulkMode
                        ? `e.g.  AAPL, MSFT, GOOGL, NVDA, AMZN...`
                        : `e.g.  AAPL   or   AAPL, MSFT, GOOGL`}
                      value={newTickerSymbol}
                      onChange={(e) => setNewTickerSymbol(e.target.value)}
                      disabled={isAdding}
                      autoFocus
                    />
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                      <i className="fa-solid fa-circle-info"></i>&nbsp;
                      Separate multiple tickers with <strong>commas</strong>. Duplicates are skipped automatically.
                    </p>
                  </div>

                  {isAdding && (
                    <div className="loader-wrapper p-2 gap-2">
                      <div className="spinner" style={{ width: '1.5rem', height: '1.5rem' }}></div>
                      <p style={{ fontSize: '0.875rem' }}>
                        {isBulkMode
                          ? `Resolving ${bulkCount} symbols from Finviz in parallel…`
                          : 'Looking up symbol on Finviz…'}
                      </p>
                    </div>
                  )}
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsAddOpen(false)}
                    disabled={isAdding}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isAdding || !newTickerSymbol.trim()}
                  >
                    {isBulkMode
                      ? <><i className="fa-solid fa-layer-group"></i> Add {bulkCount} Tickers</>
                      : <><i className="fa-solid fa-plus"></i> Add Stock</>}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}


      {/* Delete Confirmation Modal */}
      {deleteConfirmStock && (
        <div className="modal-overlay" onClick={() => !isDeleting && setDeleteConfirmStock(null)}>
          <div className="modal-container" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-desc">
                <h2>
                  <i className="fa-solid fa-trash-can" style={{ color: 'var(--danger)', marginRight: '0.5rem' }}></i>
                  Remove Ticker
                </h2>
                <p>Confirm ticker removal from your watchlist</p>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => !isDeleting && setDeleteConfirmStock(null)}
                disabled={isDeleting}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="modal-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', marginBottom: '1.25rem', border: '1px solid var(--border-color)' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)', fontSize: '1.25rem', flexShrink: 0 }}>
                  <i className="fa-solid fa-triangle-exclamation"></i>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                    {deleteConfirmStock.Ticker || deleteConfirmStock.symbol}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {deleteConfirmStock.Name || deleteConfirmStock.name || 'Stock Watchlist Item'}
                  </div>
                </div>
              </div>

              <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: '1.5', margin: '0 0 0.5rem 0' }}>
                Are you sure you want to remove <strong>{deleteConfirmStock.Ticker || deleteConfirmStock.symbol}</strong>?
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                This ticker and its cached metrics will be removed from your dashboard. You can re-add it anytime using the <strong>Add Ticker</strong> button.
              </p>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteConfirmStock(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteTicker}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> Removing...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-trash-can"></i> Remove Ticker
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Floating Multi-Stock Comparison Bar */}
      {selectedCompare.length > 0 && (
        <div className="compare-floating-bar">
          <div className="compare-bar-left">
            <span className="compare-count-badge">
              <i className="fa-solid fa-scale-balanced"></i> {selectedCompare.length}
            </span>
            <span>stock{selectedCompare.length !== 1 ? 's' : ''} selected for comparison</span>
          </div>
          <div className="compare-bar-actions">
            <button
              className="btn btn-primary"
              onClick={() => setIsCompareOpen(true)}
              disabled={selectedCompare.length < 2}
            >
              <i className="fa-solid fa-table-columns"></i> {selectedCompare.length < 2 ? 'Select 1 more stock' : 'Compare Side-by-Side'}
            </button>
            <button className="btn btn-secondary" onClick={() => setSelectedCompare([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Side-by-Side Multi-Stock Comparison Modal */}
      {isCompareOpen && (() => {
        const compareStockObjs = stocks.filter(s => selectedCompare.includes(s.Ticker));
        return (
          <div className="modal-overlay" onClick={() => setIsCompareOpen(false)}>
            <div className="modal-container compare-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title-desc">
                  <h2><i className="fa-solid fa-scale-balanced"></i> Multi-Stock Comparison Matrix</h2>
                  <p>Comparing {compareStockObjs.length} stocks side-by-side across fundamental quality, valuation, moat, and technical timing</p>
                </div>
                <button className="modal-close-btn" onClick={() => setIsCompareOpen(false)}>
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>

              <div className="modal-body" style={{ overflowX: 'auto' }}>
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th className="compare-metric-col">Metric</th>
                      {compareStockObjs.map(s => (
                        <th key={s.Ticker} className="compare-stock-col">
                          <div className="compare-header-stock">
                            <span className="ticker-badge">{s.Ticker}</span>
                            <span className="compare-stock-name">{s.Name}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Score & Conviction */}
                    <tr className="compare-section-row">
                      <td colSpan={compareStockObjs.length + 1}>
                        <i className="fa-solid fa-star"></i> Conviction &amp; Composite Score
                      </td>
                    </tr>
                    <tr>
                      <td className="compare-metric-name">Composite Score</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker}>
                          <div className={`score-pill ${getScoreClass(s['Composite Score'])}`}>
                            <span className="score-num">{s['Composite Score'] || '-'}</span>
                            <span className="score-denom">/100</span>
                          </div>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="compare-metric-name">Conviction Tier</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker} style={{ fontWeight: 600 }}>
                          {getConvictionTier(s['Composite Score'])}
                        </td>
                      ))}
                    </tr>

                    {/* Valuation */}
                    <tr className="compare-section-row">
                      <td colSpan={compareStockObjs.length + 1}>
                        <i className="fa-solid fa-tag"></i> Valuation &amp; Upside
                      </td>
                    </tr>
                    <tr>
                      <td className="compare-metric-name">Current Price</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker} style={{ fontWeight: 600 }}>${s.Price || '-'}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="compare-metric-name">GF Intrinsic Value</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker} className={getGFValuationColorClass(s['GF Valuation'])}>
                          ${s['GF Value'] || '-'}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="compare-metric-name">GF Valuation Status</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker}>
                          <span className={`score-badge ${getGFValuationClass(s['GF Valuation'])}`}>
                            {s['GF Valuation'] || '-'}
                          </span>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="compare-metric-name">12M Analyst Target</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker}>
                          {s['Analyst Target'] ? (
                            <div>
                              <span>${s['Analyst Target']}</span>{' '}
                              <span className={`target-upside ${String(s['Target Upside %'] || '').startsWith('-') ? 'value-neg' : 'value-pos'}`}>
                                {s['Target Upside %']}
                              </span>
                            </div>
                          ) : '-'}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="compare-metric-name">P/E Ratio</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker}>{s['P/E'] || '-'}</td>
                      ))}
                    </tr>

                    {/* Financial Safety & Moat */}
                    <tr className="compare-section-row">
                      <td colSpan={compareStockObjs.length + 1}>
                        <i className="fa-solid fa-shield-halved"></i> Quality, Health &amp; Moat
                      </td>
                    </tr>
                    <tr>
                      <td className="compare-metric-name">Piotroski F-Score</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker}>
                          <span className={`score-badge ${getFScoreClass(s['Piotroski F-Score'])}`}>
                            {s['Piotroski F-Score'] || '-'}
                          </span>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="compare-metric-name">Altman Z-Score</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker}>
                          <span className={`score-badge ${getZScoreClass(s['Altman Z-Score'])}`}>
                            {s['Altman Z-Score'] || '-'}
                          </span>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="compare-metric-name">Debt / Equity</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker}>{s['Debt/Eq'] || '-'}</td>
                      ))}
                    </tr>

                    {/* Momentum */}
                    <tr className="compare-section-row">
                      <td colSpan={compareStockObjs.length + 1}>
                        <i className="fa-solid fa-gauge-high"></i> Momentum &amp; Timing
                      </td>
                    </tr>
                    <tr>
                      <td className="compare-metric-name">TV Technical Rating</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker}>
                          <span className={`score-badge ${getTVTechnicalClass(s['TV Technical'])}`}>
                            {s['TV Technical'] || '-'}
                          </span>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="compare-metric-name">14-Day RSI</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker}>{s['TV RSI'] || '-'}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="compare-metric-name">Change %</td>
                      {compareStockObjs.map(s => (
                        <td key={s.Ticker} className={String(s['Change %'] || '').startsWith('-') ? 'value-neg' : 'value-pos'}>
                          {s['Change %'] || '-'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setSelectedCompare([])}>
                  Clear All
                </button>
                <button className="btn btn-primary" onClick={() => setIsCompareOpen(false)}>
                  Close Matrix
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Phase 4: Portfolio Conviction Allocator Modal */}
      {isAllocatorOpen && (() => {
        // Filter candidate stocks by score
        let candidates = stocks.filter(s => {
          const score = parseFloat(s['Composite Score'] || '0');
          const price = parseNumber(s.Price);
          return score >= allocatorMinScore && price && price > 0;
        });

        if (allocatorStrategy === 'undervalued') {
          candidates = candidates.filter(s => s['GF Valuation'] && s['GF Valuation'].includes('Undervalued'));
        }

        // Calculate weighting
        let totalWeight = 0;
        candidates.forEach(s => {
          const score = parseFloat(s['Composite Score'] || '50');
          const weight = allocatorStrategy === 'equal' ? 1 : (score * score); // Squared for higher conviction weighting
          s._weight = weight;
          totalWeight += weight;
        });

        const allocations = candidates.map(s => {
          const weightPct = totalWeight > 0 ? (s._weight / totalWeight) : 0;
          const targetDollars = allocatorCapital * weightPct;
          const price = parseNumber(s.Price) || 1;
          const targetShares = Math.floor(targetDollars / price);
          const actualDollars = targetShares * price;
          return {
            ...s,
            weightPct: (weightPct * 100).toFixed(1),
            targetDollars: targetDollars.toFixed(0),
            targetShares,
            actualDollars: actualDollars.toFixed(0)
          };
        }).sort((a, b) => parseFloat(b.weightPct) - parseFloat(a.weightPct));

        const totalAllocatedActual = allocations.reduce((acc, a) => acc + parseFloat(a.actualDollars), 0);

        return (
          <div className="modal-overlay" onClick={() => setIsAllocatorOpen(false)}>
            <div className="modal-container allocator-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title-desc">
                  <h2><i className="fa-solid fa-wallet" style={{ color: '#818cf8' }}></i> Portfolio Conviction Allocator</h2>
                  <p>Risk-adjusted position sizing algorithm weighted by multi-factor 4-pillar conviction scores</p>
                </div>
                <button className="modal-close-btn" onClick={() => setIsAllocatorOpen(false)}>
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>

              <div className="modal-body">
                {/* Control Ribbon */}
                <div className="allocator-controls">
                  <div className="allocator-input-group">
                    <label><i className="fa-solid fa-dollar-sign"></i> Target Capital:</label>
                    <input
                      type="number"
                      min="1000"
                      step="1000"
                      className="allocator-input"
                      value={allocatorCapital}
                      onChange={(e) => setAllocatorCapital(Math.max(100, parseFloat(e.target.value) || 0))}
                    />
                  </div>

                  <div className="allocator-input-group">
                    <label><i className="fa-solid fa-sliders"></i> Min Score Threshold: <strong>{allocatorMinScore}+</strong></label>
                    <input
                      type="range"
                      min="50"
                      max="85"
                      step="5"
                      className="allocator-slider"
                      value={allocatorMinScore}
                      onChange={(e) => setAllocatorMinScore(parseInt(e.target.value))}
                    />
                  </div>

                  <div className="allocator-input-group">
                    <label><i className="fa-solid fa-layer-group"></i> Strategy:</label>
                    <select
                      className="filter-select"
                      value={allocatorStrategy}
                      onChange={(e) => setAllocatorStrategy(e.target.value)}
                    >
                      <option value="conviction">Score-Weighted (Conviction Sizing)</option>
                      <option value="undervalued">Undervalued-First Compounders</option>
                      <option value="equal">Equal-Weight Top Tier</option>
                    </select>
                  </div>
                </div>

                {/* Summary Stat Cards */}
                <div className="allocator-stats-grid">
                  <div className="allocator-stat-card">
                    <span className="stat-card-label">Allocated Capital</span>
                    <strong className="stat-card-val">${totalAllocatedActual.toLocaleString()} <small>/ ${allocatorCapital.toLocaleString()}</small></strong>
                  </div>
                  <div className="allocator-stat-card">
                    <span className="stat-card-label">Positions Selected</span>
                    <strong className="stat-card-val">{allocations.length} Stocks</strong>
                  </div>
                  <div className="allocator-stat-card">
                    <span className="stat-card-label">Avg. Conviction Score</span>
                    <strong className="stat-card-val highlight-green">
                      {allocations.length > 0 ? (allocations.reduce((acc, a) => acc + parseFloat(a['Composite Score'] || '0'), 0) / allocations.length).toFixed(1) : '-'} / 100
                    </strong>
                  </div>
                </div>

                {/* Allocation Table */}
                <div className="table-wrapper" style={{ maxHeight: '42vh' }}>
                  {allocations.length === 0 ? (
                    <div className="empty-state" style={{ padding: '2rem' }}>
                      <p>No stocks meet the current score threshold ({allocatorMinScore}+). Lower the threshold to generate an allocation.</p>
                    </div>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Ticker</th>
                          <th>Company Name</th>
                          <th>Price</th>
                          <th>Score</th>
                          <th>Weight %</th>
                          <th>Target Allocation</th>
                          <th>Target Shares</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allocations.map(a => (
                          <tr key={a.Ticker}>
                            <td><span className="ticker-badge">{a.Ticker}</span></td>
                            <td>{a.Name}</td>
                            <td>${a.Price}</td>
                            <td>
                              <div className={`score-pill ${getScoreClass(a['Composite Score'])}`}>
                                <span className="score-num">{a['Composite Score']}</span>
                                <span className="score-denom">/100</span>
                              </div>
                            </td>
                            <td><strong style={{ color: '#818cf8' }}>{a.weightPct}%</strong></td>
                            <td>${parseFloat(a.actualDollars).toLocaleString()}</td>
                            <td><strong style={{ color: '#34d399' }}>{a.targetShares} shares</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    const csv = ['Ticker,Name,Price,Score,WeightPct,TargetDollars,TargetShares'];
                    allocations.forEach(a => {
                      csv.push(`${a.Ticker},"${a.Name}",${a.Price},${a['Composite Score']},${a.weightPct}%,$${a.actualDollars},${a.targetShares}`);
                    });
                    const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `Portfolio_Allocation_Plan_${new Date().toISOString().slice(0, 10)}.csv`;
                    link.click();
                    addToast('Allocation plan exported to CSV!', 'success');
                  }}
                  disabled={allocations.length === 0}
                >
                  <i className="fa-solid fa-file-arrow-down"></i> Export Allocation Plan (CSV)
                </button>
                <button className="btn btn-primary" onClick={() => setIsAllocatorOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
