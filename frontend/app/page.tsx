'use client';

import { useEffect, useState } from 'react';

interface Promotion {
  title: string;
  image: string;
  start_date: string;
  end_date: string;
  link: string;
  description: string;
  type?: 'product' | 'campaign';
  deal?: string;
  price?: number;
  category?: string;
}

interface StoreData {
  store: string;
  store_id: string;
  logo: string;
  website: string;
  scraped_at: string;
  promotions: Promotion[];
}

const STORE_COLORS: Record<string, string> = {
  pxmart: 'bg-green-600',
  simplemart: 'bg-orange-500',
  hilife: 'bg-red-600',
  okmart: 'bg-yellow-500',
  seven: 'bg-emerald-600',
  familymart: 'bg-blue-600',
  carrefour: 'bg-blue-800',
  news: 'bg-purple-600',
};

const DEAL_COLORS: Record<string, string> = {
  '買一送一': 'bg-red-500',
  '買1送1': 'bg-red-500',
  '半價': 'bg-orange-500',
  '特價': 'bg-amber-500',
};

const STORE_ORDER = ['pxmart', 'carrefour', 'simplemart', 'seven', 'familymart', 'hilife', 'okmart', 'news'];

function getDealColor(deal: string): string {
  if (!deal) return 'bg-pink-500';
  for (const [key, color] of Object.entries(DEAL_COLORS)) {
    if (deal.includes(key)) return color;
  }
  if (deal.includes('送')) return 'bg-red-500';
  if (deal.includes('折')) return 'bg-orange-500';
  if (deal.includes('元')) return 'bg-amber-500';
  return 'bg-pink-500';
}

