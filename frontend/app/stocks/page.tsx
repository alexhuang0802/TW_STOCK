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
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface NewsItem {
  title: string;
  link: string;
  publisher?: string;
  providerPublishTime?: number;
}

const DEFAULT_WATCHLIST = ['2330.TW', '0050.TW', '2454.TW', '0056.TW', 'AAPL', 'NVDA', 'TSM', 'MSFT'];

const TW_NAMES: Record<string, string> = {
  '2330': '台積電', '0050': '元大台灣50', '2454': '聯發科',
  '0056': '元大高股息', '2317': '鴻海', '2308': '台達電',
  '2382': '廣達', '2881': '富邦金', '2882': '國泰金',
  '2891': '中信金', '3008': '大立光', '2412': '中華電',
};

const RANGES = [
  { key: '5d', label: '5日' },
  { key: '1mo', label: '1月' },
  { key: '3mo', label: '3月' },
  { key: '6mo', label: '6月' },
  { key: '1y', label: '1年' },
];

function isTW(symbol: string) {
  return symbol.endsWith('.TW') || symbol.endsWith('.TWO');
}

function baseSymbol(symbol: string) {
  return symbol.replace(/\.(TW|TWO)$/, '');
}

function displayName(q: Quote): string {
  return TW_NAMES[baseSymbol(q.symbol)] || q.shortName || q.symbol;
}

function fmtPrice(n: number): string {
  return n >= 100 ? n.toFixed(2) : n.toFixed(3);
}

