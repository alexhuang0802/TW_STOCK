import { NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function parseAmt(s: string): number {
  return parseInt((s ?? '').replace(/,/g, ''), 10) || 0;
}

function fmtBillion(n: number): string {
  const b = n / 1e8;
  return (b >= 0 ? '+' : '') + b.toFixed(2) + '億';
}

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1e8) return (n >= 0 ? '+' : '') + (n / 1e8).toFixed(2) + '億';
  if (Math.abs(n) >= 1e4) return (n >= 0 ? '+' : '') + (n / 1e4).toFixed(1) + '萬';
  return String(n);
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDays(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + delta);
  return d;
}

// 週六/週日 → 往回推到上週五
function lastWeekday(d: Date): Date {
  const r = new Date(d);
  const dow = r.getDay();
  if (dow === 0) r.setDate(r.getDate() - 2);
  else if (dow === 6) r.setDate(r.getDate() - 1);
  return r;
}

// ── 三大法人彙總 (BFI82U) ───────────────────────────────────────────────────
async function findLatestSummary(startDate: Date): Promise<{ date: string; rows: string[][] }> {
  const d = lastWeekday(new Date(startDate));
  for (let i = 0; i < 10; i++) {
    // 跳過週末
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    const ds = dateStr(d);
    const url = `https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day&date=${ds}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        if ((j.data ?? []).length > 0) return { date: ds, rows: j.data };
      }
    } catch { /* ignore network errors */ }
    d.setDate(d.getDate() - 1);
  }
  return { date: dateStr(lastWeekday(startDate)), rows: [] };
}

// ── 投信 TWT44U (金額) ─────────────────────────────────────────────────────
// fields: r[0]=代號 r[1]=名稱 r[2]=買進金額 r[3]=賣出金額 r[4]=買賣超金額
async function fetchTWT44U(date: string): Promise<string[][]> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/TWT44U?date=${date}&response=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
  if (!res.ok) return [];
  const j = await res.json();
  return j.data ?? [];
}

// ── 外資 T86 (股數) ────────────────────────────────────────────────────────
// T86 cols: r[2]=外資買進 r[3]=外資賣出 r[4]=外資淨 (不含外資自營商)
// reuse fetchT86Dealer, just need the same data
async function fetchT86Foreign(date: string): Promise<string[][]> {
  return fetchT86Dealer(date); // same endpoint, different columns used
}

// ── 自營商 T86 ─────────────────────────────────────────────────────────────
// T86 cols: r[0]=代號 r[1]=名稱
// 自行: r[11]=買 r[12]=賣 r[13]=淨  避險: r[14]=買 r[15]=賣 r[16]=淨
async function fetchT86Dealer(date: string): Promise<string[][]> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
  if (!res.ok) return [];
  const j = await res.json();
  return j.data ?? [];
}

// ── Net maps for history check ─────────────────────────────────────────────
function netMapFrom44U(rows: string[][]): Map<string, number> {
  const m = new Map<string, number>();
  rows.forEach(r => m.set(r[0], parseAmt(r[4])));
  return m;
}
function netMapForeignFromT86(rows: string[][]): Map<string, number> {
  const m = new Map<string, number>();
  rows.forEach(r => m.set(r[0], parseAmt(r[4]))); // col4 = 外資淨
  return m;
}
function netMapDealerFromT86(rows: string[][]): Map<string, number> {
  const m = new Map<string, number>();
  rows.forEach(r => {
    const net = parseAmt(r[13]) + parseAmt(r[16]);
    m.set(r[0], net);
  });
  return m;
}

// ── "新買進/新賣出" detection ──────────────────────────────────────────────
// 新買進: today net > 0, AND all reference dates had net <= 0
// 新賣出: today net <= 0, AND all reference dates had net >= 0
function isNewBuy(netNow: number, refs: number[]): boolean {
  return netNow > 0 && refs.every(n => n <= 0);
}
function isNewSell(netNow: number, refs: number[]): boolean {
  return netNow < 0 && refs.every(n => n >= 0);
}

// ── Build top-5 lists ─────────────────────────────────────────────────────

interface StockRow { code: string; name: string; raw: number; label: string; isNew: boolean; }

function makeTop5(
  rows: string[][],
  buyCol: number,
  sellCol: number,
  netCol: number,
  refMaps: Map<string, number>[],
): { topBuy: StockRow[]; topSell: StockRow[] } {
  const parsed = rows.map(r => ({
    code: r[0], name: r[1],
    buyRaw:  parseAmt(r[buyCol]),
    sellRaw: parseAmt(r[sellCol]),
    netNow:  parseAmt(r[netCol]),
    refs: refMaps.map(m => m.get(r[0]) ?? 0),
  }));

  const topBuy = [...parsed]
    .sort((a, b) => b.buyRaw - a.buyRaw)
    .slice(0, 5)
    .map(s => ({
      code: s.code, name: s.name, raw: s.buyRaw,
      label: fmtMoney(s.buyRaw),
      isNew: isNewBuy(s.netNow, s.refs),
    }));

  const topSell = [...parsed]
    .sort((a, b) => b.sellRaw - a.sellRaw)
    .slice(0, 5)
    .map(s => ({
      code: s.code, name: s.name, raw: s.sellRaw,
      label: fmtMoney(s.sellRaw),
      isNew: isNewSell(s.netNow, s.refs),
    }));

  return { topBuy, topSell };
}

function makeTop5Dealer(
  rows: string[][],
  refMaps: Map<string, number>[],
): { topBuy: StockRow[]; topSell: StockRow[] } {
  const parsed = rows.map(r => ({
    code: r[0], name: r[1],
    // 自行買賣 + 避險
    buyRaw:  parseAmt(r[11]) + parseAmt(r[14]),
    sellRaw: parseAmt(r[12]) + parseAmt(r[15]),
    netNow:  parseAmt(r[13]) + parseAmt(r[16]),
    refs: refMaps.map(m => m.get(r[0]) ?? 0),
  }));

  const topBuy = [...parsed]
    .sort((a, b) => b.buyRaw - a.buyRaw)
    .slice(0, 5)
    .map(s => ({
      code: s.code, name: s.name, raw: s.buyRaw,
      label: fmtMoney(s.buyRaw),
      isNew: isNewBuy(s.netNow, s.refs),
    }));

  const topSell = [...parsed]
    .sort((a, b) => b.sellRaw - a.sellRaw)
    .slice(0, 5)
    .map(s => ({
      code: s.code, name: s.name, raw: s.sellRaw,
      label: fmtMoney(s.sellRaw),
      isNew: isNewSell(s.netNow, s.refs),
    }));

  return { topBuy, topSell };
}

// ── Route ─────────────────────────────────────────────────────────────────

export async function GET() {
  const today = new Date();

  // Find latest trading date with summary data
  const { date: latestDate, rows: summaryRows } = await findLatestSummary(today);

  // Reference dates: ~5 and ~10 trading days ago (7 and 14 calendar days)
  const ref5Date  = dateStr(shiftDays(new Date(
    parseInt(latestDate.slice(0,4)),
    parseInt(latestDate.slice(4,6))-1,
    parseInt(latestDate.slice(6,8))
  ), -7));
  const ref10Date = dateStr(shiftDays(new Date(
    parseInt(latestDate.slice(0,4)),
    parseInt(latestDate.slice(4,6))-1,
    parseInt(latestDate.slice(6,8))
  ), -14));

  // Fetch all data concurrently
  const [
    trust44U, trustRef5, trustRef10,
    t86Today, t86Ref5, t86Ref10,
  ] = await Promise.all([
    fetchTWT44U(latestDate),
    fetchTWT44U(ref5Date),
    fetchTWT44U(ref10Date),
    fetchT86Dealer(latestDate),   // used for both 外資 and 自營商
    fetchT86Dealer(ref5Date),
    fetchT86Dealer(ref10Date),
  ]);

  // ── Summary ──────────────────────────────────────────────────────────────
  let summary = { foreign: 0, trust: 0, dealer: 0, total: 0 };
  for (const row of summaryRows) {
    const name: string = row[0];
    const net = parseAmt(row[3]);
    if (name.includes('外資') && !name.includes('自營')) summary.foreign += net;
    else if (name.includes('投信')) summary.trust += net;
    else if (name.includes('自營商')) summary.dealer += net;
  }
  summary.total = summary.foreign + summary.trust + summary.dealer;

  // ── Build top lists ───────────────────────────────────────────────────────
  const trustRefMaps   = [netMapFrom44U(trustRef5),         netMapFrom44U(trustRef10)];
  const foreignRefMaps = [netMapForeignFromT86(t86Ref5),    netMapForeignFromT86(t86Ref10)];
  const dealerRefMaps  = [netMapDealerFromT86(t86Ref5),     netMapDealerFromT86(t86Ref10)];

  // 外資: T86 cols r[2]=買進股數 r[3]=賣出股數 r[4]=淨
  const trust   = trust44U.length > 0 ? makeTop5(trust44U, 2, 3, 4, trustRefMaps)  : { topBuy: [], topSell: [] };
  const foreign = t86Today.length  > 0 ? makeTop5(t86Today, 2, 3, 4, foreignRefMaps) : { topBuy: [], topSell: [] };
  const dealer  = t86Today.length  > 0 ? makeTop5Dealer(t86Today, dealerRefMaps)      : { topBuy: [], topSell: [] };

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
