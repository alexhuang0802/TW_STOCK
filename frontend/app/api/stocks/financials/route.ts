import { NextRequest, NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const fmtB = (n: number) => {
  if (!n || isNaN(n)) return 'N/A';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  return n.toFixed(0);
};
const fmtPct = (n: number) => (!n || isNaN(n)) ? 'N/A' : (n * 100).toFixed(2) + '%';
const fmtNum = (n: number, d = 2) => (!n || isNaN(n)) ? 'N/A' : n.toFixed(d);

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') || '';
  if (!symbol) return NextResponse.json({ error: 'No symbol' }, { status: 400 });

  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,defaultKeyStatistics,summaryDetail`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return NextResponse.json({ error: 'Upstream error' }, { status: 502 });

    const data = await res.json();
    const r = data.quoteSummary?.result?.[0];
    if (!r) return NextResponse.json({ error: 'No data' }, { status: 404 });

    const fin = r.financialData ?? {};
    const stats = r.defaultKeyStatistics ?? {};
    const summary = r.summaryDetail ?? {};

    return NextResponse.json({
      marketCap: fmtB(summary.marketCap?.raw),
      trailingPE: fmtNum(summary.trailingPE?.raw),
      forwardPE: fmtNum(stats.forwardPE?.raw),
      eps: fmtNum(stats.trailingEps?.raw),
      revenue: fmtB(fin.totalRevenue?.raw),
      revenueGrowth: fmtPct(fin.revenueGrowth?.raw),
      grossMargin: fmtPct(fin.grossMargins?.raw),
      profitMargin: fmtPct(fin.profitMargins?.raw),
      roe: fmtPct(fin.returnOnEquity?.raw),
      roa: fmtPct(fin.returnOnAssets?.raw),
      debtToEquity: fmtNum(fin.debtToEquity?.raw),
      currentRatio: fmtNum(fin.currentRatio?.raw),
      priceToBook: fmtNum(stats.priceToBook?.raw),
      dividendYield: fmtPct(summary.dividendYield?.raw),
      beta: fmtNum(summary.beta?.raw),
      shortRatio: fmtNum(stats.shortRatio?.raw),
    });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
