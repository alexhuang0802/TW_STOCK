import { NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const INDICES = [
  { symbol: '^TWII', label: '台股加權', flag: '🇹🇼' },
  { symbol: '^GSPC', label: 'S&P 500',  flag: '🇺🇸' },
  { symbol: '^IXIC', label: 'NASDAQ',   flag: '🇺🇸' },
  { symbol: '^DJI',  label: 'DOW',      flag: '🇺🇸' },
  { symbol: '^N225', label: '日經225',  flag: '🇯🇵' },
];

async function fetchIndex(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta;
  const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter((v: number | null) => v != null);
  const price = meta.regularMarketPrice as number;
  // Use Yahoo's own today-change fields first; fall back to prev-close calculation
  const change    = meta.regularMarketChange    ?? (price - (meta.chartPreviousClose ?? meta.previousClose ?? price));
  const changePct = meta.regularMarketChangePercent ?? (meta.chartPreviousClose ? change / meta.chartPreviousClose * 100 : 0);
  return { symbol, price, change, changePct, closes, marketState: meta.marketState ?? 'CLOSED' };
}

export async function GET() {
  const results = await Promise.allSettled(INDICES.map(idx => fetchIndex(idx.symbol)));

  const indicesData = INDICES.map((idx, i) => {
    const r = results[i];
    const q = r.status === 'fulfilled' ? r.value : null;
    const up = (q?.change ?? 0) >= 0;
    return {
      symbol: idx.symbol,
      label: idx.label,
      flag: idx.flag,
      price: q ? q.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'N/A',
      change: q ? (up ? '+' : '') + q.change.toFixed(2) : 'N/A',
      changePct: q ? (up ? '+' : '') + q.changePct.toFixed(2) + '%' : 'N/A',
      up,
      closes: q?.closes ?? [],
      marketState: q?.marketState ?? 'CLOSED',
    };
  });

  return NextResponse.json({ indices: indicesData, updatedAt: new Date().toISOString() });
}