function isExpired(endDate: string): boolean {
  if (!endDate) return false;
  try {
    const normalized = endDate.replace(/\//g, '-');
    const end = new Date(normalized);
    if (isNaN(end.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return end < today;
  } catch {
    return false;
  }
}

export default function Home() {
  const [stores, setStores] = useState<StoreData[]>([]);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'all' | 'products' | 'campaigns'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    fetch('/api/promotions')
      .then(res => res.json())
      .then(data => {
        const sorted = (data.stores || []).sort((a: StoreData, b: StoreData) => {
          const ai = STORE_ORDER.indexOf(a.store_id);
          const bi = STORE_ORDER.indexOf(b.store_id);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
        // 過濾掉已過期的優惠
        const filtered = sorted.map((store: StoreData) => ({
          ...store,
          promotions: store.promotions.filter((p: Promotion) => !isExpired(p.end_date)),
        }));
        setStores(filtered);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filteredStores = activeTab === 'all'
    ? stores
    : stores.filter(s => s.store_id === activeTab);

  const allPromotions = filteredStores.flatMap(store =>
    store.promotions
      .filter(p => p.title && p.title.length > 1)
      .map(p => ({ ...p, store_name: store.store, store_id: store.store_id }))
  );

  // 收集所有分類（跨超商整合）
  const allCategories = (() => {
    const catCounts: Record<string, number> = {};
    allPromotions
      .filter(p => p.type === 'product' && p.category && p.category !== '其他')
      .forEach(p => {
        catCounts[p.category!] = (catCounts[p.category!] || 0) + 1;
      });
    return Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])  // 按數量排序
      .map(([cat, count]) => ({ name: cat, count }));
  })();

  // 按類型過濾
  const typedPromotions = viewMode === 'all'
    ? allPromotions
    : viewMode === 'products'
    ? allPromotions.filter(p => p.type === 'product')
    : allPromotions.filter(p => p.type !== 'product');

  // 按分類過濾
  const categoryFiltered = selectedCategory === 'all'
    ? typedPromotions
    : typedPromotions.filter(p => p.category === selectedCategory);

  const searchedPromotions = search
    ? categoryFiltered.filter(p =>
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.description?.toLowerCase().includes(search.toLowerCase()) ||
        p.deal?.toLowerCase().includes(search.toLowerCase()) ||
        p.store_name.includes(search)
      )
    : categoryFiltered;

  const totalCount = stores.reduce((sum, s) => sum + s.promotions.length, 0);
  const productCount = allPromotions.filter(p => p.type === 'product').length;
  const campaignCount = allPromotions.filter(p => p.type !== 'product').length;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">
                💰 省錢小工具
              </h1>
              <p className="text-sm text-gray-500">
                雙北超市超商優惠整合 · {totalCount} 筆優惠
              </p>
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="搜尋優惠（如：買一送一、巧克力、咖啡...）"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full sm:w-80 pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* 分類下拉選單 */}
          {allCategories.length > 0 && (
            <div className="flex items-center gap-2 mt-3">
              <label className="text-sm text-gray-500 flex-shrink-0">分類篩選：</label>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="flex-1 sm:flex-none sm:w-48 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              >
                <option value="all">全部分類</option>
                {allCategories.map(cat => (
                  <option key={cat.name} value={cat.name}>
                    {cat.name} ({cat.count})
                  </option>
                ))}
              </select>
              {selectedCategory !== 'all' && (
                <button
                  onClick={() => setSelectedCategory('all')}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  清除
                </button>
              )}
            </div>
          )}

          {/* View Mode Tabs */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setViewMode('all')}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              全部 ({totalCount})
            </button>
            <button
              onClick={() => setViewMode('products')}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'products' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600 hover:bg-red-100'
              }`}
            >
              🏷️ 商品優惠 ({productCount})
            </button>
            <button
              onClick={() => setViewMode('campaigns')}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'campaigns' ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
              }`}
            >
              📢 活動檔期 ({campaignCount})
            </button>
          </div>

          {/* Store Tabs */}
          <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
            <TabButton
              active={activeTab === 'all'}
              onClick={() => setActiveTab('all')}
              color="bg-gray-700"
            >
              全部
            </TabButton>
            {stores.map(store => (
              <TabButton
                key={store.store_id}
                active={activeTab === store.store_id}
                onClick={() => setActiveTab(store.store_id)}
                color={STORE_COLORS[store.store_id] || 'bg-gray-600'}
                count={store.promotions.length}
              >
                {store.store}
              </TabButton>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
          </div>
        ) : searchedPromotions.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-xl">找不到符合的優惠</p>
            <p className="mt-2">試試其他關鍵字？</p>
          </div>
        ) : (
          <>
            {/* 商品優惠區域 - 緊湊列表 */}
            {viewMode !== 'campaigns' && searchedPromotions.some(p => p.type === 'product') && (
              <div className="mb-8">
                {viewMode === 'all' && (
                  <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    🏷️ 商品優惠
                    <span className="text-sm font-normal text-gray-400">
                      直接看有什麼好康
                    </span>
                  </h2>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {searchedPromotions
                    .filter(p => p.type === 'product')
                    .map((promo, i) => (
                      <ProductDealCard key={`product-${promo.store_id}-${i}`} promo={promo} />
                    ))}
                </div>
              </div>
            )}

            {/* 活動檔期區域 - 原有卡片 */}
            {viewMode !== 'products' && searchedPromotions.some(p => p.type !== 'product') && (
              <div>
                {viewMode === 'all' && (
                  <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    📢 活動檔期
                    <span className="text-sm font-normal text-gray-400">
                      滿額送、集點、檔期活動
                    </span>
                  </h2>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {searchedPromotions
                    .filter(p => p.type !== 'product')
                    .map((promo, i) => (
                      <CampaignCard key={`campaign-${promo.store_id}-${i}`} promo={promo} />
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-white border-t mt-8 py-6 text-center text-sm text-gray-500">
        <p>省錢小工具 · 資料來自各超市超商官網及新聞</p>
        {stores.length > 0 && (
          <p className="mt-1">
            最後更新：{new Date(
              Math.max(...stores.map(s => new Date(s.scraped_at).getTime()))
            ).toLocaleString('zh-TW')}
          </p>
        )}
      </footer>
    </main>
  );
}

function TabButton({
  children,
  active,
  onClick,
  color,
  count,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  color: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
        active
          ? `${color} text-white shadow-md`
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {children}
      {count !== undefined && (
        <span className={`ml-1.5 text-xs ${active ? 'text-white/80' : 'text-gray-400'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

/** 商品優惠卡片 - 緊湊版，直接秀出優惠內容 */
function ProductDealCard({
  promo,
}: {
  promo: Promotion & { store_name: string; store_id: string };
}) {
  const formatDate = (d: string) => {
    if (!d) return '';
    if (d.length === 8 && !d.includes('-')) {
      return `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
    }
    return d.replace(/-/g, '/');
  };

  const endDate = formatDate(promo.end_date);

  // 把標題拆成商品名和優惠
  const parts = promo.title.split(' — ');
  const productName = parts[0] || promo.title;
  const dealText = promo.deal || parts[1] || '';

  const dealColor = getDealColor(dealText);

  return (
    <a
      href={promo.link}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-white rounded-xl border border-gray-100 hover:shadow-md hover:border-gray-200 transition-all duration-200 overflow-hidden flex items-stretch group"
    >
      {/* 左邊商品圖 */}
      {promo.image && (
        <div className="w-20 h-20 flex-shrink-0 bg-gray-50 flex items-center justify-center overflow-hidden">
          <img
            src={promo.image}
            alt={productName}
            className="w-full h-full object-contain p-1"
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}

      {/* 右邊資訊 */}
      <div className="flex-1 p-3 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded text-white ${STORE_COLORS[promo.store_id] || 'bg-gray-600'}`}>
            {promo.store_name}
          </span>
          {dealText && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded text-white font-bold ${dealColor}`}>
              {dealText}
            </span>
          )}
        </div>

        <h3 className="font-medium text-gray-800 text-sm leading-snug line-clamp-1 group-hover:text-blue-600 transition-colors">
          {productName}
        </h3>

        <div className="flex items-center gap-2 mt-0.5">
          {promo.price && (
            <span className="text-red-600 font-bold text-sm">${promo.price}</span>
          )}
          {promo.category && promo.category !== '其他' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{promo.category}</span>
          )}
          {endDate && (
            <span className="text-[10px] text-gray-400 ml-auto">
              至 {endDate}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

/** 活動檔期卡片 - 原有大卡片風格 */
function CampaignCard({
  promo,
}: {
  promo: Promotion & { store_name: string; store_id: string };
}) {
  const formatDate = (d: string) => {
    if (!d) return '';
    if (d.length === 8 && !d.includes('-')) {
      return `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
    }
    return d.replace(/-/g, '/');
  };

  const startDate = formatDate(promo.start_date);
  const endDate = formatDate(promo.end_date);
  const dateRange = startDate && endDate && endDate !== '9999/99/99'
    ? `${startDate} ~ ${endDate}`
    : startDate || '';

  return (
    <a
      href={promo.link}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-white rounded-xl shadow-sm hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col group border border-gray-100"
    >
      {promo.image ? (
        <div className="relative h-44 bg-gray-100 overflow-hidden">
          <img
            src={promo.image}
            alt={promo.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      ) : (
        <div className="h-20 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
          <span className="text-3xl">🏷️</span>
        </div>
      )}

      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-full text-white ${STORE_COLORS[promo.store_id] || 'bg-gray-600'}`}>
            {promo.store_name}
          </span>
          {promo.store_id === 'news' && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600">
              新聞
            </span>
          )}
        </div>

        <h3 className="font-semibold text-gray-800 text-sm leading-snug line-clamp-2 group-hover:text-blue-600 transition-colors">
          {promo.title}
        </h3>

        {dateRange && (
          <p className="text-xs text-gray-400 mt-2">
            📅 {dateRange}
          </p>
        )}

        {promo.description && promo.description !== '最新消息' && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-1">
            {promo.description}
          </p>
        )}
      </div>
    </a>
  );
}
