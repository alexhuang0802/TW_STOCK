'use client';

import Link from 'next/link';

const FEATURES = [
  {
    icon: '📈',
    title: 'TradingView 互動圖表',
    desc: '內建完整 K 線圖、畫線工具、技術指標，直接在頁面操作，不需另外開 TradingView。',
  },
  {
    icon: '🔬',
    title: '技術分析評分',
    desc: '即時顯示 Buy / Neutral / Sell 評分圓盤，整合 RSI、MACD、KD、SMA 等 14 項指標。',
  },
  {
    icon: '📋',
    title: '財務數據一覽',
    desc: '本益比、EPS、營收成長、ROE、殖利率等 16 項財務數據，台股美股同步支援。',
  },
  {
    icon: '⚡',
    title: '即時報價 · 60 秒刷新',
    desc: '自選股列表即時更新報價與漲跌幅，走勢迷你圖一眼掌握強弱。',
  },
  {
    icon: '📰',
    title: '相關新聞',
    desc: '每支股票自動抓取最新英文新聞，快速掌握市場動態與基本面資訊。',
  },
  {
    icon: '🌏',
    title: '台股 + 美股',
    desc: '輸入台股四位數字代號自動補 .TW，美股直接輸入代號，一個介面通通搞定。',
  },
];

const STATS = [
  { label: '資料來源', value: 'Yahoo Finance' },
  { label: '技術指標', value: '14 項' },
  { label: '財務數據', value: '16 項' },
  { label: '完全免費', value: '開源' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0d1117] text-white">

      {/* ── Nav ── */}
      <nav className="border-b border-gray-800/60 bg-[#0d1117]/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-sm font-bold">S</div>
            <span className="font-bold text-base">股市分析</span>
          </div>
          <Link href="/stocks"
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors">
            進入看板 →
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          即時報價 · 免費使用
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-tight">
          台股美股<br />
          <span className="text-blue-400">一站式</span>分析看板
        </h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
          整合 TradingView 互動圖表、技術分析評分、財務數據、即時新聞，
          讓你不用開十個視窗就能完成看盤分析。
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/stocks"
            className="px-7 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-all hover:scale-105 shadow-lg shadow-blue-600/20">
            立即開始使用 →
          </Link>
          <a href="https://github.com/alexhuang0802/TW_STOCK" target="_blank" rel="noopener noreferrer"
            className="px-7 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm font-semibold transition-colors text-gray-300">
            GitHub ↗
          </a>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {STATS.map(s => (
            <div key={s.label} className="bg-gray-900/60 border border-gray-800 rounded-xl px-5 py-4 text-center">
              <div className="text-xl font-bold text-blue-400 mb-1">{s.value}</div>
              <div className="text-xs text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Preview ── */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/60" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
            <div className="w-3 h-3 rounded-full bg-green-500/60" />
            <span className="ml-3 text-xs text-gray-500">tw-stock-dashboard-topaz.vercel.app/stocks</span>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Fake sidebar */}
            <div className="sm:col-span-1 space-y-2">
              <div className="bg-gray-800/60 rounded-lg p-3 text-xs text-gray-400 border border-gray-700/50">
                <div className="text-[10px] text-gray-600 mb-2">自選股</div>
                {[
                  { sym: '2330', name: '台積電', chg: '-2.06%', pos: false },
                  { sym: 'AAPL', name: 'Apple Inc.', chg: '+3.24%', pos: true },
                  { sym: 'NVDA', name: 'NVIDIA', chg: '+1.80%', pos: true },
                  { sym: 'TSM', name: 'Taiwan Semi.', chg: '+0.41%', pos: true },
                ].map(s => (
                  <div key={s.sym} className="flex items-center justify-between py-1.5 border-b border-gray-700/30 last:border-0">
                    <div>
                      <span className="font-bold text-white">{s.sym}</span>
                      <span className="text-gray-600 text-[10px] ml-1">{s.name}</span>
                    </div>
                    <span className={`text-[10px] font-medium ${s.pos ? 'text-green-400' : 'text-red-400'}`}>{s.chg}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Fake chart area */}
            <div className="sm:col-span-2 space-y-3">
              <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50 h-40 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-xs text-gray-500">AAPL · Apple Inc.</div>
                    <div className="text-2xl font-bold">USD 280.14</div>
                    <div className="text-green-400 text-sm">▲ +3.24%</div>
                  </div>
                  <div className="text-[10px] text-gray-600 text-right">TradingView<br/>K線圖</div>
                </div>
                {/* fake candlestick bars */}
                <div className="flex items-end gap-1 h-12">
                  {[40,55,35,60,45,70,50,65,42,75,58,80,55,72,68,85,62,78,90,82].map((h, i) => (
                    <div key={i} className={`flex-1 rounded-sm ${i % 3 === 0 ? 'bg-red-500/60' : 'bg-green-500/60'}`} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '本益比', val: '28.5' },
                  { label: 'RSI 14', val: '62.3' },
                  { label: '殖利率', val: '0.52%' },
                ].map(c => (
                  <div key={c.label} className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2">
                    <div className="text-[10px] text-gray-500">{c.label}</div>
                    <div className="text-sm font-bold text-white">{c.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-bold text-center mb-2">功能一覽</h2>
        <p className="text-gray-500 text-sm text-center mb-10">不需要訂閱、不需要登入，打開即用</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="bg-gray-900/60 border border-gray-800 hover:border-gray-700 rounded-xl p-5 transition-colors group">
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-sm mb-2 group-hover:text-blue-400 transition-colors">{f.title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/10 border border-blue-500/20 rounded-2xl px-8 py-12 text-center">
          <h2 className="text-2xl font-bold mb-3">開始看盤</h2>
          <p className="text-gray-400 text-sm mb-7">加入自選股，一鍵查看技術指標與財務數據</p>
          <Link href="/stocks"
            className="inline-flex px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-all hover:scale-105 shadow-lg shadow-blue-600/25">
            進入股市分析看板 →
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-800 py-8 text-center text-xs text-gray-600">
        資料來源：Yahoo Finance　·　圖表：TradingView　·　完全免費開源
      </footer>

    </div>
  );
}
