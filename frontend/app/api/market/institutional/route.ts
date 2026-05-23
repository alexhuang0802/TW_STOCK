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

function parseYMD(ds: string): Date {
  return new Date(
    parseInt(ds.slice(0, 4)),
    parseInt(ds.slice(4, 6)) - 1,
    parseInt(ds.slice(6, 8))
  );
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

// ── T86 (外資 + 自營商 個股) ───────────────────────────────────────────────
// T86 cols: r[0]=代號 r[1]=名稱
//   外資(不含自營): r[2]=買進股數 r[3]=賣出股數 r[4]=淨買超
//   投信:           r[8]=買進     r[9]=賣出     r[10]=淨
//   自營商(自行):   r[11]=買進    r[12]=賣出    r[13]=淨
//   自營商(避險):   r[14]=買進    r[15]=賣出    r[16]=淨
async function fetchT86(date: string): Promise<string[][]> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
  if (!res.ok) return [];
  const j = await res.json();
  return j.data ?? [];
}

// ── Find latest T86 date with valid (non-zero) buy data ────────────────────
async function findLatestT86(startDateStr: string): Promise<{ date: string; rows: string[][] }> {
  const d = parseYMD(startDateStr);
  for (let i = 0; i < 7; i++) {
    const ds = dateStr(d);
    const rows = await fetchT86(ds);
    // Valid if we have many rows and some non-zero foreign buy (r[2])
    if (rows.length > 50 && rows.some(r => parseAmt(r[2]) > 0)) {
      return { date: ds, rows };
    }
    d.setDate(d.getDate() - 1);
  }
  return { date: startDateStr, rows: [] };
}

// ── Find latest TWT44U date with valid (non-zero) buy data ────────────────
async function findLatestTWT44U(startDateStr: string): Promise<{ date: string; rows: string[][] }> {
  const d = parseYMD(startDateStr);
  for (let i = 0; i < 7; i++) {
    const ds = dateStr(d);
    const rows = await fetchTWT44U(ds);
    // TWT44U: r[0]=" " r[1]=代號 r[2]=名稱 r[3]=買進股數 r[4]=賣出股數 r[5]=買賣超股數
    if (rows.length > 5 && rows.some(r => parseAmt(r[3]) > 0)) {
      return { date: ds, rows };
    }
    d.setDate(d.getDate() - 1);
  }
  return { date: startDateStr, rows: [] };
}

// ── Net maps for history check ─────────────────────────────────────────────
function netMapFrom44U(rows: string[][]): Map<string, number> {
  const m = new Map<string, number>();
  // TWT44U: r[0]=" " r[1]=代號 r[5]=買賣超股數
  rows.forEach(r => m.set(r[1].trim(), parseAmt(r[5])));
  return m;
}
function netMapForeignFromT86(rows: string[][]): Map<string, number> {
  const m = new Map<string, number>();
  rows.forEach(r => m.set(r[0].trim(), parseAmt(r[4]))); // col4 = 外資淨
  return m;
}
function netMapDealerFromT86(rows: string[][]): Map<string, number> {
  const m = new Map<string, number>();
  rows.forEach(r => {
    const net = parseAmt(r[13]) + parseAmt(r[16]);
    m.set(r[0].trim(), net);
  });
  return m;
}

// ── "新買進/新賣出" detection ──────────────────────────────────────────────
// 新買進: today net > 0, AND all reference dates had net <= 0
// 新賣出: today net < 0, AND all reference dates had net >= 0
function isNewBuy(netNow: number, refs: number[]): boolean {
  return netNow > 0 && refs.length > 0 && refs.every(n => n <= 0);
}
function isNewSell(netNow: number, refs: number[]): boolean {
  return netNow < 0 && refs.length > 0 && refs.every(n => n >= 0);
}

// ── Build top-5 lists ─────────────────────────────────────────────────────

interface StockRow { code: string; name: string; raw: number; label: string; isNew: boolean; }

