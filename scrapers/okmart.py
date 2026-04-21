"""OK超商 優惠活動爬蟲"""
import json
import os
from datetime import datetime

import requests
from bs4 import BeautifulSoup

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}
BASE = 'https://www.okmart.com.tw'


def scrape():
    promotions = []

    # 1. 首頁活動
    resp = requests.get(BASE, headers=HEADERS, timeout=30)
    resp.encoding = 'utf-8'
    soup = BeautifulSoup(resp.text, 'lxml')

    for a_tag in soup.select('a[href*="promotion_referenceDetail"]'):
        img = a_tag.select_one('img')
        h5 = a_tag.select_one('h5')
        href = a_tag.get('href', '')
        link = f'{BASE}/{href}' if not href.startswith('http') else href

        title = h5.get_text(strip=True) if h5 else ''
        image = img.get('src', '') if img else ''
        if image and not image.startswith('http'):
            image = f'{BASE}/{image}'

        if title:
            promotions.append({
                'title': title,
                'image': image,
                'start_date': '',
                'end_date': '',
                'link': link,
                'description': '',
                'type': 'campaign',
            })

    # 2. 活動總覽頁
    try:
        promo_resp = requests.get(f'{BASE}/promotion_reference', headers=HEADERS, timeout=30)
        promo_resp.encoding = 'utf-8'
        promo_soup = BeautifulSoup(promo_resp.text, 'lxml')

        for a_tag in promo_soup.select('a[href*="promotion_referenceDetail"]'):
            img = a_tag.select_one('img')
            h5 = a_tag.select_one('h5, h4, h3, .title')
            title_text = h5.get_text(strip=True) if h5 else a_tag.get_text(strip=True)
            href = a_tag.get('href', '')
            link = f'{BASE}/{href}' if not href.startswith('http') else href

            image = img.get('src', '') if img else ''
            if image and not image.startswith('http'):
                image = f'{BASE}/{image}'

            if title_text and not any(p['title'] == title_text for p in promotions):
                promotions.append({
                    'title': title_text,
                    'image': image,
                    'start_date': '',
                    'end_date': '',
                    'link': link,
                    'description': '',
                    'type': 'campaign',
                })
    except Exception as e:
        print(f'[OK超商] 活動總覽頁抓取失敗: {e}')

    # 3. 最新消息
    for a_tag in soup.select('a[href*="newsDetail"]'):
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

    return save(promotions)


def save(promotions):
    os.makedirs(DATA_DIR, exist_ok=True)
    result = {
        'store': 'OK超商',
        'store_id': 'okmart',
        'logo': f'{BASE}/favicon.ico',
        'website': BASE,
        'scraped_at': datetime.now().isoformat(),
        'promotions': promotions,
    }
    path = os.path.join(DATA_DIR, 'okmart.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'[OK超商] 抓到 {len(promotions)} 筆優惠，已儲存到 {path}')
    return result


if __name__ == '__main__':
    scrape()
