import { NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function parseAmount(s: string): number {
  return parseInt((s ?? '').replace(/,/g, ''), 10) || 0;
}

function fmtBillion(n: number): string {
  const b = n / 1e8;
  return (b >= 0 ? '+' : '') + b.toFixed(2) + '億';
}

function fmtShares(n: number): string {
  return (n >= 0 ? '+' : '') + n.toLocaleString() + '股';
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

// T86 column indices:
// r[0]=代號 r[1]=名稱
// r[2]=外資買進 r[3]=外資賣出 r[4]=外資淨
// r[5]=外資自營商買進 r[6]=外資自營商賣出 r[7]=外資自營商淨
// r[8]=投信買進 r[9]=投信賣出 r[10]=投信淨
// r[11]=自營商(自行)買進 r[12]=自營商(自行)賣出 r[13]=自營商(自行)淨
// r[14]=自營商(避險)買進 r[15]=自營商(避險)賣出 r[16]=自營商(避險)淨
// r[17]=三大法人淨

interface PrevEntry { foreignNet: number; trustNet: number; dealerNet: number; }

async function fetchT86WithDetail(date: string): Promise<Map<string, PrevEntry>> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return new Map();
  const d = await res.json();
  const map = new Map<string, PrevEntry>();
  for (const r of d.data ?? []) {
    map.set(r[0], {
      foreignNet: parseAmount(r[4]),
      trustNet:   parseAmount(r[10]),
      dealerNet:  parseAmount(r[13]) + parseAmount(r[16]),
    });
  }
  return map;
}

type StockRow = { code: string; name: string; raw: number; label: string; isNew: boolean };

function makeTopLists(rows: string[][], buyCol: number, sellCol: number, netCol: number,
  prevMap: Map<string, PrevEntry>, getNet: (e: PrevEntry) => number
): { topBuy: StockRow[]; topSell: StockRow[] } {
  const parsed = rows.map(r => ({
    code: r[0], name: r[1],
    buyRaw:  parseAmount(r[buyCol]),
    sellRaw: parseAmount(r[sellCol]),
    netNow:  parseAmount(r[netCol]),
    prevNet: getNet(prevMap.get(r[0]) ?? { foreignNet: 0, trustNet: 0, dealerNet: 0 }),
  }));

  const topBuy = [...parsed]
    .sort((a, b) => b.buyRaw - a.buyRaw)
    .slice(0, 5)
    .map(s => ({
      code: s.code, name: s.name, raw: s.buyRaw,
      label: fmtShares(s.buyRaw),
      isNew: s.netNow > 0 && s.prevNet <= 0,
    }));

  const topSell = [...parsed]
    .sort((a, b) => b.sellRaw - a.sellRaw)
    .slice(0, 5)
    .map(s => ({
      code: s.code, name: s.name, raw: s.sellRaw,
      label: fmtShares(s.sellRaw),
      isNew: s.netNow < 0 && s.prevNet >= 0,
    }));

  return { topBuy, topSell };
}

export async function GET() {
  const today = new Date();

  // Find latest available trading date
  const { date: latestDate, data: summaryRows } = await findLatestTradingDate(today);

  // ~10 trading days ago ≈ 14 calendar days before latest date
  const prevDate = new Date(
    parseInt(latestDate.slice(0, 4)),
    parseInt(latestDate.slice(4, 6)) - 1,
    parseInt(latestDate.slice(6, 8))
  );
  prevDate.setDate(prevDate.getDate() - 14);

  // Fetch T86 for latest date and comparison date
  const [topRes, prevMap] = await Promise.all([
    fetch(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${latestDate}&selectType=ALLBUT0999&response=json`,
      { headers: { 'User-Agent': UA } }),
    fetchT86WithDetail(dateStr(prevDate)),
  ]);

  // ── Summary ──────────────────────────────────────────────────────────────
  let summary = { foreign: 0, trust: 0, dealer: 0, total: 0, date: latestDate };
  for (const row of summaryRows as string[][]) {
    const name: string = row[0];
    const net = parseAmount(row[3]);
    if (name.includes('外資') && !name.includes('自營')) summary.foreign += net;
    else if (name.includes('投信')) summary.trust += net;
    else if (name.includes('自營商')) summary.dealer += net;
  }
  summary.total = summary.foreign + summary.trust + summary.dealer;

  // ── Individual stock top buys / sells by institution ─────────────────────
  let foreign = { topBuy: [] as StockRow[], topSell: [] as StockRow[] };
  let trust   = { topBuy: [] as StockRow[], topSell: [] as StockRow[] };
  let dealer  = { topBuy: [] as StockRow[], topSell: [] as StockRow[] };

  if (topRes.ok) {
    const d = await topRes.json();
    const rows: string[][] = d.data ?? [];

    foreign = makeTopLists(rows, 2, 3, 4,  prevMap, e => e.foreignNet);
    trust   = makeTopLists(rows, 8, 9, 10, prevMap, e => e.trustNet);
    // 自營商: combine 自行買賣 (cols 11,12,13) + 避險 (cols 14,15,16)
    dealer  = makeTopLists(rows, 11, 12, 13, prevMap, e => e.dealerNet);
  }

  return NextResponse.json({
    summary: {
      date: latestDate,
      foreign: fmtBillion(summary.foreign), foreignRaw: summary.foreign,
      trust:   fmtBillion(summary.trust),   trustRaw:   summary.trust,
      dealer:  fmtBillion(summary.dealer),  dealerRaw:  summary.dealer,
      total:   fmtBillion(summary.total),   totalRaw:   summary.total,
    },
    foreign,
    trust,
    dealer,
  });
}
