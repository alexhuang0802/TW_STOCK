import { NextRequest, NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ── Indicator math ────────────────────────────────────────────────────────

function sma(arr: number[], n: number): number {
  const s = arr.slice(-n);
  if (s.length < n) return NaN;
  return s.reduce((a, b) => a + b, 0) / n;
}

function ema(arr: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    out.push(arr[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function calcRSI(closes: number[], n = 14): number {
  if (closes.length < n + 1) return NaN;
  const diffs = closes.slice(1).map((c, i) => c - closes[i]);
  const recent = diffs.slice(-n);
  const avgGain = recent.filter(d => d > 0).reduce((a, b) => a + b, 0) / n;
  const avgLoss = recent.filter(d => d < 0).reduce((a, b) => a + Math.abs(b), 0) / n;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcMACD(closes: number[]) {
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = e12.map((v, i) => v - e26[i]);
  const signalLine = ema(macdLine.slice(25), 9);
  const last = macdLine[macdLine.length - 1];
  const sig = signalLine[signalLine.length - 1];
  return { macd: last, signal: sig, histogram: last - sig };
}

function calcStochastic(highs: number[], lows: number[], closes: number[], kN = 14, dN = 3) {
  const ks: number[] = [];
  for (let i = kN - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kN + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kN + 1, i + 1));
    ks.push(hh === ll ? 50 : (closes[i] - ll) / (hh - ll) * 100);
  }
  const k = ks[ks.length - 1];
  const d = ks.slice(-dN).reduce((a, b) => a + b, 0) / Math.min(dN, ks.length);
  return { k, d };
}

function calcVolatility(closes: number[]): number {
  const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 252) * 100;
}

function calcMaxDrawdown(closes: number[]): number {
  let peak = closes[0];
  let maxDD = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak * 100;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

// ── Route ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') || '';
  if (!symbol) return NextResponse.json({ error: 'No symbol' }, { status: 400 });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d&includePrePost=false`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return NextResponse.json({ error: 'Upstream error' }, { status: 502 });

    const data = await res.json();
    const chart = data.chart?.result?.[0];
    if (!chart) return NextResponse.json({ error: 'No data' }, { status: 404 });

    const q = chart.indicators?.quote?.[0] ?? {};
    const closes: number[] = (q.close ?? []).filter((v: number | null) => v != null);
    const highs: number[] = (q.high ?? []).filter((v: number | null) => v != null);
    const lows: number[] = (q.low ?? []).filter((v: number | null) => v != null);
    const volumes: number[] = (q.volume ?? []).filter((v: number | null) => v != null);
    const meta = chart.meta;

    if (closes.length < 14) return NextResponse.json({ error: 'Insufficient data' }, { status: 422 });

    const sma5Val = sma(closes, 5);
    const sma20Val = sma(closes, 20);
    const rsi14Val = calcRSI(closes, 14);
    const { macd: macdVal, signal: macdSig, histogram: macdHist } = calcMACD(closes);
    const { k: kdK, d: kdD } = calcStochastic(highs, lows, closes);
    const volPct = calcVolatility(closes);
    const maxDD = calcMaxDrawdown(closes);

    const currentPrice = meta.regularMarketPrice as number;
    const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
    const todayVol = volumes[volumes.length - 1];
    const volRatio = todayVol / avgVol20;
    const distSma20 = sma20Val ? (currentPrice - sma20Val) / sma20Val * 100 : NaN;

    const fmt = (n: number, d = 2) => isNaN(n) ? 'N/A' : n.toFixed(d);
    const fmtSign = (n: number, d = 1) => isNaN(n) ? 'N/A' : (n >= 0 ? '+' : '') + n.toFixed(d) + '%';

    return NextResponse.json({
      sma5: fmt(sma5Val),
      sma20: fmt(sma20Val),
      rsi14: fmt(rsi14Val, 1),
      macd: fmt(macdVal),
      macdSignal: fmt(macdSig),
      macdHist: fmt(macdHist),
      kdK: fmt(kdK, 1),
      kdD: fmt(kdD, 1),
      volatility: fmt(volPct, 1) + '%',
      maxDrawdown: fmt(maxDD, 1) + '%',
      volRatio: fmt(volRatio, 2) + 'x',
      distSma20: fmtSign(distSma20),
      intraRange: `${fmt(meta.regularMarketDayLow)} - ${fmt(meta.regularMarketDayHigh)}`,
      weekRange: `${fmt(meta.fiftyTwoWeekLow)} - ${fmt(meta.fiftyTwoWeekHigh)}`,
    });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
