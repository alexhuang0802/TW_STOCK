'use client';

import Link from 'next/link';
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

// ── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_WATCHLIST = ['2330.TW', '0050.TW', '2454.TW', '0056.TW', 'AAPL', 'NVDA', 'TSM', 'MSFT'];
const TW_NAMES: Record<string, string> = {
  '2330': '台積電', '0050': '元大台灣50', '2454': '聯發科', '0056': '元大高股息',
  '2317': '鴻海', '2308': '台達電', '2382': '廣達', '2881': '富邦金',
  '2882': '國泰金', '2891': '中信金', '3008': '大立光', '2412': '中華電',
  '00918': '國泰永續高股息', '00919': '群益台灣精選高息',
};
const RANGES = [
  { key: '1d', label: '1D' }, { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' }, { key: '6mo', label: '6M' }, { key: '1y', label: '1Y' },
];
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

// ── Candlestick Chart ─────────────────────────────────────────────────────
function CandlestickChart({ candles, currentPrice }: { candles: Candle[]; currentPrice?: number }) {
  const valid = candles.filter(c => c.open && c.close && c.high && c.low);
  if (valid.length < 3) return <div className="h-64 flex items-center justify-center text-gray-600 text-sm">圖表載入中…</div>;

  const W = 800, CH = 280, PAD_T = 12, PAD_R = 52, PAD_L = 4;
  const allPrices = valid.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...allPrices), maxP = Math.max(...allPrices), rangeP = maxP - minP || 1;
  const usableW = W - PAD_L - PAD_R;
  const slotW = usableW / valid.length;
  const bodyW = Math.max(2, slotW * 0.6);
  const mapX = (i: number) => PAD_L + (i + 0.5) * slotW;
  const mapY = (p: number) => PAD_T + (1 - (p - minP) / rangeP) * (CH - PAD_T * 2);

  const calcSMA = (period: number): (number | null)[] =>
    valid.map((_, i) => i < period - 1 ? null : valid.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0) / period);

  const buildPath = (vals: (number | null)[]) => {
    let d = '', started = false;
    vals.forEach((v, i) => { if (v == null) return; const x = mapX(i).toFixed(1), y = mapY(v).toFixed(1); d += started ? ` L${x},${y}` : `M${x},${y}`; started = true; });
    return d;
  };

  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(r => ({ y: mapY(minP + r * rangeP), val: (minP + r * rangeP) >= 100 ? (minP + r * rangeP).toFixed(0) : (minP + r * rangeP).toFixed(2) }));
  const step = Math.max(1, Math.floor(valid.length / 6));
  const xLabels = valid.filter((_, i) => i % step === 0 || i === valid.length - 1).map(c => {
    const i = valid.indexOf(c);
    return { x: mapX(i), label: new Date(c.time).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) };
  });

  return (
    <svg viewBox={`0 0 ${W} ${CH + 16}`} className="w-full" style={{ height: 300 }}>
      {yLabels.map((l, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={l.y} x2={W - PAD_R} y2={l.y} stroke="#1f2937" strokeWidth="0.8" />
          <text x={W - PAD_R + 4} y={l.y + 4} fontSize="9" fill="#6b7280">{l.val}</text>
        </g>
      ))}
      {valid.map((c, i) => {
        const isUp = c.close >= c.open; const color = isUp ? '#22c55e' : '#ef4444';
        const x = mapX(i); const bTop = mapY(Math.max(c.open, c.close)); const bBot = mapY(Math.min(c.open, c.close)); const bH = Math.max(1.5, bBot - bTop);
        return <g key={i}><line x1={x} y1={mapY(c.high)} x2={x} y2={mapY(c.low)} stroke={color} strokeWidth="1" /><rect x={(x - bodyW / 2).toFixed(1)} y={bTop.toFixed(1)} width={bodyW.toFixed(1)} height={bH.toFixed(1)} fill={color} /></g>;
      })}
      <path d={buildPath(calcSMA(5))} fill="none" stroke="#f59e0b" strokeWidth="1.5" />
      <path d={buildPath(calcSMA(20))} fill="none" stroke="#3b82f6" strokeWidth="2" />
      {currentPrice && <line x1={PAD_L} y1={mapY(currentPrice)} x2={W - PAD_R} y2={mapY(currentPrice)} stroke="#ffffff30" strokeWidth="0.8" strokeDasharray="4 3" />}
      <g>
        <rect x={PAD_L} y={PAD_T - 2} width={130} height={14} fill="#111827" />
        <line x1={PAD_L + 2} y1={PAD_T + 5} x2={PAD_L + 18} y2={PAD_T + 5} stroke="#f59e0b" strokeWidth="1.5" />
        <text x={PAD_L + 22} y={PAD_T + 9} fontSize="9" fill="#f59e0b">SMA5</text>
        <line x1={PAD_L + 55} y1={PAD_T + 5} x2={PAD_L + 71} y2={PAD_T + 5} stroke="#3b82f6" strokeWidth="2" />
        <text x={PAD_L + 75} y={PAD_T + 9} fontSize="9" fill="#3b82f6">SMA20</text>
      </g>
      {xLabels.map((l, i) => <text key={i} x={l.x} y={CH + 13} fontSize="8" fill="#6b7280" textAnchor="middle">{l.label}</text>)}
    </svg>
  );
}

