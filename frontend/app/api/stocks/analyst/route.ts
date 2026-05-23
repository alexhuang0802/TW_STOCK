import { NextRequest, NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── Crumb cache (valid ~24h) ───────────────────────────────────────────────
let crumbCache: { crumb: string; cookies: string; expiresAt: number } | null = null;

async function getCrumb(): Promise<{ crumb: string; cookies: string } | null> {
  if (crumbCache && Date.now() < crumbCache.expiresAt) {
    return { crumb: crumbCache.crumb, cookies: crumbCache.cookies };
  }

  try {
    // Step 1: hit Yahoo Finance to get session cookies
    const pageRes = await fetch('https://finance.yahoo.com/quote/AAPL', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
    });
    const cookies = (pageRes.headers.get('set-cookie') ?? '')
      .split(/,(?=[^;]+?=)/)
      .map(c => c.split(';')[0].trim())
      .join('; ');

    // Step 2: fetch crumb
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, 'Cookie': cookies },
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes('{')) return null;

    crumbCache = { crumb, cookies, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
    return { crumb, cookies };
  } catch {
    return null;
  }
}

// ── Recommendation key → Chinese label ────────────────────────────────────
function recLabel(key: string, mean: number): { text: string; color: string } {
  if (key === 'strong_buy' || mean <= 1.5)  return { text: '強力買入', color: 'text-emerald-400' };
  if (key === 'buy'         || mean <= 2.5)  return { text: '買入',     color: 'text-green-400'   };
  if (key === 'hold'        || mean <= 3.5)  return { text: '中立',     color: 'text-yellow-400'  };
  if (key === 'sell'        || mean <= 4.5)  return { text: '賣出',     color: 'text-orange-400'  };
  return                                            { text: '強力賣出', color: 'text-red-400'     };
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol) return NextResponse.json({ error: 'missing symbol' }, { status: 400 });

  const auth = await getCrumb();
  if (!auth) return NextResponse.json({ error: 'crumb unavailable' }, { status: 503 });

  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData%2CrecommendationTrend&crumb=${encodeURIComponent(auth.crumb)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Cookie': auth.cookies },
  });

  if (!res.ok) return NextResponse.json({ error: `yahoo ${res.status}` }, { status: res.status });

  const json = await res.json();
  const result = json.quoteSummary?.result?.[0];
  if (!result) return NextResponse.json({ error: 'no data' }, { status: 404 });

  const fd = result.financialData ?? {};
  const rt = result.recommendationTrend?.trend ?? [];
  const latest = rt[0] ?? {};

  const targetHigh   = fd.targetHighPrice?.raw   ?? null;
  const targetLow    = fd.targetLowPrice?.raw    ?? null;
  const targetMean   = fd.targetMeanPrice?.raw   ?? null;
  const targetMedian = fd.targetMedianPrice?.raw ?? null;
  const recMean      = fd.recommendationMean?.raw ?? 3;
  const recKey       = fd.recommendationKey ?? 'hold';
  const numAnalysts  = fd.numberOfAnalystOpinions?.raw ?? 0;
  const currentPrice = fd.currentPrice?.raw ?? null;
  const currency     = fd.financialCurrency ?? '';

  const upside = (targetMean && currentPrice)
    ? ((targetMean - currentPrice) / currentPrice * 100)
    : null;

  const { text: recText, color: recColor } = recLabel(recKey, recMean);

  // Trend counts (current month)
  const counts = {
    strongBuy:  latest.strongBuy  ?? 0,
    buy:        latest.buy        ?? 0,
    hold:       latest.hold       ?? 0,
    sell:       latest.sell       ?? 0,
    strongSell: latest.strongSell ?? 0,
  };

  return NextResponse.json({
    symbol,
    targetHigh, targetLow, targetMean, targetMedian,
    recMean, recKey, recText, recColor,
    numAnalysts, currentPrice, currency, upside,
    counts,
  });
}
