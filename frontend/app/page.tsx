'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface IndexItem {
  symbol: string;
  label: string;
  flag: string;
  price: string;
  change: string;
  changePct: string;
  up: boolean;
  marketState: string;
}

interface InstitutionalSummary {
  date: string;
  foreign: string; foreignRaw: number;
  trust: string;   trustRaw: number;
  dealer: string;  dealerRaw: number;
  total: string;   totalRaw: number;
}

interface StockFlow {
  code: string;
  name: string;
  net: string;
  netRaw: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function FlowBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(Math.abs(value) / max * 100, 100);
  return (
    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1">
      <div
        className={`h-full rounded-full transition-all ${value >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
        style={{ width: `${pct}%`, marginLeft: value < 0 ? `${100 - pct}%` : 0 }}
      />
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function HomePage() {
  const [indices, setIndices] = useState<IndexItem[]>([]);
  const [institutional, setInstitutional] = useState<InstitutionalSummary | null>(null);
  const [topBuy, setTopBuy] = useState<StockFlow[]>([]);
  const [topSell, setTopSell] = useState<StockFlow[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(true);
  const [instLoading, setInstLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');

  const fetchIndices = useCallback(async () => {
    try {
      const res = await fetch('/api/market/indices');
      if (!res.ok) return;
      const d = await res.json();
      setIndices(d.indices ?? []);
      setLastUpdate(new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch { /* ignore */ } finally {
      setIndicesLoading(false);
    }
  }, []);

  const fetchInstitutional = useCallback(async () => {
    try {
      const res = await fetch('/api/market/institutional');
      if (!res.ok) return;
      const d = await res.json();
      setInstitutional(d.summary);
      setTopBuy(d.topBuy ?? []);
      setTopSell(d.topSell ?? []);
    } catch { /* ignore */ } finally {
      setInstLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIndices();
    fetchInstitutional();
    const t = setInterval(fetchIndices, 60_000);
    return () => clearInterval(t);
  }, [fetchIndices, fetchInstitutional]);

  const maxFlow = institutional
    ? Math.max(Math.abs(institutional.foreignRaw), Math.abs(institutional.trustRaw), Math.abs(institutional.dealerRaw))
    : 1;

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">

      {/* ── Nav ── */}
      <nav className="border-b border-gray-800/60 bg-[#0d1117]/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-sm font-bold">S</div>
            <span className="font-bold text-base">股市分析</span>
            <span className="hidden sm:block text-xs text-gray-500 ml-2 border-l border-gray-700 pl-2">市場總覽</span>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdate && (
              <span className="text-xs text-gray-600 hidden sm:block">
                更新 {lastUpdate}
              </span>
            )}
            <Link href="/stocks"
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors">
              看板 →
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── 多國大盤指標 ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-300">多國大盤指標</h2>
            <span className="text-xs text-gray-600">· 60秒自動刷新</span>
          </div>
          {indicesLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="bg-gray-900/60 border border-gray-800 rounded-xl p-3 animate-pulse h-20" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {indices.map(idx => (
                <div key={idx.symbol}
                  className="bg-gray-900/60 border border-gray-800 hover:border-gray-700 rounded-xl p-3 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      {idx.flag} {idx.label}
                    </span>
                    {idx.marketState === 'REGULAR' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    )}
                  </div>
                  <div className="text-base font-bold truncate">{idx.price}</div>
                  <div className={`text-xs font-medium mt-0.5 ${idx.up ? 'text-green-400' : 'text-red-400'}`}>
                    {idx.changePct} <span className="text-gray-600">({idx.change})</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 三大法人 + 個股流向 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* 三大法人資金流向 */}
          <section className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-300">三大法人資金流向</h2>
              {institutional?.date && (
                <span className="text-xs text-gray-600">{institutional.date}</span>
              )}
            </div>
            {instLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="animate-pulse h-10 bg-gray-800 rounded" />
                ))}
              </div>
            ) : institutional ? (
              <div className="space-y-4">
                {[
                  { label: '外資', value: institutional.foreign, raw: institutional.foreignRaw },
                  { label: '投信', value: institutional.trust, raw: institutional.trustRaw },
                  { label: '自營商', value: institutional.dealer, raw: institutional.dealerRaw },
                ].map(row => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{row.label}</span>
                      <span className={`text-sm font-bold ${row.raw >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {row.value}
                      </span>
                    </div>
                    <FlowBar value={row.raw} max={maxFlow} />
                  </div>
                ))}
                <div className="border-t border-gray-800 pt-3 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">合計</span>
                    <span className={`text-sm font-bold ${institutional.totalRaw >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {institutional.total}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-600 text-center py-4">暫無資料（收盤後更新）</p>
            )}
          </section>

          {/* 外資買超 top 10 */}
          <section className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">三大法人 買超 Top 10</h2>
            {instLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="animate-pulse h-7 bg-gray-800 rounded" />
                ))}
              </div>
            ) : topBuy.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">暫無資料（收盤後更新）</p>
            ) : (
              <div className="space-y-1">
                {topBuy.map((s, i) => (
                  <div key={s.code} className="flex items-center justify-between py-1 border-b border-gray-800/50 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-600 w-4 flex-shrink-0">{i + 1}</span>
                      <span className="text-xs font-medium text-gray-400">{s.code}</span>
                      <span className="text-xs text-gray-500 truncate">{s.name}</span>
                    </div>
                    <span className="text-xs font-bold text-green-400 flex-shrink-0 ml-2">{s.net}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 外資賣超 top 10 */}
          <section className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">三大法人 賣超 Top 10</h2>
            {instLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="animate-pulse h-7 bg-gray-800 rounded" />
                ))}
              </div>
            ) : topSell.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">暫無資料（收盤後更新）</p>
            ) : (
              <div className="space-y-1">
                {topSell.map((s, i) => (
                  <div key={s.code} className="flex items-center justify-between py-1 border-b border-gray-800/50 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-600 w-4 flex-shrink-0">{i + 1}</span>
                      <span className="text-xs font-medium text-gray-400">{s.code}</span>
                      <span className="text-xs text-gray-500 truncate">{s.name}</span>
                    </div>
                    <span className="text-xs font-bold text-red-400 flex-shrink-0 ml-2">{s.net}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── CTA ── */}
        <section className="bg-gradient-to-r from-blue-600/10 to-purple-600/5 border border-blue-500/20 rounded-xl px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-sm mb-1">查看個股詳情</h3>
            <p className="text-xs text-gray-500">TradingView K線圖 · 技術指標評分 · 財務數據</p>
          </div>
          <Link href="/stocks"
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition-all hover:scale-105 whitespace-nowrap">
            進入看板 →
          </Link>
        </section>

      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-800 py-6 text-center text-xs text-gray-600 mt-8">
        大盤資料：Yahoo Finance　·　法人資料：臺灣證券交易所　·　完全免費開源
      </footer>

    </div>
  );
}
