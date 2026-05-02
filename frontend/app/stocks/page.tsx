'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface Quote {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketVolume: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  currency?: string;
  marketState?: string;
}

interface Candle {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

interface Indicators {
  sma5: string; sma20: string; rsi14: string;
  macd: string; macdSignal: string; macdHist: string;
  kdK: string; kdD: string;
  volatility: string; maxDrawdown: string; volRatio: string; distSma20: string;
  intraRange: string; weekRange: string;
}

interface NewsItem {
  title: string; link: string; publisher?: string; providerPublishTime?: number;
}

const DEFAULT_WATCHLIST = ['2330.TW', '0050.TW', '2454.TW', '0056.TW', 'AAPL', 'NVDA', 'TSM', 'MSFT'];

const TW_NAMES: Record<string, string> = {
  '2330': '台積電', '0050': '元大台灣50', '2454': '聯發科',
  '0056': '元大高股息', '2317': '鴻海', '2308': '台達電',
  '2382': '廣達', '2881': '富邦金', '2882': '國泰金',
  '2891': '中信金', '3008': '大立光', '2412': '中華電',
  '00918': '國泰永續高股息', '00919': '群益台灣精選高息',
};

const RANGES = [
  { key: '5d', label: '5日' }, { key: '1mo', label: '1月' },
  { key: '3mo', label: '3月' }, { key: '6mo', label: '6月' }, { key: '1y', label: '1年' },
];

const INDICATOR_DEFS = [
  { key: 'sma5', label: 'SMA 5' },
  { key: 'sma20', label: 'SMA 20' },
  { key: 'rsi14', label: 'RSI 14' },
  { key: 'macd', label: 'MACD' },
  { key: 'macdSignal', label: 'MACD 訊號' },
  { key: 'macdHist', label: 'MACD 柱' },
  { key: 'kdK', label: 'KD K' },
  { key: 'kdD', label: 'KD D' },
  { key: 'volatility', label: '年化波動' },
  { key: 'maxDrawdown', label: '最大回撤' },
  { key: 'volRatio', label: '量比' },
  { key: 'distSma20', label: '距 SMA20' },
  { key: 'intraRange', label: '日內區間' },
  { key: 'weekRange', label: '52 週區間' },
] as const;

function isTW(symbol: string) { return symbol.endsWith('.TW') || symbol.endsWith('.TWO'); }
function base(symbol: string) { return symbol.replace(/\.(TW|TWO)$/, ''); }
function displayName(q: Quote) { return TW_NAMES[base(q.symbol)] || q.shortName || q.symbol; }
function fmtPrice(n: number) { return n >= 100 ? n.toFixed(2) : n.toFixed(3); }
function fmtVol(n: number) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}億`;
  if (n >= 1e4) return `${Math.round(n / 1e4)}萬`;
  return n.toLocaleString();
}
function fmtHundredMil(n: number) {
  const v = n / 1e8;
  return v >= 1 ? `${v.toFixed(1)}億` : `${(n / 1e4).toFixed(0)}萬`;
}

// ── Sparkline ─────────────────────────────────────────────────────────────
function Sparkline({ candles, positive }: { candles: Candle[]; positive: boolean }) {
  const closes = candles.map(c => c.close).filter(Boolean);
  if (closes.length < 2) return <div className="w-16 h-6" />;
  const min = Math.min(...closes), max = Math.max(...closes), range = max - min || 1;
  const W = 64, H = 24, P = 2;
  const pts = closes.map((v, i) => `${P + (i / (closes.length - 1)) * (W - P * 2)},${P + (1 - (v - min) / range) * (H - P * 2)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-16 h-6">
      <polyline points={pts} fill="none" stroke={positive ? '#22c55e' : '#ef4444'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Candlestick Chart with SMA + Volume ───────────────────────────────────
function CandlestickChart({ candles }: { candles: Candle[] }) {
  const valid = candles.filter(c => c.open && c.close && c.high && c.low);
  if (valid.length < 5) return <div className="h-56 flex items-center justify-center text-gray-600 text-sm">載入中…</div>;

  const W = 600, CH = 180, VH = 48, GAP = 8, PAD_T = 10, PAD_R = 44, PAD_L = 6;
  const TOTAL_H = CH + GAP + VH + 18;

  const allPrices = valid.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...allPrices), maxP = Math.max(...allPrices);
  const rangeP = maxP - minP || 1;
  const maxVol = Math.max(...valid.map(c => c.volume || 0)) || 1;

  const usableW = W - PAD_L - PAD_R;
  const slotW = usableW / valid.length;
  const bodyW = Math.max(2, slotW * 0.65);

  const mapX = (i: number) => PAD_L + (i + 0.5) * slotW;
  const mapY = (p: number) => PAD_T + (1 - (p - minP) / rangeP) * (CH - PAD_T * 2);
  const mapVY = (v: number) => CH + GAP + VH - (v / maxVol) * VH;

  // SMA helper
  const calcSMA = (period: number): (number | null)[] =>
    valid.map((_, i) => {
      if (i < period - 1) return null;
      return valid.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0) / period;
    });

  const buildPath = (vals: (number | null)[]) => {
    let d = ''; let started = false;
    vals.forEach((v, i) => {
      if (v == null) return;
      const x = mapX(i).toFixed(1), y = mapY(v).toFixed(1);
      d += started ? ` L${x},${y}` : `M${x},${y}`; started = true;
    });
    return d;
  };

  const sma5Path = buildPath(calcSMA(5));
  const sma20Path = buildPath(calcSMA(20));

  // Y-axis price labels
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(r => ({
    y: mapY(minP + r * rangeP),
    val: (minP + r * rangeP) >= 100 ? (minP + r * rangeP).toFixed(0) : (minP + r * rangeP).toFixed(2),
  }));

  // X-axis date labels (≈5 labels)
  const step = Math.max(1, Math.floor(valid.length / 5));
  const xLabels = valid.filter((_, i) => i % step === 0 || i === valid.length - 1).map((c, _, __, i = valid.indexOf(c)) => ({
    x: mapX(i), label: new Date(c.time).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${TOTAL_H}`} className="w-full" style={{ height: 260 }}>
      {/* Grid lines */}
      {yLabels.map((l, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={l.y} x2={W - PAD_R} y2={l.y} stroke="#374151" strokeWidth="0.5" strokeDasharray="3 3" />
          <text x={W - PAD_R + 3} y={l.y + 4} fontSize="8" fill="#6b7280">{l.val}</text>
        </g>
      ))}

      {/* Volume bars */}
      {valid.map((c, i) => {
        const isUp = c.close >= c.open;
        const vY = mapVY(c.volume || 0);
        const vH = Math.max(1, CH + GAP + VH - vY);
        return <rect key={`v${i}`} x={(mapX(i) - bodyW / 2).toFixed(1)} y={vY.toFixed(1)} width={bodyW.toFixed(1)} height={vH.toFixed(1)} fill={isUp ? '#22c55e50' : '#ef444450'} />;
      })}

      {/* Candles */}
      {valid.map((c, i) => {
        const isUp = c.close >= c.open;
        const color = isUp ? '#22c55e' : '#ef4444';
        const x = mapX(i);
        const bTop = mapY(Math.max(c.open, c.close));
        const bBot = mapY(Math.min(c.open, c.close));
        const bH = Math.max(1, bBot - bTop);
        return (
          <g key={i}>
            <line x1={x} y1={mapY(c.high)} x2={x} y2={mapY(c.low)} stroke={color} strokeWidth="1" />
            <rect x={(x - bodyW / 2).toFixed(1)} y={bTop.toFixed(1)} width={bodyW.toFixed(1)} height={bH.toFixed(1)} fill={color} />
          </g>
        );
      })}

      {/* SMA lines */}
      {sma5Path && <path d={sma5Path} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />}
      {sma20Path && <path d={sma20Path} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" />}

      {/* Legend */}
      <g>
        <line x1={PAD_L} y1={6} x2={PAD_L + 16} y2={6} stroke="#f59e0b" strokeWidth="1.5" />
        <text x={PAD_L + 20} y={10} fontSize="9" fill="#f59e0b">SMA5</text>
        <line x1={PAD_L + 52} y1={6} x2={PAD_L + 68} y2={6} stroke="#3b82f6" strokeWidth="1.5" />
        <text x={PAD_L + 72} y={10} fontSize="9" fill="#3b82f6">SMA20</text>
      </g>

      {/* X labels */}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={TOTAL_H - 2} fontSize="8" fill="#6b7280" textAnchor="middle">{l.label}</text>
      ))}
    </svg>
  );
}

// ── Indicator Card ────────────────────────────────────────────────────────
function IndicatorCard({ label, value }: { label: string; value: string }) {
  const isNeg = value.startsWith('-');
  const isPos = !isNeg && (value.startsWith('+') || (label === 'RSI 14' && parseFloat(value) > 50));
  const color = label === '最大回撤' || isNeg ? 'text-red-400' : isPos ? 'text-green-400' : 'text-white';
  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2.5">
      <div className="text-[10px] text-gray-500 mb-1">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
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
  const [addInput, setAddInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [range, setRange] = useState('1mo');
  const [indicLoading, setIndicLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('stock_watchlist');
    if (saved) { try { setWatchlist(JSON.parse(saved)); } catch { /* ignore */ } }
  }, []);

  const saveWatchlist = useCallback((list: string[]) => {
    setWatchlist(list);
    localStorage.setItem('stock_watchlist', JSON.stringify(list));
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
    setIndicLoading(true);
    setIndicators(null);
    try {
      const res = await fetch(`/api/stocks/indicators?symbol=${symbol}`);
      const data = await res.json();
      if (!data.error) setIndicators(data);
    } catch { /* ignore */ }
    finally { setIndicLoading(false); }
  }, []);

  const fetchHistory = useCallback(async (symbol: string, r: string) => {
    setHistory([]);
    try {
      const res = await fetch(`/api/stocks/history?symbol=${symbol}&range=${r}&interval=1d`);
      const data = await res.json();
      if (data.candles) setHistory(data.candles);
    } catch { /* ignore */ }
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

  const addStock = () => {
    const raw = addInput.trim().toUpperCase();
    if (!raw) return;
    const sym = /^\d{4,5}$/.test(raw) ? `${raw}.TW` : raw;
    if (!watchlist.includes(sym)) {
      const next = [...watchlist, sym];
      saveWatchlist(next);
      fetchQuotes([sym]);
      fetchSparklines([sym]);
    }
    setAddInput('');
  };

  const removeStock = (symbol: string) => {
    saveWatchlist(watchlist.filter(s => s !== symbol));
    if (selected === symbol) setSelected(null);
  };

  const filtered = watchlist.filter(s => {
    if (market === 'tw') return isTW(s);
    if (market === 'us') return !isTW(s);
    return true;
  });

  const selectedQuote = selected ? quotes[selected] : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ── Header ── */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-screen-xl mx-auto px-4 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">← 省錢</Link>
              <div>
                <h1 className="text-lg font-bold">📈 股市資訊看版</h1>
                {lastUpdate && <p className="text-[10px] text-gray-600">更新 {lastUpdate.toLocaleTimeString('zh-TW')} · 60秒自動刷新</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text" placeholder="輸入代號，如 2330 或 AAPL"
                value={addInput} onChange={e => setAddInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addStock()}
                className="w-52 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button onClick={addStock} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors">新增</button>
              <button onClick={() => { fetchQuotes(watchlist); fetchSparklines(watchlist); }}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors" title="刷新">↻
              </button>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            {(['all', 'tw', 'us'] as const).map(m => (
              <button key={m} onClick={() => setMarket(m)}
                className={`px-4 py-1 rounded-lg text-sm font-medium transition-colors ${market === m ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                {m === 'all' ? '全部' : m === 'tw' ? '台股' : '美股'}
              </button>
            ))}
            <span className="ml-auto text-xs text-gray-600 self-center">{filtered.length} 支</span>
          </div>
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto px-4 py-4">
        <div className={`grid gap-4 ${selected ? 'xl:grid-cols-[1fr_360px]' : ''}`}>

          {/* ── Left: Indicators + Table ── */}
          <div className="space-y-4 min-w-0">

            {/* Indicator panel */}
            {selected && (
              <div className="bg-gray-900/80 border border-gray-700 rounded-xl p-4">
                {/* Selected stock header */}
                {selectedQuote && (
                  <div className="flex items-center gap-4 mb-4 pb-3 border-b border-gray-800">
                    <div>
                      <span className="text-lg font-bold mr-2">{base(selectedQuote.symbol)}</span>
                      <span className="text-gray-400 text-sm">{displayName(selectedQuote)}</span>
                    </div>
                    <div className="text-xl font-bold">
                      {selectedQuote.currency ?? ''} {fmtPrice(selectedQuote.regularMarketPrice)}
                    </div>
                    <div className={`text-sm font-medium flex items-center gap-1.5 ${selectedQuote.regularMarketChangePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      <span>{selectedQuote.regularMarketChangePercent >= 0 ? '▲' : '▼'}</span>
                      <span>{Math.abs(selectedQuote.regularMarketChange).toFixed(2)}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${selectedQuote.regularMarketChangePercent >= 0 ? 'bg-green-500/15' : 'bg-red-500/15'}`}>
                        {selectedQuote.regularMarketChangePercent >= 0 ? '+' : ''}{selectedQuote.regularMarketChangePercent.toFixed(2)}%
                      </span>
                    </div>
                    <div className="ml-auto text-right text-xs text-gray-500">
                      <div>成交量 <span className="text-gray-300">{fmtVol(selectedQuote.regularMarketVolume)}</span></div>
                      <div>成交金額 <span className="text-gray-300">{fmtHundredMil(selectedQuote.regularMarketVolume * selectedQuote.regularMarketPrice)}</span></div>
                    </div>
                  </div>
                )}

                {/* Indicator grid */}
                {indicLoading ? (
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                    {Array.from({ length: 14 }).map((_, i) => (
                      <div key={i} className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2.5 animate-pulse">
                        <div className="h-2 bg-gray-700 rounded w-2/3 mb-2" />
                        <div className="h-3 bg-gray-700 rounded w-full" />
                      </div>
                    ))}
                  </div>
                ) : indicators ? (
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                    {INDICATOR_DEFS.map(({ key, label }) => (
                      <IndicatorCard key={key} label={label} value={indicators[key]} />
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-600 text-center py-2">指標計算中…</div>
                )}
              </div>
            )}

            {/* Stock table */}
            <div className="bg-gray-900/60 border border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-400">自選股</h2>
                {lastUpdate && <span className="text-[10px] text-gray-600">更新 {lastUpdate.toLocaleTimeString('zh-TW')} 上午</span>}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-gray-500 border-b border-gray-800">
                        <th className="text-left px-4 py-2 font-medium">代號</th>
                        <th className="text-center px-2 py-2 font-medium">市場</th>
                        <th className="text-right px-3 py-2 font-medium">價格</th>
                        <th className="text-right px-3 py-2 font-medium">漲跌</th>
                        <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">成交量</th>
                        <th className="text-right px-3 py-2 font-medium hidden md:table-cell">成交億</th>
                        <th className="text-center px-3 py-2 font-medium hidden lg:table-cell">走勢</th>
                        <th className="text-center px-2 py-2 font-medium hidden md:table-cell">來源</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {filtered.map(symbol => {
                        const q = quotes[symbol];
                        const isSelected = selected === symbol;
                        const pos = q ? q.regularMarketChangePercent >= 0 : true;

                        if (!q) {
                          return (
                            <tr key={symbol} className="animate-pulse">
                              <td className="px-4 py-3"><div className="h-4 bg-gray-800 rounded w-20" /></td>
                              <td className="px-2 py-3"><div className="h-4 bg-gray-800 rounded w-12 mx-auto" /></td>
                              <td className="px-3 py-3"><div className="h-4 bg-gray-800 rounded w-24 ml-auto" /></td>
                              <td className="px-3 py-3"><div className="h-4 bg-gray-800 rounded w-16 ml-auto" /></td>
                              <td className="px-3 py-3 hidden sm:table-cell"><div className="h-4 bg-gray-800 rounded w-16 ml-auto" /></td>
                              <td className="px-3 py-3 hidden md:table-cell"><div className="h-4 bg-gray-800 rounded w-12 ml-auto" /></td>
                              <td className="px-3 py-3 hidden lg:table-cell" />
                              <td className="px-3 py-3 hidden md:table-cell" />
                              <td className="px-2 py-3" />
                            </tr>
                          );
                        }

                        return (
                          <tr
                            key={symbol}
                            onClick={() => setSelected(prev => prev === symbol ? null : symbol)}
                            className={`cursor-pointer transition-colors ${isSelected ? 'bg-blue-950/40' : 'hover:bg-gray-800/40'}`}
                          >
                            {/* 代號 */}
                            <td className="px-4 py-3">
                              <div className={`font-bold ${isSelected ? 'text-blue-300' : 'text-white'}`}>{base(symbol)}</div>
                              <div className="text-[11px] text-gray-500 truncate max-w-[120px]">{displayName(q)}</div>
                            </td>

                            {/* 市場 */}
                            <td className="px-2 py-3 text-center">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isTW(symbol) ? 'bg-blue-900/60 text-blue-300' : 'bg-purple-900/60 text-purple-300'}`}>
                                {isTW(symbol) ? '台股' : '美股'}
                              </span>
                            </td>

                            {/* 價格 */}
                            <td className="px-3 py-3 text-right">
                              <span className="font-bold text-white">{q.currency === 'TWD' ? 'TWD' : 'USD'} {fmtPrice(q.regularMarketPrice)}</span>
                            </td>

                            {/* 漲跌 */}
                            <td className="px-3 py-3 text-right">
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${pos ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                                {pos ? '+' : ''}{q.regularMarketChangePercent.toFixed(2)}%
                              </span>
                            </td>

                            {/* 成交量 */}
                            <td className="px-3 py-3 text-right text-gray-400 hidden sm:table-cell">
                              {fmtVol(q.regularMarketVolume)}
                            </td>

                            {/* 成交億 */}
                            <td className="px-3 py-3 text-right text-gray-400 hidden md:table-cell">
                              {fmtHundredMil(q.regularMarketVolume * q.regularMarketPrice)}
                            </td>

                            {/* 走勢 sparkline */}
                            <td className="px-3 py-3 hidden lg:table-cell">
                              <Sparkline candles={sparklines[symbol] ?? []} positive={pos} />
                            </td>

                            {/* 來源 */}
                            <td className="px-3 py-3 text-center hidden md:table-cell">
                              <span className="text-[10px] text-gray-600">Yahoo Finance</span>
                            </td>

                            {/* 刪除 */}
                            <td className="px-2 py-3 text-center">
                              <button
                                onClick={e => { e.stopPropagation(); removeStock(symbol); }}
                                className="w-6 h-6 rounded hover:bg-red-900/50 text-gray-700 hover:text-red-400 transition-colors flex items-center justify-center text-base leading-none"
                                title="移除"
                              >🗑</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {filtered.length === 0 && (
                    <div className="text-center py-16 text-gray-600">
                      <p className="text-3xl mb-2">📉</p>
                      <p className="text-sm">沒有股票，請新增一支</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Chart + News ── */}
          {selected && (
            <div className="space-y-3">
              {/* Chart */}
              <div className="bg-gray-900/60 border border-gray-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-300">{base(selected)} 走勢</span>
                  <button onClick={() => setSelected(null)} className="text-gray-600 hover:text-gray-300 text-lg leading-none">×</button>
                </div>
                <div className="flex gap-1.5 mb-3 flex-wrap">
                  {RANGES.map(r => (
                    <button key={r.key} onClick={() => setRange(r.key)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${range === r.key ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
                <CandlestickChart candles={history} />
              </div>

              {/* News */}
              {news.length > 0 && (
                <div className="bg-gray-900/60 border border-gray-700 rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">相關新聞</h3>
                  <div className="space-y-3">
                    {news.map((item, i) => (
                      <a key={i} href={item.link} target="_blank" rel="noopener noreferrer" className="block group">
                        <p className="text-sm text-gray-300 group-hover:text-blue-400 transition-colors line-clamp-2 leading-snug">{item.title}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5">
                          {item.publisher}{item.providerPublishTime && <> · {new Date(item.providerPublishTime * 1000).toLocaleDateString('zh-TW')}</>}
                        </p>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
