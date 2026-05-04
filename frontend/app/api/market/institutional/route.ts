import { NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function parseAmount(s: string): number {
  return parseInt(s.replace(/,/g, ''), 10) || 0;
}

function fmtBillion(n: number): string {
  const b = n / 1e8;
  return (b >= 0 ? '+' : '') + b.toFixed(2) + '億';
}

export async function GET() {
  try {
    // 三大法人總表
    const summaryUrl = 'https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day';
    const summaryRes = await fetch(summaryUrl, { headers: { 'User-Agent': UA }, next: { revalidate: 300 } });

    let summary = { foreign: 0, trust: 0, dealer: 0, total: 0, date: '' };
    if (summaryRes.ok) {
      const d = await summaryRes.json();
      summary.date = d.date ?? '';
      for (const row of d.data ?? []) {
        const name: string = row[0];
        const net = parseAmount(row[3]);
        if (name.includes('外資') && !name.includes('自營')) summary.foreign += net;
        else if (name.includes('投信')) summary.trust += net;
        else if (name.includes('自營商')) summary.dealer += net;
      }
      summary.total = summary.foreign + summary.trust + summary.dealer;
    }

    // 個股三大法人 top buys/sells (外資)
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;

    const topUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${dateStr}&selectType=ALLBUT0999&response=json`;
    const topRes = await fetch(topUrl, { headers: { 'User-Agent': UA }, next: { revalidate: 300 } });

    let topBuy: { code: string; name: string; net: string; netRaw: number }[] = [];
    let topSell: { code: string; name: string; net: string; netRaw: number }[] = [];

    if (topRes.ok) {
      const d = await topRes.json();
      const rows: [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string][] = d.data ?? [];
      const stocks = rows.map(r => ({
        code: r[0],
        name: r[1],
        // col index 10 = 外資買賣超股數, col 12 = 投信, col 14 = 自營商, col 16 = 三大合計
        netRaw: parseAmount(r[16] ?? '0'),
        net: '',
      })).filter(s => !isNaN(s.netRaw));

      stocks.sort((a, b) => b.netRaw - a.netRaw);
      topBuy = stocks.slice(0, 10).map(s => ({ ...s, net: (s.netRaw >= 0 ? '+' : '') + s.netRaw.toLocaleString() }));
      topSell = stocks.slice(-10).reverse().map(s => ({ ...s, net: s.netRaw.toLocaleString() }));
    }

    return NextResponse.json({
      summary: {
        date: summary.date,
        foreign: fmtBillion(summary.foreign),
        foreignRaw: summary.foreign,
        trust: fmtBillion(summary.trust),
        trustRaw: summary.trust,
        dealer: fmtBillion(summary.dealer),
        dealerRaw: summary.dealer,
        total: fmtBillion(summary.total),
        totalRaw: summary.total,
      },
      topBuy,
      topSell,
    });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