function makeTop5(
  rows: string[][],
  buyCol: number,
  sellCol: number,
  netCol: number,
  refMaps: Map<string, number>[],
  codeCol = 0,
  nameCol = 1,
): { topBuy: StockRow[]; topSell: StockRow[] } {
  const parsed = rows.map(r => ({
    code: r[codeCol].trim(), name: r[nameCol].trim(),
    buyRaw:  parseAmt(r[buyCol]),
    sellRaw: parseAmt(r[sellCol]),
    netNow:  parseAmt(r[netCol]),
    refs: refMaps.map(m => m.get(r[codeCol].trim()) ?? 0),
  }));

  const topBuy = [...parsed]
    .filter(s => s.buyRaw > 0)
    .sort((a, b) => b.buyRaw - a.buyRaw)
    .slice(0, 5)
    .map(s => ({
      code: s.code, name: s.name, raw: s.buyRaw,
      label: fmtMoney(s.buyRaw),
      isNew: isNewBuy(s.netNow, s.refs),
    }));

  const topSell = [...parsed]
    .filter(s => s.sellRaw > 0)
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
    .filter(s => s.buyRaw > 0)
    .sort((a, b) => b.buyRaw - a.buyRaw)
    .slice(0, 5)
    .map(s => ({
      code: s.code, name: s.name, raw: s.buyRaw,
      label: fmtMoney(s.buyRaw),
      isNew: isNewBuy(s.netNow, s.refs),
    }));

  const topSell = [...parsed]
    .filter(s => s.sellRaw > 0)
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

  // 1. Find latest BFI82U summary date
  const { date: latestDate, rows: summaryRows } = await findLatestSummary(today);

  // 2. Find latest T86 and TWT44U dates with valid data — run in parallel
  const [
    { date: t86Date, rows: t86Today },
    { date: trustDate, rows: trust44U },
  ] = await Promise.all([
    findLatestT86(latestDate),
    findLatestTWT44U(latestDate),
  ]);

  // 3. Compute reference dates (~5 and ~10 trading days ago via calendar offset)
  const t86Ref5Date   = dateStr(shiftDays(parseYMD(t86Date),   -7));
  const t86Ref10Date  = dateStr(shiftDays(parseYMD(t86Date),  -14));
  const trustRef5Date  = dateStr(shiftDays(parseYMD(trustDate), -7));
  const trustRef10Date = dateStr(shiftDays(parseYMD(trustDate), -14));

  // 4. Fetch all reference data concurrently
  const [trustRef5, trustRef10, t86Ref5, t86Ref10] = await Promise.all([
    fetchTWT44U(trustRef5Date),
    fetchTWT44U(trustRef10Date),
    fetchT86(t86Ref5Date),
    fetchT86(t86Ref10Date),
  ]);

  // ── Summary ──────────────────────────────────────────────────────────────
  const summary = { foreign: 0, trust: 0, dealer: 0, total: 0 };
  for (const row of summaryRows) {
    const name: string = row[0];
    const net = parseAmt(row[3]);
    if (name.includes('外資') && !name.includes('自營')) summary.foreign += net;
    else if (name.includes('投信')) summary.trust += net;
    else if (name.includes('自營商')) summary.dealer += net;
  }
  summary.total = summary.foreign + summary.trust + summary.dealer;

  // ── Build top lists ───────────────────────────────────────────────────────
  const trustRefMaps   = [netMapFrom44U(trustRef5),       netMapFrom44U(trustRef10)];
  const foreignRefMaps = [netMapForeignFromT86(t86Ref5),  netMapForeignFromT86(t86Ref10)];
  const dealerRefMaps  = [netMapDealerFromT86(t86Ref5),   netMapDealerFromT86(t86Ref10)];

  // TWT44U cols: r[0]=" " r[1]=代號 r[2]=名稱 r[3]=買進股數 r[4]=賣出股數 r[5]=買賣超股數
  const trust   = trust44U.length > 0 ? makeTop5(trust44U, 3, 4, 5, trustRefMaps, 1, 2) : { topBuy: [], topSell: [] };
  const foreign = t86Today.length  > 0 ? makeTop5(t86Today, 2, 3, 4, foreignRefMaps)    : { topBuy: [], topSell: [] };
  const dealer  = t86Today.length  > 0 ? makeTop5Dealer(t86Today, dealerRefMaps)        : { topBuy: [], topSell: [] };

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
