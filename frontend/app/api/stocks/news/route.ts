import { NextRequest, NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') || '';
  if (!symbol) return NextResponse.json([]);

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=6&quotesCount=0&listsCount=0`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return NextResponse.json([]);

    const data = await res.json();
    return NextResponse.json(data.news ?? []);
  } catch {
    return NextResponse.json([]);
  }
}
