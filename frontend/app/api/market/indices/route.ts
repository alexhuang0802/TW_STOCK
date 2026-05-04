import { NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const INDICES = [
  { symbol: '^TWII',     label: '台股加權',   flag: '🇹🇼' },
  { symbol: '^GSPC',     label: 'S&P 500',    flag: '🇺🇸' },
  { symbol: '^IXIC',     label: 'NASDAQ',     flag: '🇺🇸' },
  { symbol: '^DJI',      label: 'DOW',        flag: '🇺🇸' },
  { symbol: '^N225',     label: '日經225',    flag: '🇯🇵' },
  { symbol: '^HSI',      label: '恆生',       flag: '🇭🇰' },
  { symbol: '000001.SS', label: '上證',       flag: '🇨🇳' },
  { symbol: '^KS11',     label: '韓國KOSPI',  flag: '🇰🇷' },
  { symbol: '^FTSE',     label: 'FTSE 100',   flag: '🇬🇧' },
  { symbol: '^GDAXI',    label: 'DAX',        flag: '🇩🇪' },
];

async function fetchIndex(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice;
  const price = meta.regularMarketPrice as number;
  const change = price - prev;
  const changePct = prev ? (change / prev) * 100 : 0;
  return { symbol, price, change, changePct, marketState: meta.marketState ?? 'CLOSED' };
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
      marketState: q?.marketState ?? 'CLOSED',
    };
  });

  return NextResponse.json({ indices: indicesData, updatedAt: new Date().toISOString() });
}
