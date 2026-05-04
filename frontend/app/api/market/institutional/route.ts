import { NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function parseAmount(s: string): number {
  return parseInt(s.replace(/,/g, ''), 10) || 0;
}

function fmtBillion(n: number): string {
  const b = n / 1e8;
  return (b >= 0 ? '+' : '') + b.toFixed(2) + '億';
}

function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// Step back by calendar days until we get a date with actual TWSE data
async function findLatestTradingDate(startDate: Date, maxTries = 5): Promise<{ date: string; data: unknown[] }> {
  const d = new Date(startDate);
  for (let i = 0; i < maxTries; i++) {
    const ds = dateStr(d);
    const url = `https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day&date=${ds}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const json = await res.json();
      if ((json.data ?? []).length > 0) return { date: ds, data: json.data };
    }
    d.setDate(d.getDate() - 1);
  }
  return { date: dateStr(startDate), data: [] };
}

// Fetch T86 data (individual stock institutional flow) for a given date
async function fetchT86(date: string): Promise<Map<string, number>> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return new Map();
  const d = await res.json();
  const map = new Map<string, number>();
  for (const r of d.data ?? []) {
    const code: string = r[0];
    // col 16 = 三大法人合計買賣超股數
    const net = parseAmount(r[16] ?? '0');
    map.set(code, net);
  }
  return map;
}

export async function GET() {
  const today = new Date();
  // Find latest available trading date (falls back to yesterday if today has no data yet)
  const { date: latestDate, data: summaryRows } = await findLatestTradingDate(today);

  // ~10 trading days ago ≈ 14 calendar days before latest date
  const prevDate = new Date(
    parseInt(latestDate.slice(0, 4)),
    parseInt(latestDate.slice(4, 6)) - 1,
    parseInt(latestDate.slice(6, 8))
  );
  prevDate.setDate(prevDate.getDate() - 14);
  const prevStr = dateStr(prevDate);

  // Fetch T86 for comparison date (10 trading days ago)
  const prevMap = await fetchT86(prevStr);

  // ── Summary (三大法人總表) ──────────────────────────────
  let summary = { foreign: 0, trust: 0, dealer: 0, total: 0, date: latestDate };
  for (const row of summaryRows as string[][]) {
    const name: string = row[0];
    const net = parseAmount(row[3]);
    if (name.includes('外資') && !name.includes('自營')) summary.foreign += net;
    else if (name.includes('投信')) summary.trust += net;
    else if (name.includes('自營商')) summary.dealer += net;
  }
  summary.total = summary.foreign + summary.trust + summary.dealer;

  // ── Individual stock top buys / sells ──────────────────
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${latestDate}&selectType=ALLBUT0999&response=json`;
  const topRes = await fetch(url, { headers: { 'User-Agent': UA } });

  let topBuy: { code: string; name: string; net: string; netRaw: number; isNew: boolean }[] = [];
  let topSell: { code: string; name: string; net: string; netRaw: number; isNew: boolean }[] = [];

  if (topRes.ok) {
    const d = await topRes.json();
    type Row = string[];
    const rows: Row[] = d.data ?? [];
    const stocks = rows.map(r => {
      const code = r[0];
      const name = r[1];
      const netRaw = parseAmount(r[16] ?? '0');
      const prevNet = prevMap.get(code) ?? 0;
      // "新買進": buying today but was selling (or zero) 10 days ago
      // "新賣出": selling today but was buying (or zero) 10 days ago
      const isNew = netRaw > 0 ? prevNet <= 0 : prevNet >= 0;
      return { code, name, netRaw, net: '', isNew };
    }).filter(s => !isNaN(s.netRaw));

    stocks.sort((a, b) => b.netRaw - a.netRaw);

    topBuy = stocks.slice(0, 5).map(s => ({
      ...s,
      net: (s.netRaw >= 0 ? '+' : '') + s.netRaw.toLocaleString(),
    }));
    topSell = stocks.slice(-5).reverse().map(s => ({
      ...s,
      net: s.netRaw.toLocaleString(),
    }));
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
}
