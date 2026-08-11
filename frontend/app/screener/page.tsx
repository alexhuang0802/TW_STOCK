'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

interface ScanRow {
  股票代號: string;
  名稱: string;
  市場: string;
  族群: string;
  價格: number;
  扣低狀態: string;
  '嚴選多頭(B)': string;
  '漲幅(%)': number;
  '量縮(%)': number | null;
}

interface ScanData {
  updated_at: string;
  results: ScanRow[];
}

const VOL_SHRINK_MIN = 40;
const VOL_SHRINK_MAX = 60;
const isVolShrink = (pct: number | null | undefined) =>
  pct != null && pct >= VOL_SHRINK_MIN && pct <= VOL_SHRINK_MAX;

const ALL = '全部';

export default function ScreenerPage() {
  const [data, setData] = useState<ScanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [volMin, setVolMin] = useState('');
  const [volMax, setVolMax] = useState('');
  const [market, setMarket] = useState(ALL);
  const [industry, setIndustry] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  useEffect(() => {
    fetch('/scan-results.json', { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const rows = data?.results ?? [];
  const bCount = rows.filter(r => r['嚴選多頭(B)']).length;
  const volShrinkCount = rows.filter(r => isVolShrink(r['量縮(%)'])).length;

  const markets   = useMemo(() => Array.from(new Set(rows.map(r => r.市場))).sort(), [rows]);
  const industries = useMemo(() => Array.from(new Set(rows.map(r => r.族群))).sort(), [rows]);
  const statuses  = useMemo(() => Array.from(new Set(rows.map(r => r.扣低狀態))).sort(), [rows]);

  const filteredRows = useMemo(() => {
    const pMin = parseFloat(priceMin), pMax = parseFloat(priceMax);
    const vMin = parseFloat(volMin), vMax = parseFloat(volMax);
    return rows.filter(r => {
      if (!Number.isNaN(pMin) && r.價格 < pMin) return false;
      if (!Number.isNaN(pMax) && r.價格 > pMax) return false;
      if (!Number.isNaN(vMin) && (r['量縮(%)'] == null || r['量縮(%)'] < vMin)) return false;
      if (!Number.isNaN(vMax) && (r['量縮(%)'] == null || r['量縮(%)'] > vMax)) return false;
      if (market !== ALL && r.市場 !== market) return false;
      if (industry !== ALL && r.族群 !== industry) return false;
      if (status !== ALL && r.扣低狀態 !== status) return false;
      return true;
    });
  }, [rows, priceMin, priceMax, volMin, volMax, market, industry, status]);

  const resetFilters = () => {
    setPriceMin(''); setPriceMax(''); setVolMin(''); setVolMax('');
    setMarket(ALL); setIndustry(ALL); setStatus(ALL);
  };

  const filtersActive = priceMin || priceMax || volMin || volMax || market !== ALL || industry !== ALL || status !== ALL;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <nav className="border-b border-gray-200 bg-white/95 backdrop-blur sticky top-0 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-sm font-bold text-white">S</div>
            <span className="font-bold text-base text-gray-900">股市分析</span>
            <span className="hidden sm:block text-xs text-gray-400 ml-2 border-l border-gray-200 pl-2">篩選結果</span>
          </div>
          <Link href="/" className="text-sm text-gray-500 hover:text-blue-600 transition-colors">
            ← 回首頁
          </Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-lg font-bold">📊 台股篩選結果</h1>
          {data && (
            <span className="text-xs text-gray-400">最後更新：{data.updated_at}</span>
          )}
        </div>
        <p className="text-xs text-gray-400">
          均線多頭排列＋即將扣低＋電子股・成交金額&gt;5000萬。
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">🌟</span>
          {' '}標記另符合嚴格多頭排列＋貼近季線。
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-semibold">💧</span>
          {' '}標記今日量約為昨日 {VOL_SHRINK_MIN}-{VOL_SHRINK_MAX}%（量縮）。
        </p>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 bg-white border border-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : error || rows.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-10 text-center text-sm text-gray-400 shadow-sm">
            {error ? '結果尚未產生，排程執行完成後會自動更新。' : '目前沒有符合條件的股票。'}
          </div>
        ) : (
          <>
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-[11px] text-gray-400 mb-1">股價</label>
                  <div className="flex items-center gap-1">
                    <input type="number" value={priceMin} onChange={e => setPriceMin(e.target.value)}
                      placeholder="最低" className="w-full min-w-0 px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    <span className="text-gray-300">–</span>
                    <input type="number" value={priceMax} onChange={e => setPriceMax(e.target.value)}
                      placeholder="最高" className="w-full min-w-0 px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-[11px] text-gray-400 mb-1">量縮 %</label>
                  <div className="flex items-center gap-1">
                    <input type="number" value={volMin} onChange={e => setVolMin(e.target.value)}
                      placeholder="最低" className="w-full min-w-0 px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    <span className="text-gray-300">–</span>
                    <input type="number" value={volMax} onChange={e => setVolMax(e.target.value)}
                      placeholder="最高" className="w-full min-w-0 px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">市場</label>
                  <select value={market} onChange={e => setMarket(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                    <option value={ALL}>{ALL}</option>
                    {markets.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">族群</label>
                  <select value={industry} onChange={e => setIndustry(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                    <option value={ALL}>{ALL}</option>
                    {industries.map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-2 lg:col-span-1">
                  <label className="block text-[11px] text-gray-400 mb-1">扣低狀態</label>
                  <select value={status} onChange={e => setStatus(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                    <option value={ALL}>{ALL}</option>
                    {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <button onClick={resetFilters} disabled={!filtersActive}
                    className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors">
                    重設篩選
                  </button>
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              共 <b className="text-gray-700">{rows.length}</b> 支，其中 <b className="text-amber-600">{bCount}</b> 支另符合嚴選多頭、
              <b className="text-sky-600">{volShrinkCount}</b> 支量縮
              {filtersActive && (
                <>　·　篩選後剩 <b className="text-blue-600">{filteredRows.length}</b> 支</>
              )}
            </div>
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 text-xs">
                      <th className="text-left font-medium px-4 py-2.5">代號</th>
                      <th className="text-left font-medium px-4 py-2.5">名稱</th>
                      <th className="text-left font-medium px-4 py-2.5 hidden sm:table-cell">市場</th>
                      <th className="text-left font-medium px-4 py-2.5 hidden md:table-cell">族群</th>
                      <th className="text-right font-medium px-4 py-2.5">價格</th>
                      <th className="text-right font-medium px-4 py-2.5">漲幅</th>
                      <th className="text-right font-medium px-4 py-2.5">量縮</th>
                      <th className="text-left font-medium px-4 py-2.5">扣低狀態</th>
                      <th className="text-left font-medium px-4 py-2.5">嚴選</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                          沒有符合篩選條件的股票
                        </td>
                      </tr>
                    )}
                    {filteredRows.map((row, i) => {
                      const change = row['漲幅(%)'];
                      const up = change > 0, down = change < 0;
                      const volPct = row['量縮(%)'];
                      const volShrink = isVolShrink(volPct);
                      return (
                        <tr key={row.股票代號 + i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                          <td className="px-4 py-2.5 font-semibold text-gray-700">{row.股票代號}</td>
                          <td className="px-4 py-2.5 text-gray-600">{row.名稱}</td>
                          <td className="px-4 py-2.5 text-gray-400 hidden sm:table-cell">{row.市場}</td>
                          <td className="px-4 py-2.5 text-gray-400 hidden md:table-cell">{row.族群}</td>
                          <td className="px-4 py-2.5 text-right font-medium tabular-nums">{row.價格}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${up ? 'text-green-600' : down ? 'text-red-500' : 'text-gray-400'}`}>
                            {change > 0 ? '+' : ''}{change.toFixed(2)}%
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {volPct != null ? (
                              <span className={volShrink ? 'px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-semibold whitespace-nowrap' : 'text-gray-500'}>
                                {volShrink && '💧 '}{volPct.toFixed(0)}%
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">{row.扣低狀態}</td>
                          <td className="px-4 py-2.5">
                            {row['嚴選多頭(B)'] && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold whitespace-nowrap">
                                🌟 {row['嚴選多頭(B)']}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
