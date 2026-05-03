'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────
interface Quote {
  symbol: string; shortName?: string; longName?: string;
  regularMarketPrice: number; regularMarketChange: number;
  regularMarketChangePercent: number; regularMarketVolume: number;
  regularMarketDayHigh: number; regularMarketDayLow: number;
  fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number;
  currency?: string; marketState?: string;
}
interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface Indicators {
  sma5: string; sma20: string; rsi14: string; macd: string;
  macdSignal: string; macdHist: string; kdK: string; kdD: string;
  volatility: string; maxDrawdown: string; volRatio: string; distSma20: string;
  intraRange: string; weekRange: string;
}
interface NewsItem { title: string; link: string; publisher?: string; providerPublishTime?: number; }
interface Financials {
  marketCap: string; trailingPE: string; forwardPE: string; eps: string;
  revenue: string; revenueGrowth: string; grossMargin: string; profitMargin: string;
  roe: string; roa: string; debtToEquity: string; currentRatio: string;
  priceToBook: string; dividendYield: string; beta: string; shortRatio: string;
}

// ── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_WATCHLIST = ['2330.TW', '0050.TW', '2454.TW', '0056.TW', 'AAPL', 'NVDA', 'TSM', 'MSFT'];
const TW_NAMES: Record<string, string> = {
  '2330': '台積電', '0050': '元大台灣50', '2454': '聯發科', '0056': '元大高股息',
  '2317': '鴻海', '2308': '台達電', '2382': '廣達', '2881': '富邦金',
  '2882': '國泰金', '2891': '中信金', '3008': '大立光', '2412': '中華電',
  '00918': '國泰永續高股息', '00919': '群益台灣精選高息',
};
const INDICATOR_DEFS = [
  { key: 'sma5', label: 'SMA 5' }, { key: 'sma20', label: 'SMA 20' },
  { key: 'rsi14', label: 'RSI 14' }, { key: 'macd', label: 'MACD' },
  { key: 'macdSignal', label: 'MACD 訊號' }, { key: 'macdHist', label: 'MACD 柱' },
  { key: 'kdK', label: 'KD K' }, { key: 'kdD', label: 'KD D' },
  { key: 'volatility', label: '年化波動' }, { key: 'maxDrawdown', label: '最大回撤' },
  { key: 'volRatio', label: '量比' }, { key: 'distSma20', label: '距 SMA20' },
  { key: 'intraRange', label: '日內區間' }, { key: 'weekRange', label: '52 週區間' },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────
const isTW = (s: string) => s.endsWith('.TW') || s.endsWith('.TWO');
const base = (s: string) => s.replace(/\.(TW|TWO)$/, '');
const displayName = (q: Quote) => TW_NAMES[base(q.symbol)] || q.shortName || q.symbol;
const fmtPrice = (n: number) => n >= 100 ? n.toFixed(2) : n.toFixed(3);
const fmtVol = (n: number) => n >= 1e8 ? `${(n / 1e8).toFixed(1)}億` : n >= 1e4 ? `${Math.round(n / 1e4)}萬` : n.toLocaleString();
const fmtHMil = (n: number) => { const v = n / 1e8; return v >= 1 ? `${v.toFixed(1)}億` : `${(n / 1e4).toFixed(0)}萬`; };

// ── Sparkline ─────────────────────────────────────────────────────────────
function Sparkline({ candles, positive }: { candles: Candle[]; positive: boolean }) {
  const closes = candles.map(c => c.close).filter(Boolean);
  if (closes.length < 2) return <div className="w-16 h-6" />;
  const min = Math.min(...closes), max = Math.max(...closes), r = max - min || 1;
  const W = 64, H = 24, P = 2;
  const pts = closes.map((v, i) => `${P + (i / (closes.length - 1)) * (W - P * 2)},${P + (1 - (v - min) / r) * (H - P * 2)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-16 h-6">
      <polyline points={pts} fill="none" stroke={positive ? '#22c55e' : '#ef4444'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── TradingView Chart ─────────────────────────────────────────────────────
function TradingViewChart({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSym = symbol.endsWith('.TWO')
    ? `TPEX:${symbol.replace('.TWO', '')}`
    : symbol.endsWith('.TW')
    ? `TWSE:${symbol.replace('.TW', '')}`
    : symbol;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = '';
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';
    el.appendChild(widget);
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSym,
      interval: 'D',
      timezone: 'Asia/Taipei',
      theme: 'dark',
      style: '1',
      locale: 'zh_TW',
      allow_symbol_change: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    });
    el.appendChild(script);
    return () => { if (el) el.innerHTML = ''; };
  }, [tvSym]);

  return <div className="tradingview-widget-container w-full" ref={containerRef} style={{ height: 460 }} />;
}

// ── TradingView Technical Analysis ────────────────────────────────────────
function TradingViewAnalysis({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSym = symbol.endsWith('.TWO')
    ? `TPEX:${symbol.replace('.TWO', '')}`
    : symbol.endsWith('.TW')
    ? `TWSE:${symbol.replace('.TW', '')}`
    : symbol;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = '';
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      interval: '1D',
      width: '100%',
      isTransparent: true,
      height: 380,
      symbol: tvSym,
      showIntervalTabs: true,
      displayMode: 'single',
      locale: 'zh_TW',
      colorTheme: 'dark',
    });
    el.appendChild(script);
    return () => { if (el) el.innerHTML = ''; };
  }, [tvSym]);

  return <div className="tradingview-widget-container" ref={containerRef} style={{ minHeight: 380 }} />;
}

// ── Indicator Card ────────────────────────────────────────────────────────
function IndicatorCard({ label, value }: { label: string; value: string }) {
  const isNeg = value.startsWith('-') && !label.includes('區間');
  const isPos = !isNeg && value.startsWith('+');
  const isRSI = label === 'RSI 14';
  const rsiNum = isRSI ? parseFloat(value) : 0;
  const color = (label === '最大回撤' || isNeg) ? 'text-red-400' : isPos || (isRSI && rsiNum > 55) ? 'text-green-400' : 'text-white';
  return (
    <div className="bg-gray-800/50 border border-gray-700/40 rounded-lg px-3 py-2.5 min-w-0">
      <div className="text-[10px] text-gray-500 mb-1 truncate">{label}</div>
      <div className={`text-sm font-semibold truncate ${color}`}>{value}</div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function StocksPage() {
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [sparklines, setSparklines] = useState<Record<string, Candle[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [financials, setFinancials] = useState<Financials | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [market, setMarket] = useState<'all' | 'tw' | 'us'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [indicLoading, setIndicLoading] = useState(false);
  const [finLoading, setFinLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('stock_watchlist');
    if (saved) { try { setWatchlist(JSON.parse(saved)); } catch { /* ignore */ } }
  }, []);

  const saveWatchlist = useCallback((list: string[]) => {
    setWatchlist(list); localStorage.setItem('stock_watchlist', JSON.stringify(list));
  }, []);

  const fetchQuotes = useCallback(async (list: string[]) => {
    if (!list.length) return;
    try {
      const res = await fetch(`/api/stocks?symbols=${list.join(',')}`);
      const data: Quote[] = await res.json();
      if (Array.isArray(data)) {
        setQuotes(prev => { const next = { ...prev }; data.forEach(q => { next[q.symbol] = q; }); return next; });
        setLastUpdate(new Date());
      }
    } catch { /* ignore */ }
  }, []);

  const fetchSparklines = useCallback(async (list: string[]) => {
    await Promise.allSettled(list.map(async symbol => {
      try {
        const res = await fetch(`/api/stocks/history?symbol=${symbol}&range=1mo&interval=1d`);
        const data = await res.json();
        if (data.candles?.length) setSparklines(prev => ({ ...prev, [symbol]: data.candles }));
      } catch { /* ignore */ }
    }));
  }, []);

  const fetchIndicators = useCallback(async (symbol: string) => {
    setIndicLoading(true); setIndicators(null);
    try {
      const res = await fetch(`/api/stocks/indicators?symbol=${symbol}`);
      const data = await res.json();
      if (!data.error) setIndicators(data);
    } catch { /* ignore */ }
    finally { setIndicLoading(false); }
  }, []);

  const fetchNews = useCallback(async (symbol: string) => {
    setNews([]);
    try {
      const res = await fetch(`/api/stocks/news?symbol=${symbol}`);
      const data = await res.json();
      setNews(Array.isArray(data) ? data.slice(0, 5) : []);
    } catch { /* ignore */ }
  }, []);

  const fetchFinancials = useCallback(async (symbol: string) => {
    setFinLoading(true); setFinancials(null);
    try {
      const res = await fetch(`/api/stocks/financials?symbol=${symbol}`);
      const data = await res.json();
      if (!data.error) setFinancials(data);
    } catch { /* ignore */ }
    finally { setFinLoading(false); }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchQuotes(watchlist).finally(() => setLoading(false));
    fetchSparklines(watchlist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => fetchQuotes(watchlist), 60_000);
    return () => clearInterval(id);
  }, [watchlist, fetchQuotes]);

  useEffect(() => {
    if (!selected) return;
    fetchIndicators(selected);
    fetchFinancials(selected);
    fetchNews(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const addStock = (raw: string) => {
    const sym = /^\d{4,5}$/.test(raw.toUpperCase()) ? `${raw.toUpperCase()}.TW` : raw.toUpperCase();
    if (sym && !watchlist.includes(sym)) {
      const next = [...watchlist, sym];
      saveWatchlist(next);
      fetchQuotes([sym]); fetchSparklines([sym]);
      if (!selected) setSelected(sym);
    }
    setSearchInput('');
  };

  const removeStock = (symbol: string) => {
    saveWatchlist(watchlist.filter(s => s !== symbol));
    if (selected === symbol) setSelected(watchlist.find(s => s !== symbol) ?? null);
  };

  const filtered = watchlist.filter(s => market === 'tw' ? isTW(s) : market === 'us' ? !isTW(s) : true);
  const selectedQuote = selected ? quotes[selected] : null;
  const selPos = selectedQuote ? selectedQuote.regularMarketChangePercent >= 0 : true;

  // Market breadth from current quotes
  const breadthQuotes = Object.values(quotes).filter(q => filtered.includes(q.symbol));
  const upCount = breadthQuotes.filter(q => q.regularMarketChangePercent > 0).length;
  const downCount = breadthQuotes.filter(q => q.regularMarketChangePercent < 0).length;
  const avgChange = breadthQuotes.length
    ? breadthQuotes.reduce((s, q) => s + q.regularMarketChangePercent, 0) / breadthQuotes.length
    : 0;

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      {/* ── Header ── */}
      <header className="border-b border-gray-800/60 sticky top-0 z-50 bg-[#0d1117]/95 backdrop-blur">
        <div className="max-w-screen-2xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-base font-bold">股市分析</h1>
              <p className="text-[10px] text-gray-600">追蹤自選股、檢視技術指標、並把結構化即時快照交給 AI 分析。</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(['all', 'tw', 'us'] as const).map(m => (
              <button key={m} onClick={() => setMarket(m)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${market === m ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {m === 'all' ? '全部' : m === 'tw' ? '台股' : '美股'}
              </button>
            ))}
            <button onClick={() => { fetchQuotes(watchlist); fetchSparklines(watchlist); }}
              className="flex items-center gap-1.5 px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400 hover:text-white transition-colors border border-gray-700">
              ↻ 刷新
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-screen-2xl mx-auto px-5 py-4 space-y-4">

        {/* ── Top 4 Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">

          {/* Card 1: Search */}
          <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4">
            <div className="text-[10px] text-gray-500 mb-2">自選股搜尋</div>
            <h3 className="text-sm font-semibold text-gray-200 mb-3">加入台股或美股</h3>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">🔍</span>
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="2330、AAPL、TSM..."
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchInput.trim() && addStock(searchInput.trim())}
                  className="w-full pl-7 pr-3 py-1.5 bg-gray-800 border border-gray-600 rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <button onClick={() => searchInput.trim() && addStock(searchInput.trim())}
                className="w-7 h-7 rounded-lg bg-blue-600 hover:bg-blue-500 flex items-center justify-center text-white font-bold text-sm transition-colors">+</button>
            </div>
            <p className="text-[10px] text-gray-600 mt-2">可搜尋代號或公司名稱。台股數字代號會自動轉成 .TW。</p>
          </div>

          {/* Card 2: Currently selected */}
          <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4">
            <div className="text-[10px] text-gray-500 mb-1">目前選取</div>
            {selectedQuote ? (
              <>
                <div className="text-xs text-gray-400 truncate mb-0.5">{displayName(selectedQuote)} · {base(selectedQuote.symbol)}</div>
                <div className="text-2xl font-bold tracking-tight">
                  {selectedQuote.currency ?? ''} {fmtPrice(selectedQuote.regularMarketPrice)}
                </div>
                <div className={`flex items-center gap-1.5 mt-1 text-sm font-medium ${selPos ? 'text-green-400' : 'text-red-400'}`}>
                  <span>{selPos ? '▲' : '▼'}</span>
                  <span>{Math.abs(selectedQuote.regularMarketChange).toFixed(2)}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${selPos ? 'bg-green-500/15' : 'bg-red-500/15'}`}>
                    {selPos ? '+' : ''}{selectedQuote.regularMarketChangePercent.toFixed(2)}%
                  </span>
                </div>
                <div className="text-[10px] text-gray-600 mt-1.5">
                  Yahoo Finance · {lastUpdate?.toLocaleDateString('zh-TW')} {lastUpdate?.toLocaleTimeString('zh-TW')}
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-600 mt-3">點擊下方表格選取股票</div>
            )}
          </div>

          {/* Card 3: Market breadth */}
          <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4">
            <div className="text-[10px] text-gray-500 mb-1">市場廣度</div>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">自選股脈動</h3>
            {breadthQuotes.length > 0 ? (
              <div className="flex items-end gap-3">
                <div className="text-center">
                  <div className="text-[10px] text-gray-500 mb-1">上漲</div>
                  <div className="text-2xl font-bold text-green-400">{upCount}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-gray-500 mb-1">下跌</div>
                  <div className="text-2xl font-bold text-red-400">{downCount}</div>
                </div>
                <div className="text-center ml-auto">
                  <div className="text-[10px] text-gray-500 mb-1">平均</div>
                  <div className={`text-xl font-bold ${avgChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600">載入中…</div>
            )}
          </div>

          {/* Card 4: Info */}
          <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4">
            <div className="text-[10px] text-gray-500 mb-1">資料說明</div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2">📊 分析看板</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              把即時行情、技術指標、自選股整整理成結構化快照，方便 AI 輔助分析。
            </p>
            {lastUpdate && (
              <div className="mt-3 text-[10px] text-gray-600">
                最後更新：{lastUpdate.toLocaleTimeString('zh-TW')} · 60秒自動刷新
              </div>
            )}
          </div>
        </div>

        {/* ── Chart + Volume + Table ── */}
        <div className="space-y-3">

          {/* Chart section (only when selected) */}
          {selected && (
            <div className="space-y-3">

              {/* Main chart + right panel */}
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-3">

                {/* TradingView K-Line chart */}
                <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4">
                  <div className="text-xs text-gray-500 mb-2">
                    K 線趨勢 &nbsp;·&nbsp;
                    <span className="text-gray-300 font-semibold">{base(selected)}</span>
                    {selectedQuote && <span className="ml-2 text-gray-400">{selectedQuote.currency} {fmtPrice(selectedQuote.regularMarketPrice)}</span>}
                  </div>
                  <TradingViewChart key={selected} symbol={selected} />
                </div>

                {/* Right: Technical Analysis + Stats + News */}
                <div className="space-y-3">

                  {/* TradingView Technical Analysis */}
                  <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-3 overflow-hidden">
                    <div className="text-[10px] text-gray-500 mb-1">技術分析評分</div>
                    <TradingViewAnalysis key={selected} symbol={selected} />
                  </div>

                  {/* Quick stats */}
                  {selectedQuote && (
                    <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4 grid grid-cols-2 gap-3">
                      {[
                        ['收盤', fmtPrice(selectedQuote.regularMarketPrice)],
                        ['成交量', fmtVol(selectedQuote.regularMarketVolume)],
                        ['今日最高', fmtPrice(selectedQuote.regularMarketDayHigh)],
                        ['今日最低', fmtPrice(selectedQuote.regularMarketDayLow)],
                        ['52W 最高', selectedQuote.fiftyTwoWeekHigh ? fmtPrice(selectedQuote.fiftyTwoWeekHigh) : '-'],
                        ['52W 最低', selectedQuote.fiftyTwoWeekLow ? fmtPrice(selectedQuote.fiftyTwoWeekLow) : '-'],
                      ].map(([label, val]) => (
                        <div key={label}>
                          <div className="text-[10px] text-gray-600">{label}</div>
                          <div className="text-sm font-semibold text-gray-200">{val}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* News */}
                  {news.length > 0 && (
                    <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4">
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">相關新聞</div>
                      <div className="space-y-2.5">
                        {news.map((item, i) => (
                          <a key={i} href={item.link} target="_blank" rel="noopener noreferrer" className="block group">
                            <p className="text-xs text-gray-400 group-hover:text-blue-400 transition-colors line-clamp-2 leading-snug">{item.title}</p>
                            <p className="text-[10px] text-gray-700 mt-0.5">{item.publisher}{item.providerPublishTime && <> · {new Date(item.providerPublishTime * 1000).toLocaleDateString('zh-TW')}</>}</p>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Financials panel */}
              <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4">
                <div className="text-xs font-semibold text-gray-400 mb-3">📋 財務數據</div>
                {finLoading ? (
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                    {Array.from({ length: 16 }).map((_, i) => (
                      <div key={i} className="bg-gray-800/50 rounded-lg px-3 py-2.5 animate-pulse">
                        <div className="h-2 bg-gray-700 rounded w-2/3 mb-2" /><div className="h-3 bg-gray-700 rounded" />
                      </div>
                    ))}
                  </div>
                ) : financials ? (
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                    {([
                      ['市值', financials.marketCap],
                      ['本益比', financials.trailingPE],
                      ['預期本益比', financials.forwardPE],
                      ['EPS', financials.eps],
                      ['營收', financials.revenue],
                      ['營收成長', financials.revenueGrowth],
                      ['毛利率', financials.grossMargin],
                      ['淨利率', financials.profitMargin],
                      ['ROE', financials.roe],
                      ['ROA', financials.roa],
                      ['負債/權益', financials.debtToEquity],
                      ['流動比率', financials.currentRatio],
                      ['股價淨值比', financials.priceToBook],
                      ['殖利率', financials.dividendYield],
                      ['Beta', financials.beta],
                      ['空頭比率', financials.shortRatio],
                    ] as [string, string][]).map(([label, val]) => (
                      <div key={label} className="bg-gray-800/50 border border-gray-700/40 rounded-lg px-3 py-2.5 min-w-0">
                        <div className="text-[10px] text-gray-500 mb-1 truncate">{label}</div>
                        <div className="text-sm font-semibold text-white truncate">{val}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-600">財務數據暫不可用</div>
                )}
              </div>

              {/* Technical indicator cards */}
              {(indicLoading || indicators) && (
                <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-gray-400 mb-3">📈 技術指標</div>
                  {indicLoading ? (
                    <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                      {Array.from({ length: 14 }).map((_, i) => (
                        <div key={i} className="bg-gray-800/50 rounded-lg px-3 py-2.5 animate-pulse">
                          <div className="h-2 bg-gray-700 rounded w-2/3 mb-2" /><div className="h-3 bg-gray-700 rounded" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                      {INDICATOR_DEFS.map(({ key, label }) => <IndicatorCard key={key} label={label} value={indicators![key]} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Watchlist Table ── */}
          <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300">自選股</h2>
              {lastUpdate && <span className="text-[10px] text-gray-600">更新 {lastUpdate.toLocaleTimeString('zh-TW')}</span>}
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-14"><div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-gray-600 border-b border-gray-800/60">
                      <th className="text-left px-5 py-2.5 font-medium">代號</th>
                      <th className="text-center px-3 py-2.5 font-medium">市場</th>
                      <th className="text-right px-4 py-2.5 font-medium">價格</th>
                      <th className="text-right px-4 py-2.5 font-medium">漲跌</th>
                      <th className="text-right px-4 py-2.5 font-medium hidden sm:table-cell">成交量</th>
                      <th className="text-right px-4 py-2.5 font-medium hidden md:table-cell">成交億</th>
                      <th className="text-center px-4 py-2.5 font-medium hidden lg:table-cell">走勢</th>
                      <th className="text-center px-3 py-2.5 font-medium hidden md:table-cell">來源</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/30">
                    {filtered.map(symbol => {
                      const q = quotes[symbol];
                      const isSelected = selected === symbol;
                      const pos = q ? q.regularMarketChangePercent >= 0 : true;
                      if (!q) return (
                        <tr key={symbol} className="animate-pulse">
                          <td className="px-5 py-3"><div className="h-4 bg-gray-800 rounded w-20" /></td>
                          <td className="px-3 py-3"><div className="h-4 bg-gray-800 rounded w-12 mx-auto" /></td>
                          <td className="px-4 py-3"><div className="h-4 bg-gray-800 rounded w-24 ml-auto" /></td>
                          <td className="px-4 py-3"><div className="h-4 bg-gray-800 rounded w-16 ml-auto" /></td>
                          <td colSpan={5} />
                        </tr>
                      );
                      return (
                        <tr key={symbol} onClick={() => setSelected(prev => prev === symbol ? null : symbol)}
                          className={`cursor-pointer transition-colors ${isSelected ? 'bg-blue-950/30 border-l-2 border-l-blue-500' : 'hover:bg-gray-800/30'}`}>
                          <td className="px-5 py-3">
                            <div className={`font-bold ${isSelected ? 'text-blue-300' : 'text-white'}`}>{base(symbol)}</div>
                            <div className="text-[11px] text-gray-600 truncate max-w-[130px]">{displayName(q)}</div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isTW(symbol) ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'}`}>
                              {isTW(symbol) ? '台股' : '美股'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-bold">{q.currency === 'TWD' ? 'TWD' : 'USD'} {fmtPrice(q.regularMarketPrice)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${pos ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                              {pos ? '+' : ''}{q.regularMarketChangePercent.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500 text-xs hidden sm:table-cell">{fmtVol(q.regularMarketVolume)}</td>
                          <td className="px-4 py-3 text-right text-gray-500 text-xs hidden md:table-cell">{fmtHMil(q.regularMarketVolume * q.regularMarketPrice)}</td>
                          <td className="px-4 py-3 hidden lg:table-cell"><Sparkline candles={sparklines[symbol] ?? []} positive={pos} /></td>
                          <td className="px-3 py-3 text-center hidden md:table-cell"><span className="text-[10px] text-gray-700">Yahoo Finance</span></td>
                          <td className="px-3 py-3 text-center">
                            <button onClick={e => { e.stopPropagation(); removeStock(symbol); }}
                              className="w-6 h-6 rounded hover:bg-red-900/40 text-gray-700 hover:text-red-500 transition-colors text-sm flex items-center justify-center">🗑</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length === 0 && <div className="text-center py-14 text-gray-600 text-sm">沒有股票，請用上方搜尋框新增</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
