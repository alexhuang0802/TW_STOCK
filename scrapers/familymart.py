"""全家便利商店 優惠活動爬蟲 - 含 Event 頁面日期"""
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
BASE = 'https://www.family.com.tw'
NOW = datetime.now()

# 排除的垃圾標題
EXCLUDE_TITLES = {
    '繁體中文', 'English', '日本語', '简体中文', 'ภาษาไทย', 'Tiếng Việt',
    '首頁', '門市查詢', '會員專區', '下載APP', '登入', '註冊', '搜尋',
    'Logo', '全家便利商店', 'FamilyMart', '更多', '查看全部',
}


def scrape():
    promotions = []

    # 1. 優先抓 Event 頁面（有日期資訊）
    try:
        resp = requests.get(f'{BASE}/Marketing/zh/Event', headers=HEADERS, timeout=30)
        resp.encoding = 'utf-8'
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'lxml')
            extract_event_page(soup, promotions)
            print(f'[全家] Event 頁面抓到 {len(promotions)} 筆')
    except Exception as e:
        print(f'[全家] Event 頁面抓取失敗: {e}')

    # 2. 行銷活動頁面補充
    urls = [
        f'{BASE}/Marketing/index.aspx',
        f'{BASE}/Marketing/promotions.aspx',
    ]
    for url in urls:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.encoding = 'utf-8'
            if resp.status_code != 200:
                continue
            soup = BeautifulSoup(resp.text, 'lxml')
            extract_promotions(soup, promotions)
        except Exception as e:
            print(f'[全家] {url} 抓取失敗: {e}')

    promotions = categorize_promotions(promotions)
    return save(promotions)


def extract_event_page(soup, promotions):
    """從 /Marketing/zh/Event 頁面提取活動（有日期和分類）"""
    # 找所有帶連結的活動項目
    for a_tag in soup.select('a[href]'):
        href = a_tag.get('href', '')
        if not any(kw in href for kw in ['nevent.family.com.tw', 'event.family.com.tw', 'fami.tw', 'reurl.cc']):
            continue

        img = a_tag.select_one('img')
        h6 = a_tag.find_next('h6') if not a_tag.select_one('h6') else a_tag.select_one('h6')

        title = ''
        if h6:
            title = h6.get_text(strip=True)
        if not title and img:
            title = img.get('alt', '')
        if not title:
            title = a_tag.get_text(strip=True)[:60]
        if not title or title in EXCLUDE_TITLES or len(title) < 2:
            continue

        link = href if href.startswith('http') else f'{BASE}{href}'

        image = ''
        if img:
            src = img.get('data-src') or img.get('src') or ''
            if src.startswith('http'):
                image = src
            elif src.startswith('/'):
                image = f'{BASE}{src}'

        # 尋找日期 span
        start_date = ''
        end_date = ''
        parent = a_tag.parent or a_tag
        spans = parent.select('span') if parent else []
        for span in spans:
            text = span.get_text(strip=True)
            # 匹配 YYYY/MM/DD - YYYY/MM/DD
            m = re.search(r'(\d{4}/\d{2}/\d{2})\s*-\s*(\d{4}/\d{2}/\d{2})', text)
            if m:
                start_date = m.group(1).replace('/', '-')
                end_date = m.group(2).replace('/', '-')
                break
            # 匹配 長期活動
            if '長期' in text:
                start_date = ''
                end_date = ''
                break

        # 過濾已過期
        if end_date:
            try:
                end_dt = datetime.strptime(end_date, '%Y-%m-%d')
                if end_dt < NOW:
                    continue
            except ValueError:
                pass

        if any(p['title'] == title for p in promotions):
            continue

        promotions.append({
            'title': title,
            'image': image,
            'start_date': start_date,
            'end_date': end_date,
            'link': link,
            'description': '',
            'type': 'campaign',
        })


def extract_promotions(soup, promotions):
    """從 HTML 中提取活動資訊"""
    for a_tag in soup.select('a[href]'):
        href = a_tag.get('href', '')
        is_event = any(kw in href for kw in [
            'nevent.family.com.tw',
            'event.family.com.tw',
        ])
        is_marketing_with_img = '/Marketing/' in href and a_tag.select_one('img')

        if not is_event and not is_marketing_with_img:
            continue
        if 'userLang' in href or 'login' in href or 'register' in href:
            continue

        img = a_tag.select_one('img')
        title_el = a_tag.select_one('h6, h5, h4, h3, .title')

        title = title_el.get_text(strip=True) if title_el else ''
        if not title and img:
            title = img.get('alt', '')
        if not title:
            title = a_tag.get_text(strip=True)[:60]
        if not title or title in EXCLUDE_TITLES or len(title) < 2:
            continue

        link = href if href.startswith('http') else f'{BASE}{href}'
        image = ''
        if img:
            src = img.get('data-src') or img.get('src') or ''
            if src.startswith('http'):
                image = src
            elif src:
                image = f'{BASE}{src}'

        if any(p['title'] == title for p in promotions):
            continue

        promotions.append({
            'title': title,
            'image': image,
            'start_date': '',
            'end_date': '',
            'link': link,
            'description': '',
            'type': 'campaign',
        })


def save(promotions):
    os.makedirs(DATA_DIR, exist_ok=True)
    result = {
        'store': '全家',
        'store_id': 'familymart',
        'logo': f'{BASE}/favicon.ico',
        'website': BASE,
        'scraped_at': datetime.now().isoformat(),
        'promotions': promotions,
    }
    path = os.path.join(DATA_DIR, 'familymart.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'[全家] 抓到 {len(promotions)} 筆優惠，已儲存到 {path}')
    return result


if __name__ == '__main__':
    scrape()
