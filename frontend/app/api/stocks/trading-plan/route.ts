import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function sma(arr: number[], n: number): number {
  if (arr.length < n) return NaN;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function ema(arr: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [arr[0]];
  for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k));
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
  return {
    k: ks[ks.length - 1],
    d: ks.slice(-dN).reduce((a, b) => a + b, 0) / Math.min(dN, ks.length),
  };
}

function findSwingPoints(data: number[], window = 3, type: 'high' | 'low'): number[] {
  const result: number[] = [];
  for (let i = window; i < data.length - window; i++) {
    const slice = data.slice(i - window, i + window + 1);
    if (type === 'high' && data[i] === Math.max(...slice)) result.push(data[i]);
    if (type === 'low' && data[i] === Math.min(...slice)) result.push(data[i]);
  }
  return [...new Set(result.map(v => Math.round(v * 100) / 100))];
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') || '';
  const name = req.nextUrl.searchParams.get('name') || symbol;
  if (!symbol) return NextResponse.json({ error: 'No symbol' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 未設定，請在 .env.local 加入您的 API Key' }, { status: 500 });

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d&includePrePost=false`,
      { headers: { 'User-Agent': UA } }
    );
    if (!res.ok) return NextResponse.json({ error: '無法取得股票資料' }, { status: 502 });

    const data = await res.json();
    const chart = data.chart?.result?.[0];
    if (!chart) return NextResponse.json({ error: '查無此股票' }, { status: 404 });

    const q = chart.indicators?.quote?.[0] ?? {};
    const closes: number[] = (q.close ?? []).filter((v: unknown) => typeof v === 'number');
    const highs: number[] = (q.high ?? []).filter((v: unknown) => typeof v === 'number');
    const lows: number[] = (q.low ?? []).filter((v: unknown) => typeof v === 'number');
    const volumes: number[] = (q.volume ?? []).filter((v: unknown) => typeof v === 'number');
    const meta = chart.meta;

    if (closes.length < 30) return NextResponse.json({ error: '歷史資料不足（需至少30筆）' }, { status: 422 });

    const currentPrice: number = meta.regularMarketPrice;
    const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? currentPrice;
    const change = currentPrice - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    const ma5 = sma(closes, 5);
    const ma10 = sma(closes, 10);
    const ma20 = sma(closes, 20);
    const ma60 = closes.length >= 60 ? sma(closes, 60) : NaN;
    const rsi = calcRSI(closes, 14);
    const { macd, signal, histogram } = calcMACD(closes);
    const { k, d } = calcStochastic(highs, lows, closes);

    const n60 = Math.min(closes.length, 60);
    const recentHighs = highs.slice(-n60);
    const recentLows = lows.slice(-n60);
    const high20 = Math.max(...highs.slice(-20));
    const low20 = Math.min(...lows.slice(-20));
    const high60 = Math.max(...recentHighs);
    const low60 = Math.min(...recentLows);
    const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
    const volRatio = volumes[volumes.length - 1] / avgVol20;

    const swingHighs = findSwingPoints(recentHighs, 3, 'high').sort((a, b) => b - a).slice(0, 5);
    const swingLows = findSwingPoints(recentLows, 3, 'low').sort((a, b) => a - b).slice(0, 5);

    const f = (n: number, d = 2) => isNaN(n) ? 'N/A' : n.toFixed(d);

    const prompt = `你是一位專業的股票技術分析師，擅長波段交易計畫制定。請根據以下技術數據，制定一份完整的交易計畫。
僅輸出純 JSON，不要有任何說明文字、markdown 代碼塊或其他格式。

## 股票資訊
代碼：${symbol}，名稱：${name}
目前股價：${f(currentPrice)}，今日漲跌：${change >= 0 ? '+' : ''}${f(change)}（${change >= 0 ? '+' : ''}${f(changePct, 2)}%）
今日量比（今量/20日均量）：${f(volRatio, 2)}x（>1為放量）

## 均線（以現價判斷多空排列）
MA5：${f(ma5)}，MA10：${f(ma10)}，MA20：${f(ma20)}，MA60：${isNaN(ma60) ? '資料不足' : f(ma60)}

## 技術指標
RSI14：${f(rsi, 1)}（>70超買，<30超賣，50以上偏多）
MACD：${f(macd)}，訊號線：${f(signal)}，柱狀：${f(histogram)}（正值偏多）
KD：K=${f(k, 1)}，D=${f(d, 1)}（>80超買，<20超賣）

## 近期高低點
20日高：${f(high20)}，20日低：${f(low20)}
60日高：${f(high60)}，60日低：${f(low60)}
近期波段高點（由高到低）：${swingHighs.map(v => f(v)).join('、') || '無顯著高點'}
近期波段低點（由低到高）：${swingLows.map(v => f(v)).join('、') || '無顯著低點'}

請根據以上數據，輸出下列 JSON 結構的交易計畫。注意：
1. 所有 price 欄位必須是數字（number），不能是字串
2. 支撐/壓力位要根據 MA 值、波段高低點、整數關卡合理計算
3. 多頭停損在支撐下方，目標在壓力位；空頭策略方向相反
4. 盈虧比至少1:2

{
  "trendDirection": "趨勢方向（4-8字，例如：短線強勢多頭、盤整蓄勢待發、空頭趨勢轉弱）",
  "trendAnalysis": ["均線排列分析","量價關係分析","技術指標分析","整體操作建議"],
  "keyLevels": {
    "breakoutAbove": 數字（突破確認價，通常等於近期高點）,
    "resistance1": 數字（比現價高的第一壓力）,
    "resistance2": 數字（比resistance1更高的第二壓力）,
    "support1": 數字（比現價低的第一支撐，優先用MA20或整數關卡）,
    "support2": 數字（比support1更低的第二支撐）,
    "strongSupport": 數字（最重要底部強力支撐，通常用MA60或波段低點）
  },
  "bullStrategy": {
    "condition": "做多前提（例如：站穩XX以上）",
    "entryRange": "XX~YY",
    "target1": 數字,
    "target2": 數字,
    "stopLoss": 數字
  },
  "bearStrategy": {
    "condition": "減碼或空頭前提（例如：跌破XX）",
    "entryRange": "XX~YY",
    "target1": 數字,
    "target2": 數字,
    "stopLoss": 數字
  },
  "riskManagement": ["單筆風險控制建議（含%）","停損執行原則","盈虧比建議（≥1:X）","重大訊息處理方式"],
  "entryPlan": [
    {
      "scenario": "多頭",
      "entryCondition": "進場條件",
      "entryRange": "XX~YY",
      "stopLoss": 數字,
      "target1": 數字,
      "target2": 數字,
      "rrRatio": "≥1:2"
    },
    {
      "scenario": "空頭",
      "entryCondition": "進場條件",
      "entryRange": "XX~YY",
      "stopLoss": 數字,
      "target1": 數字,
      "target2": 數字,
      "rrRatio": "≥1:2"
    }
  ],
  "executionDiscipline": ["紀律1","紀律2","紀律3","紀律4"],
  "observations": ["觀察重點1","觀察重點2","觀察重點3"],
  "notes": ["個股或產業特性備註","風險提示"]
}`;

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: 'AI 回應格式錯誤，請重試' }, { status: 500 });

    const plan = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ ...plan, symbol, name, currentPrice, change, changePct });

  } catch (err) {
    console.error('Trading plan error:', err);
    return NextResponse.json({ error: '伺服器錯誤，請稍後重試' }, { status: 500 });
  }
}
