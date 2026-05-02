import { NextRequest, NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') || '';
  const range = req.nextUrl.searchParams.get('range') || '1mo';
  const interval = req.nextUrl.searchParams.get('interval') || '1d';

  if (!symbol) return NextResponse.json({ error: 'No symbol' }, { status: 400 });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return NextResponse.json({ error: 'Upstream error' }, { status: 502 });

    const data = await res.json();
    const chart = data.chart?.result?.[0];
    if (!chart) return NextResponse.json({ error: 'No data' }, { status: 404 });

    const timestamps: number[] = chart.timestamp ?? [];
    const q = chart.indicators?.quote?.[0] ?? {};

    const candles = timestamps
      .map((t, i) => ({
        time: t * 1000,
        open: q.open?.[i] as number,
        high: q.high?.[i] as number,
        low: q.low?.[i] as number,
        close: q.close?.[i] as number,
        volume: q.volume?.[i] as number,
      }))
      .filter(c => c.close != null);

    return NextResponse.json({ candles, meta: chart.meta });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