function fmtVol(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}億`;
  if (n >= 1e4) return `${Math.round(n / 1e4)}萬`;
  return n.toLocaleString();
}

// ── SVG sparkline (mini) ──────────────────────────────────────────────────
function Sparkline({ candles, positive }: { candles: Candle[]; positive: boolean }) {
  const closes = candles.map(c => c.close).filter(Boolean);
  if (closes.length < 2) return <div className="w-20 h-8" />;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const W = 80, H = 32, PAD = 2;

  const pts = closes
    .map((v, i) => {
      const x = PAD + (i / (closes.length - 1)) * (W - PAD * 2);
      const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-20 h-8 shrink-0">
      <polyline
        points={pts}
        fill="none"
        stroke={positive ? '#22c55e' : '#ef4444'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── SVG area chart (detail) ───────────────────────────────────────────────
function AreaChart({ candles }: { candles: Candle[] }) {
  const closes = candles.map(c => c.close).filter(Boolean);
  if (closes.length < 2) {
    return (
      <div className="h-44 flex items-center justify-center text-gray-600 text-sm">
        載入圖表中…
      </div>
    );
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const W = 600, H = 160, PX = 8, PY = 8;

  const xs = closes.map((_, i) => PX + (i / (closes.length - 1)) * (W - PX * 2));
  const ys = closes.map(v => PY + (1 - (v - min) / range) * (H - PY * 2));
  const linePts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const areaPts = `${xs[0].toFixed(1)},${H} ${linePts} ${xs[xs.length - 1].toFixed(1)},${H}`;
  const positive = closes[closes.length - 1] >= closes[0];
  const stroke = positive ? '#22c55e' : '#ef4444';
  const fill = positive ? '#22c55e18' : '#ef444418';

  // y-axis labels
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(ratio => ({
    y: PY + (1 - ratio) * (H - PY * 2),
    val: (min + ratio * range).toFixed(1),
  }));

  // x-axis dates (pick ~5 evenly spaced)
  const step = Math.max(1, Math.floor(candles.length / 5));
  const xLabels = candles
    .filter((_, i) => i % step === 0 || i === candles.length - 1)
    .map((c, i, arr) => {
      const xi = candles.indexOf(c);
      return {
        x: xs[xi],
        label: new Date(c.time).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }),
        last: i === arr.length - 1,
      };
    });

  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" style={{ height: 180 }}>
      {/* grid lines */}
      {yLabels.map((l, i) => (
        <g key={i}>
          <line x1={PX} y1={l.y} x2={W - PX} y2={l.y} stroke="#374151" strokeWidth="0.5" strokeDasharray="3,3" />
          <text x={W - PX + 2} y={l.y + 4} fontSize="9" fill="#6b7280">{l.val}</text>
        </g>
      ))}
      {/* area + line */}
      <polygon points={areaPts} fill={fill} />
      <polyline points={linePts} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* x labels */}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={H + 14} fontSize="9" fill="#6b7280" textAnchor="middle">{l.label}</text>
      ))}
    </svg>
  );
}

// ── Stock Card ────────────────────────────────────────────────────────────
function StockCard({
  quote, sparkline, selected, onClick, onRemove,
}: {
  quote: Quote;
  sparkline: Candle[];
  selected: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const pos = quote.regularMarketChangePercent >= 0;
  const changeColor = pos ? 'text-green-400' : 'text-red-400';
  const badgeBg = pos ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400';

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`w-full text-left rounded-xl p-4 border transition-all duration-150 ${
          selected
            ? 'bg-blue-950/60 border-blue-500'
            : 'bg-gray-800/50 border-gray-700/60 hover:border-gray-600 hover:bg-gray-800'
        }`}
      >
        {/* top row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-white text-sm">{baseSymbol(quote.symbol)}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                {isTW(quote.symbol) ? '台股' : '美股'}
              </span>
            </div>
            <div className="text-xs text-gray-500 truncate mt-0.5">{displayName(quote)}</div>
          </div>
          <Sparkline candles={sparkline} positive={pos} />
        </div>

        {/* bottom row */}
        <div className="mt-3 flex items-end justify-between gap-2">
          <div>
            <div className="text-xl font-bold text-white tracking-tight">
              ${fmtPrice(quote.regularMarketPrice)}
            </div>
            <div className={`flex items-center gap-1.5 mt-0.5 text-sm ${changeColor}`}>
              <span>{pos ? '▲' : '▼'}</span>
              <span>{Math.abs(quote.regularMarketChange).toFixed(2)}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badgeBg}`}>
                {pos ? '+' : ''}{quote.regularMarketChangePercent.toFixed(2)}%
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-gray-600">成交量</div>
            <div className="text-xs text-gray-400">{fmtVol(quote.regularMarketVolume)}</div>
          </div>
        </div>
      </button>

      {/* remove button */}
      <button
        onClick={e => { e.stopPropagation(); onRemove(); }}
        className="absolute top-2 right-2 w-5 h-5 rounded-full bg-gray-700 hover:bg-red-700 text-gray-400 hover:text-white text-xs opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center leading-none"
        title="移除"
      >
        ×
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function StocksPage() {
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [sparklines, setSparklines] = useState<Record<string, Candle[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Candle[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [market, setMarket] = useState<'all' | 'tw' | 'us'>('all');
  const [addInput, setAddInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [range, setRange] = useState('1mo');
  const [histLoading, setHistLoading] = useState(false);

  // persist watchlist
  useEffect(() => {
    const saved = localStorage.getItem('stock_watchlist');
    if (saved) {
      try { setWatchlist(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  const saveWatchlist = useCallback((list: string[]) => {
    setWatchlist(list);
    localStorage.setItem('stock_watchlist', JSON.stringify(list));
  }, []);

  // ── fetch quotes ──
  const fetchQuotes = useCallback(async (list: string[]) => {
    if (!list.length) return;
    try {
      const res = await fetch(`/api/stocks?symbols=${list.join(',')}`);
      const data: Quote[] = await res.json();
      if (Array.isArray(data)) {
        setQuotes(prev => {
          const next = { ...prev };
          data.forEach(q => { next[q.symbol] = q; });
          return next;
        });
        setLastUpdate(new Date());
      }
    } catch { /* ignore */ }
  }, []);

  // ── fetch sparklines (1mo daily) ──
  const fetchSparklines = useCallback(async (list: string[]) => {
    await Promise.allSettled(
      list.map(async symbol => {
        try {
          const res = await fetch(`/api/stocks/history?symbol=${symbol}&range=1mo&interval=1d`);
          const data = await res.json();
          if (data.candles?.length) {
            setSparklines(prev => ({ ...prev, [symbol]: data.candles }));
          }
        } catch { /* ignore */ }
      })
    );
  }, []);

  // ── fetch chart for selected symbol ──
  const fetchHistory = useCallback(async (symbol: string, r: string) => {
    setHistLoading(true);
    setHistory([]);
    try {
      const res = await fetch(`/api/stocks/history?symbol=${symbol}&range=${r}&interval=1d`);
      const data = await res.json();
      if (data.candles) setHistory(data.candles);
    } catch { /* ignore */ }
    finally { setHistLoading(false); }
  }, []);

  // ── fetch news ──
  const fetchNews = useCallback(async (symbol: string) => {
    setNews([]);
    try {
      const res = await fetch(`/api/stocks/news?symbol=${symbol}`);
      const data = await res.json();
      setNews(Array.isArray(data) ? data.slice(0, 6) : []);
    } catch { /* ignore */ }
  }, []);

  // initial load — show cards as soon as quotes arrive; sparklines load in background
  useEffect(() => {
    setLoading(true);
    fetchQuotes(watchlist).finally(() => setLoading(false));
    fetchSparklines(watchlist);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // auto-refresh quotes every 60s
  useEffect(() => {
    const id = setInterval(() => fetchQuotes(watchlist), 60_000);
    return () => clearInterval(id);
  }, [watchlist, fetchQuotes]);

  // when selected or range changes, fetch history + news
  useEffect(() => {
    if (!selected) return;
    fetchHistory(selected, range);
    fetchNews(selected);
  }, [selected, range, fetchHistory, fetchNews]);

  // ── watchlist actions ──
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

  // ── filter ──
  const filtered = watchlist.filter(s => {
    if (market === 'tw') return isTW(s);
    if (market === 'us') return !isTW(s);
    return true;
  });

  const selectedQuote = selected ? quotes[selected] : null;
  const selPos = selectedQuote ? selectedQuote.regularMarketChangePercent >= 0 : true;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ── Header ── */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
                ← 省錢小工具
              </Link>
              <div>
                <h1 className="text-lg font-bold text-white">📈 股市資訊看版</h1>
                {lastUpdate && (
                  <p className="text-[10px] text-gray-600">
                    更新：{lastUpdate.toLocaleTimeString('zh-TW')} · 每60秒自動刷新
                  </p>
                )}
              </div>
            </div>

            {/* add stock */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="輸入代號，如 2330 或 AAPL"
                value={addInput}
                onChange={e => setAddInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addStock()}
                className="w-56 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={addStock}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
              >
                新增
              </button>
              <button
                onClick={() => { fetchQuotes(watchlist); fetchSparklines(watchlist); }}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
                title="手動刷新"
              >
                ↻
              </button>
            </div>
          </div>

          {/* market filter */}
          <div className="flex gap-2 mt-2">
            {(['all', 'tw', 'us'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className={`px-4 py-1 rounded-lg text-sm font-medium transition-colors ${
                  market === m
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {m === 'all' ? '全部' : m === 'tw' ? '台股' : '美股'}
              </button>
            ))}
            <span className="ml-auto text-xs text-gray-600 self-center">
              {filtered.length} 支股票
            </span>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="max-w-7xl mx-auto px-4 py-5">
        <div className={`grid gap-5 ${selected ? 'lg:grid-cols-[1fr_380px]' : ''}`}>

          {/* stock grid */}
          <div>
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-xl p-4 bg-gray-800/40 border border-gray-700 animate-pulse">
                    <div className="h-3 bg-gray-700 rounded w-1/4 mb-2" />
                    <div className="h-5 bg-gray-700 rounded w-1/2 mb-3" />
                    <div className="h-6 bg-gray-700 rounded w-2/3" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 text-gray-600">
                <p className="text-4xl mb-3">📉</p>
                <p>沒有股票，請新增一支</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map(symbol => {
                  const q = quotes[symbol];
                  if (!q) {
                    return (
                      <div key={symbol} className="rounded-xl p-4 bg-gray-800/40 border border-gray-700 animate-pulse">
                        <div className="h-3 bg-gray-700 rounded w-1/3 mb-2" />
                        <div className="h-5 bg-gray-700 rounded w-1/2 mb-3" />
                        <div className="h-6 bg-gray-700 rounded w-2/3" />
                      </div>
                    );
                  }
                  return (
                    <StockCard
                      key={symbol}
                      quote={q}
                      sparkline={sparklines[symbol] ?? []}
                      selected={selected === symbol}
                      onClick={() => setSelected(prev => prev === symbol ? null : symbol)}
                      onRemove={() => removeStock(symbol)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Detail panel ── */}
          {selected && (
            <div className="space-y-4">
              {/* quote header */}
              {selectedQuote && (
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl font-bold">{baseSymbol(selectedQuote.symbol)}</span>
                        <span className="text-sm text-gray-400">{displayName(selectedQuote)}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          selectedQuote.marketState === 'REGULAR'
                            ? 'bg-green-900/50 text-green-400'
                            : 'bg-gray-700 text-gray-500'
                        }`}>
                          {selectedQuote.marketState === 'REGULAR' ? '交易中' : selectedQuote.marketState ?? ''}
                        </span>
                      </div>
                      <div className="text-3xl font-bold mt-2 tracking-tight">
                        ${fmtPrice(selectedQuote.regularMarketPrice)}
                      </div>
                      <div className={`flex items-center gap-2 mt-1 text-sm font-medium ${
                        selPos ? 'text-green-400' : 'text-red-400'
                      }`}>
                        <span>{selPos ? '▲' : '▼'}</span>
                        <span>{Math.abs(selectedQuote.regularMarketChange).toFixed(2)}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          selPos ? 'bg-green-500/15' : 'bg-red-500/15'
                        }`}>
                          {selPos ? '+' : ''}{selectedQuote.regularMarketChangePercent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => setSelected(null)}
                      className="text-gray-600 hover:text-gray-300 p-1 text-xl leading-none"
                    >
                      ×
                    </button>
                  </div>

                  {/* stats grid */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm">
                    {[
                      ['今日最高', `$${fmtPrice(selectedQuote.regularMarketDayHigh)}`],
                      ['今日最低', `$${fmtPrice(selectedQuote.regularMarketDayLow)}`],
                      ['成交量', fmtVol(selectedQuote.regularMarketVolume)],
                      ['幣別', selectedQuote.currency ?? '-'],
                      ...(selectedQuote.fiftyTwoWeekHigh != null ? [
                        ['52週高', `$${fmtPrice(selectedQuote.fiftyTwoWeekHigh)}`],
                        ['52週低', `$${fmtPrice(selectedQuote.fiftyTwoWeekLow ?? 0)}`],
                      ] : []),
                    ].map(([label, val]) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-gray-500">{label}</span>
                        <span className="text-gray-200 font-medium">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* chart */}
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <div className="flex gap-1.5 mb-3 flex-wrap">
                  {RANGES.map(r => (
                    <button
                      key={r.key}
                      onClick={() => setRange(r.key)}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        range === r.key
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {histLoading ? (
                  <div className="h-44 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <AreaChart candles={history} />
                )}
              </div>

              {/* news */}
              {news.length > 0 && (
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    相關新聞
                  </h3>
                  <div className="space-y-3">
                    {news.map((item, i) => (
                      <a
                        key={i}
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block group"
                      >
                        <p className="text-sm text-gray-300 group-hover:text-blue-400 transition-colors line-clamp-2 leading-snug">
                          {item.title}
                        </p>
                        <p className="text-[10px] text-gray-600 mt-0.5">
                          {item.publisher}
                          {item.providerPublishTime && (
                            <> · {new Date(item.providerPublishTime * 1000).toLocaleDateString('zh-TW')}</>
                          )}
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
