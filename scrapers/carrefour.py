"""家樂福 優惠活動爬蟲 - HTML 頁面 + WordPress REST API"""
import json
import os
import re
from datetime import datetime

import requests
from bs4 import BeautifulSoup

from categorize import categorize_promotions

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}
BASE = 'https://www.carrefour.com.tw'
NOW = datetime.now()

EXCLUDE_TITLES = {
    'English', '首頁', '登入', '註冊', '搜尋', '購物車', '我的帳戶',
    '全部促銷目錄', '更多', '查看更多', '了解更多',
}

# 排除非食品雜貨的專櫃品牌
SKIP_BRANDS = [
    'NIKE', 'SKECHERS', 'TAKASHIMA', '高島', '按摩椅', '寢具', '金大器',
    '床墊', '冷氣', '電視', '洗衣機', '冰箱', 'Dyson', 'LG',
    '精品', '珠寶', '黃金', '手機', '筆電', '平板',
]


def scrape():
    promotions = []

    # 1. HTML 頁面抓取（DM目錄）
    print('[家樂福] 抓取 HTML 頁面...')
    scrape_html_pages(promotions)

    # 2. WordPress API 補充（只抓食品/日用品相關）
    print('[家樂福] 抓取 WordPress API 優惠...')
    scrape_wp_api(promotions)

    # 3. Playwright 備用
    if len(promotions) < 5:
        print('[家樂福] 資料不足，嘗試 Playwright...')
        try:
            pw_promos = scrape_with_playwright()
            for p in pw_promos:
                if not any(e['title'] == p['title'] for e in promotions):
                    promotions.append(p)
        except Exception as e:
            print(f'[家樂福] Playwright 抓取失敗: {e}')

    promotions = categorize_promotions(promotions)
    return save(promotions)


def scrape_html_pages(promotions):
    """從 HTML 頁面抓取 DM 目錄"""
    urls = [f'{BASE}/catalogues/', BASE]

    for url in urls:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.encoding = 'utf-8'
            if resp.status_code != 200:
                continue
            soup = BeautifulSoup(resp.text, 'lxml')
            extract_from_html(soup, promotions)
        except Exception as e:
            print(f'[家樂福] {url} 抓取失敗: {e}')


def extract_from_html(soup, promotions):
    """從 HTML 提取優惠資訊"""
    selectors = [
        'a[href*="catalogue"]',
        'a[href*="promotion"]',
        'a[href*="campaign"]',
        'a[href*="spmevent"]',
        '.promotion-card a',
        '.catalogue-item a',
    ]

    for selector in selectors:
        for a_tag in soup.select(selector):
            href = a_tag.get('href', '')
            if any(kw in href for kw in ['-en/', 'login', 'register', 'cart']):
                continue

            img = a_tag.select_one('img')
            title_el = a_tag.select_one('h2, h3, h4, h5, .title')

            title = title_el.get_text(strip=True) if title_el else ''
            if not title and img:
                title = img.get('alt', '')
            if not title:
                title = a_tag.get_text(strip=True)[:80]
            if not title or title in EXCLUDE_TITLES or len(title) < 3:
                continue

            link = href if href.startswith('http') else f'{BASE}{href}'
            image = ''
            if img:
                src = img.get('data-src') or img.get('data-lazy') or img.get('src') or ''
                image = src if src.startswith('http') else (f'{BASE}{src}' if src else '')

            if not any(p['title'] == title for p in promotions):
                promotions.append({
                    'title': title,
                    'image': image,
                    'start_date': '',
                    'end_date': '',
                    'link': link,
                    'description': '',
                    'type': 'campaign',
                })


def scrape_wp_api(promotions):
    """從 WordPress API 抓取食品/日用品相關優惠"""
    api_headers = {**HEADERS, 'Accept': 'application/json'}
    search_terms = ['特價', '買一送一', '促銷']
    seen_ids = set()

    for term in search_terms:
        try:
            resp = requests.get(
                f'{BASE}/wp-json/wp/v2/posts',
                params={'per_page': 30, 'search': term},
                headers=api_headers, timeout=20,
            )
            if resp.status_code != 200:
                continue
            for post in resp.json():
                pid = post.get('id')
                if pid in seen_ids:
                    continue
                seen_ids.add(pid)
                _parse_wp_post(post, promotions)
        except Exception as e:
            print(f'[家樂福] WP API search={term} 失敗: {e}')


def _parse_wp_post(post, promotions):
    """解析 WP 文章，只保留食品/日用品相關"""
    title_raw = post.get('title', {}).get('rendered', '')
    title = BeautifulSoup(title_raw, 'html.parser').get_text(strip=True)
    if not title or len(title) < 4:
        return

    # 排除非食品品牌
    if any(brand in title for brand in SKIP_BRANDS):
        return

    # 排除得獎、停機等
    if any(kw in title for kw in ['得獎', '中獎', '停機', '維護']):
        return

    # 需要有優惠關鍵字
    if not any(kw in title for kw in ['特價', '優惠', '折', '促銷', '買', '送', '半價']):
        return

    # 已存在？
    if any(p['title'] == title for p in promotions):
        return

    link = post.get('link', '')
    content_html = post.get('content', {}).get('rendered', '')
    date = post.get('date', '')[:10]

    # 提取圖片
    image = ''
    if content_html:
        soup = BeautifulSoup(content_html, 'html.parser')
        img = soup.find('img')
        if img:
            src = img.get('data-src') or img.get('src') or ''
            image = src if src.startswith('http') else (f'{BASE}{src}' if src else '')

    # 提取價格
    price = None
    price_m = re.search(r'特價\$?(\d{2,5})', title) or re.search(r'\$(\d{2,5})', title) or re.search(r'(\d{2,5})元', title)
    if price_m:
        val = int(price_m.group(1))
        if 10 <= val <= 99999:
            price = val

    # 提取優惠類型
    deal = ''
    deal_patterns = [
        r'(特價\$?\d+)', r'(買\d+送\d+)', r'(\d+折起?)',
        r'(\d+[件杯包]\$?\d+)', r'(半價)', r'(加購\S+)',
    ]
    for pat in deal_patterns:
        m = re.search(pat, title)
        if m:
            deal = m.group(1)
            break

    is_product = bool(price or deal)

    entry = {
        'title': title,
        'image': image,
        'start_date': date,
        'end_date': '',
        'link': link,
        'description': '',
        'type': 'product' if is_product else 'campaign',
    }
    if deal:
        entry['deal'] = deal
    if price:
        entry['price'] = price

    promotions.append(entry)


def scrape_with_playwright():
    """用 Playwright 渲染後抓取"""
    from playwright.sync_api import sync_playwright

    promotions = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_extra_http_headers({'User-Agent': HEADERS['User-Agent']})

        try:
            page.goto(f'{BASE}/catalogues/', timeout=30000)
            page.wait_for_load_state('networkidle', timeout=15000)
        except Exception:
            page.wait_for_timeout(5000)

        soup = BeautifulSoup(page.content(), 'lxml')
        extract_from_html(soup, promotions)
        browser.close()

    return promotions


def save(promotions):
    os.makedirs(DATA_DIR, exist_ok=True)
    result = {
        'store': '家樂福',
        'store_id': 'carrefour',
        'logo': f'{BASE}/favicon.ico',
        'website': BASE,
        'scraped_at': datetime.now().isoformat(),
        'promotions': promotions,
    }
    path = os.path.join(DATA_DIR, 'carrefour.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'[家樂福] 抓到 {len(promotions)} 筆優惠，已儲存到 {path}')
    return result


if __name__ == '__main__':
    scrape()
