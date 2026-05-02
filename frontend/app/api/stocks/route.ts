import { NextRequest, NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchQuote(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;

  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice;
  const price = meta.regularMarketPrice;
  const change = price - prev;
  const changePct = prev ? (change / prev) * 100 : 0;

  return {
    symbol: meta.symbol,
    shortName: meta.shortName ?? meta.longName ?? meta.symbol,
    longName: meta.longName ?? meta.shortName ?? meta.symbol,
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: changePct,
    regularMarketVolume: meta.regularMarketVolume ?? 0,
    regularMarketDayHigh: meta.regularMarketDayHigh ?? price,
    regularMarketDayLow: meta.regularMarketDayLow ?? price,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    currency: meta.currency,
    marketState: meta.marketState,
  };
}

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get('symbols') || '';
  if (!symbols) return NextResponse.json([], { status: 400 });

  const list = symbols.split(',').map(s => s.trim()).filter(Boolean);

  const results = await Promise.allSettled(list.map(fetchQuote));
  const quotes = results
    .filter((r): r is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof fetchQuote>>>> =>
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value);

  return NextResponse.json(quotes);
}
