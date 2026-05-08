'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface IndexItem {
  symbol: string; label: string; flag: string;
  price: string; change: string; changePct: string;
  up: boolean; closes: number[]; marketState: string;
}

interface InstitutionalSummary {
  date: string;
  foreign: string; foreignRaw: number;
  trust: string;   trustRaw: number;
  dealer: string;  dealerRaw: number;
  total: string;   totalRaw: number;
}

interface StockRow {
  code: string; name: string; raw: number; label: string; isNew: boolean;
}

interface InstitGroup { topBuy: StockRow[]; topSell: StockRow[]; }

// ── Sparkline ─────────────────────────────────────────────────────────────

function MiniSparkline({ closes, up }: { closes: number[]; up: boolean }) {
  if (closes.length < 2) return <div className="w-24 h-10" />;
  const min = Math.min(...closes), max = Math.max(...closes), r = max - min || 1;
  const W = 96, H = 40, P = 2;
  const pts = closes.map((v, i) =>
    `${P + (i / (closes.length - 1)) * (W - P * 2)},${P + (1 - (v - min) / r) * (H - P * 2)}`
  ).join(' ');
  const fillPts = `${P},${H - P} ${pts} ${W - P},${H - P}`;
  const color = up ? '#16a34a' : '#dc2626';
  const fill  = up ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.10)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-24 h-10 flex-shrink-0">
      <polygon points={fillPts} fill={fill} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Flow Bar ───────────────────────────────────────────────────────────────

function FlowBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(Math.abs(value) / max * 100, 100);
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
      <div
        className={`h-full rounded-full ${value >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
        style={{ width: `${pct}%`, marginLeft: value < 0 ? `${100 - pct}%` : 0 }}
      />
    </div>
  );
}

// ── Stock List ────────────────────────────────────────────────────────────

function StockList({ rows, side }: { rows: StockRow[]; side: 'buy' | 'sell' }) {
  const isGreen = side === 'buy';
  return (
    <div className="space-y-1.5">
      {rows.map((s, i) => (
        <div key={s.code}
          className={`flex items-center justify-between py-1.5 px-2 rounded-lg border
            ${s.isNew
              ? isGreen
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
              : 'border-transparent'}`}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] text-gray-300 w-4 flex-shrink-0">{i + 1}</span>
            <span className="text-xs font-semibold text-gray-700">{s.code}</span>
            <span className="text-xs text-gray-400 truncate max-w-[60px]">{s.name}</span>
            {s.isNew && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0
                ${isGreen ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                {isGreen ? '⚡新買進' : '⚡新賣出'}
              </span>
            )}
          </div>
          <span className={`text-xs font-bold flex-shrink-0 ml-2 ${isGreen ? 'text-green-600' : 'text-red-500'}`}>
            {s.label}
          </span>
        </div>
      ))}
      {rows.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-4">暫無資料</p>
      )}
    </div>
  );
}

// ── Instit Panel ──────────────────────────────────────────────────────────

type TabKey = 'foreign' | 'trust' | 'dealer';

const TAB_LABELS: Record<TabKey, string> = {
  foreign: '外資',
  trust:   '投信',
  dealer:  '自營商',
};

function InstitPanel({
  loading,
  foreign, trust, dealer,
}: {
  loading: boolean;
  foreign: InstitGroup | null;
  trust: InstitGroup | null;
  dealer: InstitGroup | null;
}) {
  const [tab, setTab] = useState<TabKey>('foreign');
  const groups: Record<TabKey, InstitGroup | null> = { foreign, trust, dealer };
  const current = groups[tab];

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden lg:col-span-2">
      {/* Tab bar */}
      <div className="flex border-b border-gray-100">
        {(Object.keys(TAB_LABELS) as TabKey[]).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors
              ${tab === k
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-gray-400 hover:text-gray-600'}`}>
            {TAB_LABELS[k]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-4">
            {[0, 1].map(i => (
              <div key={i} className="space-y-2">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="h-7 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        ) : current ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs font-semibold text-gray-600">買進 Top 5</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-600 font-bold">買</span>
              </div>
              <StockList rows={current.topBuy} side="buy" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs font-semibold text-gray-600">賣出 Top 5</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-500 font-bold">賣</span>
              </div>
              <StockList rows={current.topSell} side="sell" />
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center py-6">暫無資料（收盤後更新）</p>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function HomePage() {
  const [indices, setIndices] = useState<IndexItem[]>([]);
  const [summary, setSummary] = useState<InstitutionalSummary | null>(null);
  const [foreign, setForeign] = useState<InstitGroup | null>(null);
  const [trust, setTrust] = useState<InstitGroup | null>(null);
  const [dealer, setDealer] = useState<InstitGroup | null>(null);
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
      setSummary(d.summary);
      setForeign(d.foreign);
      setTrust(d.trust);
      setDealer(d.dealer);
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

  const maxFlow = summary
    ? Math.max(Math.abs(summary.foreignRaw), Math.abs(summary.trustRaw), Math.abs(summary.dealerRaw), 1)
    : 1;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">

      {/* ── Nav ── */}
      <nav className="border-b border-gray-200 bg-white/95 backdrop-blur sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-sm font-bold text-white">S</div>
            <span className="font-bold text-base text-gray-900">股市分析</span>
            <span className="hidden sm:block text-xs text-gray-400 ml-2 border-l border-gray-200 pl-2">市場總覽</span>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdate && <span className="text-xs text-gray-400 hidden sm:block">更新 {lastUpdate}</span>}
            <Link href="/stocks"
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors text-white">
              看板 →
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── 多國大盤指標 ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-600">多國大盤指標</h2>
            <span className="text-xs text-gray-400">· 60秒自動刷新</span>
          </div>
          {indicesLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-white border border-gray-100 rounded-xl p-3 animate-pulse h-24 shadow-sm" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {indices.map(idx => (
                <div key={idx.symbol}
                  className="bg-white border border-gray-100 hover:border-gray-200 rounded-xl p-3 shadow-sm hover:shadow transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500 flex items-center gap-1">{idx.flag} {idx.label}</span>
                    {idx.marketState === 'REGULAR' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                    )}
                  </div>
                  <div className="text-sm font-bold text-gray-900 truncate">{idx.price}</div>
                  <div className={`text-xs font-semibold ${idx.up ? 'text-green-600' : 'text-red-500'}`}>
                    {idx.changePct}
                  </div>
                  <div className={`text-[10px] mb-1 ${idx.up ? 'text-green-500' : 'text-red-400'}`}>
                    {idx.change}
                  </div>
                  <MiniSparkline closes={idx.closes} up={idx.up} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 法人資金 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* 三大法人總覽 */}
          <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">三大法人資金流向</h2>
              {summary?.date && (
                <span className="text-xs text-gray-400">{summary.date}</span>
              )}
            </div>
            {instLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="animate-pulse h-10 bg-gray-100 rounded" />
                ))}
              </div>
            ) : summary ? (
              <div className="space-y-4">
                {[
                  { label: '外資', value: summary.foreign, raw: summary.foreignRaw },
                  { label: '投信', value: summary.trust,   raw: summary.trustRaw   },
                  { label: '自營商', value: summary.dealer, raw: summary.dealerRaw },
                ].map(row => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">{row.label}</span>
                      <span className={`text-sm font-bold ${row.raw >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {row.value}
                      </span>
                    </div>
                    <FlowBar value={row.raw} max={maxFlow} />
                  </div>
                ))}
                <div className="border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-600">合計</span>
                    <span className={`text-sm font-bold ${summary.totalRaw >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {summary.total}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-6">暫無資料（收盤後更新）</p>
            )}
          </section>

          {/* 外資/投信/自營商 個股 Tab */}
          <InstitPanel
            loading={instLoading}
            foreign={foreign}
            trust={trust}
            dealer={dealer}
          />
        </div>

        {/* ── CTA ── */}
        <section className="bg-gradient-to-r from-blue-600 to-blue-500 rounded-xl px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
          <div>
            <h3 className="font-semibold text-sm mb-1 text-white">查看個股詳情</h3>
            <p className="text-xs text-blue-100">TradingView K線圖 · 技術指標評分 · 財務數據</p>
          </div>
          <Link href="/stocks"
            className="px-6 py-2.5 bg-white text-blue-600 hover:bg-blue-50 rounded-lg text-sm font-semibold transition-all hover:scale-105 whitespace-nowrap shadow">
            進入看板 →
          </Link>
        </section>

      </div>

      <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-400 mt-8">
        大盤資料：Yahoo Finance　·　法人資料：臺灣證券交易所　·　完全免費開源
      </footer>

    </div>
  );
}
