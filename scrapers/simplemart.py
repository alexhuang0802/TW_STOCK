"""美廉社 優惠活動爬蟲 - 深入活動頁面抓商品"""
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
BASE = 'https://www.simplemart.com.tw'
EVENT_BASE = 'https://event.simplemart.com.tw'
NOW = datetime.now()


def scrape():
    promotions = []
    event_links = []

    resp = requests.get(BASE, headers=HEADERS, timeout=30)
    resp.encoding = 'utf-8'
    soup = BeautifulSoup(resp.text, 'lxml')

    # 1. 抓取 Banner 活動圖連結
    for a_tag in soup.select('a[href*="event.simplemart.com.tw"], a[href*="pj_id"]'):
        img = a_tag.select_one('img')
        link = a_tag.get('href', '')
        if not link.startswith('http'):
            link = f'{BASE}/{link}'
        title = img.get('alt', '') if img else ''
        image = img.get('src', '') if img else ''
        if not title and image:
            title = image.split('/')[-1].replace('.jpg', '').replace('.png', '')

        promotions.append({
            'title': title or '美廉社活動',
            'image': image,
            'start_date': '',
            'end_date': '',
            'link': link,
            'description': '',
            'type': 'campaign',
        })

        # 記住活動連結，稍後深入抓
        if 'event.simplemart.com.tw' in link:
            event_links.append(link)

    # 2. 深入每個活動頁面抓取商品級優惠
    for event_url in event_links:
        try:
            products = scrape_event_page(event_url)
            promotions.extend(products)
        except Exception as e:
            print(f'[美廉社] 活動頁面 {event_url} 抓取失敗: {e}')

    # 3. 抓 DM 頁面的商品
    try:
        dm_promos = scrape_dm_page()
        promotions.extend(dm_promos)
    except Exception as e:
        print(f'[美廉社] DM 頁面抓取失敗: {e}')

    # 4. 最新消息
    for a_tag in soup.select('a[href*="headLineContext.asp"]'):
        title = a_tag.get_text(strip=True)
        href = a_tag.get('href', '')
        link = f'{BASE}/{href}' if not href.startswith('http') else href
        if title and not any(p['title'] == title for p in promotions):
            promotions.append({
                'title': title,
                'image': '',
                'start_date': '',
                'end_date': '',
                'link': link,
                'description': '最新消息',
                'type': 'campaign',
            })

    # 自動分類
    promotions = categorize_promotions(promotions)

    return save(promotions)


def scrape_event_page(url):
    """深入活動頁面，提取商品級優惠"""
    products = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.encoding = 'utf-8'
        soup = BeautifulSoup(resp.text, 'lxml')

        # 找商品圖+文字區塊
        # 美廉社活動頁面常見結構：圖片 + 商品名 + 價格/優惠標籤
        # 嘗試多種選擇器

        # 方法1：找所有商品圖片+價格的組合
        for img in soup.select('img'):
            src = img.get('src', '')
            alt = img.get('alt', '')
            if not src:
                continue

            # 找圖片附近的文字
            parent = img.parent
            if not parent:
                continue

            text = parent.get_text(' ', strip=True)

            # 檢查是否包含優惠關鍵字
            deal_kws = ['買一送一', '買1送1', '第二件', '半價', '特價', '折扣',
                        '任選', '加購', '元', '折', '送']
            has_deal = any(kw in text for kw in deal_kws)

            # 也檢查價格模式
            has_price = bool(re.search(r'\$?\d+元|\$\d+|售價\d+', text))

            if (has_deal or has_price) and len(text) > 3 and len(text) < 200:
                # 嘗試提取商品名和優惠
                deal = extract_deal(text)
                if deal:
                    if not src.startswith('http'):
                        src = f'{EVENT_BASE}/{src.lstrip("/")}'

                    products.append({
                        'title': f'{text[:60]}',
                        'image': src,
                        'start_date': '',
                        'end_date': '',
                        'link': url,
                        'description': f'美廉社 · {deal}',
                        'type': 'product',
                        'deal': deal,
                    })

        # 方法2：找表格中的商品（美廉社常用表格排列）
        for td in soup.select('td'):
            text = td.get_text(' ', strip=True)
            if len(text) < 3 or len(text) > 150:
                continue

            deal = extract_deal(text)
            if deal:
                img = td.select_one('img')
                image = ''
                if img:
                    image = img.get('src', '')
                    if image and not image.startswith('http'):
                        image = f'{EVENT_BASE}/{image.lstrip("/")}'

                title = clean_title(text)
                if title and not any(p['title'] == title for p in products):
                    products.append({
                        'title': title,
                        'image': image,
                        'start_date': '',
                        'end_date': '',
                        'link': url,
                        'description': f'美廉社 · {deal}',
                        'type': 'product',
                        'deal': deal,
                    })

    except Exception as e:
        print(f'[美廉社] 解析活動頁面失敗: {e}')

    return products


def scrape_dm_page():
    """從 DM 頁面抓取連結"""
    promotions = []
    dm_resp = requests.get(f'{BASE}/ec99/ushop20097/dm.asp', headers=HEADERS, timeout=30)
    dm_resp.encoding = 'utf-8'
    dm_soup = BeautifulSoup(dm_resp.text, 'lxml')

    for a_tag in dm_soup.select('a[href$=".pdf"], a[href$=".PDF"]'):
        link = a_tag.get('href', '')
        if not link.startswith('http'):
            link = f'{BASE}/{link.lstrip("/")}'

        # 從 PDF 檔名提取標題
        filename = link.split('/')[-1]
        # 去掉日期前綴和副檔名
        title = re.sub(r'^\d{8}[=_]?', '', filename)
        title = re.sub(r'\.(pdf|PDF)$', '', title)
        title = re.sub(r'[_-]', ' ', title).strip()
        if not title:
            title = '美廉社 DM'

        # 嘗試從檔名提取日期
        date_match = re.search(r'(\d{4})(\d{2})(\d{2})', filename)
        start_date = ''
        if date_match:
            start_date = f'{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}'

        btn_text = a_tag.get_text(strip=True)
        parent_text = a_tag.parent.get_text(' ', strip=True) if a_tag.parent else ''

        promotions.append({
            'title': title if title != '美廉社 DM' else parent_text[:50] or title,
            'image': '',
            'start_date': start_date,
            'end_date': '',
            'link': link,
            'description': 'DM傳單',
            'type': 'campaign',
        })

    return promotions


def extract_deal(text):
    """從文字中提取優惠類型"""
    patterns = [
        r'買\d+送\d+', r'買一送一',
        r'第\d+件\d+折', r'第二件半價', r'第\d+件\d+元',
        r'任選?\d+件?\d+元', r'\d+件\d+折',
        r'特價\d+元', r'加\d+元',
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return m.group()
    if '特價' in text:
        return '特價'
    if '優惠' in text:
        return '優惠'
    return ''


def clean_title(text):
    """清理標題文字"""
    # 去掉多餘空白
    text = re.sub(r'\s+', ' ', text).strip()
    # 截斷太長的
    if len(text) > 60:
        text = text[:60] + '...'
    return text


def save(promotions):
    os.makedirs(DATA_DIR, exist_ok=True)
    result = {
        'store': '美廉社',
        'store_id': 'simplemart',
        'logo': 'https://www.simplemart.com.tw/favicon.ico',
        'website': BASE,
        'scraped_at': datetime.now().isoformat(),
        'promotions': promotions,
    }
    path = os.path.join(DATA_DIR, 'simplemart.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'[美廉社] 抓到 {len(promotions)} 筆優惠，已儲存到 {path}')
    return result


if __name__ == '__main__':
    scrape()