// ── Volume Bar Chart ──────────────────────────────────────────────────────
function VolumeChart({ candles }: { candles: Candle[] }) {
  const valid = candles.filter(c => c.volume > 0).slice(-30);
  if (!valid.length) return <div className="h-48 flex items-center justify-center text-gray-600 text-sm">無資料</div>;
  const maxVol = Math.max(...valid.map(c => c.volume));
  const W = 200, H = 180, PAD_B = 20, PAD_T = 8, PAD_L = 4, PAD_R = 4;
  const slotW = (W - PAD_L - PAD_R) / valid.length;
  const barW = Math.max(2, slotW * 0.75);
  const mapX = (i: number) => PAD_L + (i + 0.5) * slotW;
  const mapH = (v: number) => (v / maxVol) * (H - PAD_T - PAD_B);
  const step = Math.max(1, Math.floor(valid.length / 4));
  const xLabels = valid.filter((_, i) => i % step === 0 || i === valid.length - 1).map((c, _, __, i = valid.indexOf(c)) => ({
    x: mapX(i), label: new Date(c.time).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }),
  }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {[0.25, 0.5, 0.75, 1].map((r, i) => {
        const y = PAD_T + (H - PAD_T - PAD_B) * (1 - r);
        return <g key={i}><line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#1f2937" strokeWidth="0.5" /><text x={W - PAD_R + 2} y={y + 3} fontSize="7" fill="#4b5563">{fmtVol(maxVol * r)}</text></g>;
      })}
      {valid.map((c, i) => {
        const h = mapH(c.volume); const x = mapX(i); const y = H - PAD_B - h;
        return <rect key={i} x={(x - barW / 2).toFixed(1)} y={y.toFixed(1)} width={barW.toFixed(1)} height={h.toFixed(1)} fill="#f59e0b" rx="1" />;
      })}
      {xLabels.map((l, i) => <text key={i} x={l.x} y={H - 4} fontSize="7" fill="#6b7280" textAnchor="middle">{l.label}</text>)}
    </svg>
  );
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
  const [history, setHistory] = useState<Candle[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [market, setMarket] = useState<'all' | 'tw' | 'us'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [range, setRange] = useState('3mo');
  const [indicLoading, setIndicLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(false);
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

  const fetchHistory = useCallback(async (symbol: string, r: string) => {
    setHistLoading(true); setHistory([]);
    try {
      const interval = r === '1d' ? '5m' : '1d';
      const res = await fetch(`/api/stocks/history?symbol=${symbol}&range=${r}&interval=${interval}`);
      const data = await res.json();
      if (data.candles) setHistory(data.candles);
    } catch { /* ignore */ }
    finally { setHistLoading(false); }
  }, []);

  const fetchNews = useCallback(async (symbol: string) => {
    setNews([]);
    try {
      const res = await fetch(`/api/stocks/news?symbol=${symbol}`);
      const data = await res.json();
      setNews(Array.isArray(data) ? data.slice(0, 5) : []);
    } catch { /* ignore */ }
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
    fetchHistory(selected, range);
    fetchNews(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    if (selected) fetchHistory(selected, range);
  }, [range, selected, fetchHistory]);

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
            <Link href="/" className="text-gray-600 hover:text-gray-400 text-sm">← 省錢</Link>
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
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_220px] gap-3">

              {/* K-Line chart */}
              <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs font-semibold text-gray-400">K 線趨勢</span>
                    <div className="text-sm font-bold text-white mt-0.5">
                      {base(selected)} · {selectedQuote ? displayName(selectedQuote) : ''}
                      {selectedQuote && <span className="text-gray-400 font-normal ml-2">{selectedQuote.currency ?? ''} {fmtPrice(selectedQuote.regularMarketPrice)}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {RANGES.map(r => (
                      <button key={r.key} onClick={() => setRange(r.key)}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${range === r.key ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                {histLoading ? (
                  <div className="h-64 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <CandlestickChart candles={history} currentPrice={selectedQuote?.regularMarketPrice} />
                )}

                {/* Indicator cards below chart */}
                <div className="mt-3 border-t border-gray-800 pt-3">
                  {indicLoading ? (
                    <div className="grid grid-cols-7 gap-1.5">
                      {Array.from({ length: 14 }).map((_, i) => (
                        <div key={i} className="bg-gray-800/50 rounded-lg px-3 py-2.5 animate-pulse"><div className="h-2 bg-gray-700 rounded w-2/3 mb-2" /><div className="h-3 bg-gray-700 rounded" /></div>
                      ))}
                    </div>
                  ) : indicators ? (
                    <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                      {INDICATOR_DEFS.map(({ key, label }) => <IndicatorCard key={key} label={label} value={indicators[key]} />)}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Right: Volume chart + stats */}
              <div className="space-y-3">
                <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4">
                  <div className="text-[10px] text-gray-500 mb-1">量能輪廓</div>
                  <div className="text-xs font-semibold text-gray-300 mb-2">交易活躍度</div>
                  <div style={{ height: 180 }}>
                    <VolumeChart candles={history} />
                  </div>
                </div>

                {/* Stats */}
                {selectedQuote && (
                  <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4 grid grid-cols-2 gap-3">
                    {[
                      ['開盤', indicators ? '-' : '-'],
                      ['收收', fmtPrice(selectedQuote.regularMarketPrice)],
                      ['成交量', fmtVol(selectedQuote.regularMarketVolume)],
                      ['市值', fmtHMil(selectedQuote.regularMarketVolume * selectedQuote.regularMarketPrice)],
                      ['今日最高', fmtPrice(selectedQuote.regularMarketDayHigh)],
                      ['今日最低', fmtPrice(selectedQuote.regularMarketDayLow)],
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
