"""優惠新聞爬蟲 - 從 Google News 抓取超商/超市/咖啡優惠相關新聞"""
import json
import os
import re
from datetime import datetime

import requests
from bs4 import BeautifulSoup

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-TW,zh;q=0.9',
}

# 搜尋關鍵字
KEYWORDS = [
    '超商 買一送一',
    '超商 優惠',
    '星巴克 買一送一',
    '全聯 優惠',
    '家樂福 優惠',
    '超市 特價',
    '咖啡 寄杯 優惠',
    '超商 咖啡 優惠',
    '超商 第二件半價',
    '超商 第二件10元',
    '便利商店 買一送一',
    '超市 買一送一',
]


def scrape():
    promotions = []

    for keyword in KEYWORDS:
        try:
            items = search_google_news(keyword)
            for item in items:
                # 避免重複
                if not any(p['title'] == item['title'] for p in promotions):
                    promotions.append(item)
        except Exception as e:
            print(f'[新聞] "{keyword}" 搜尋失敗: {e}')

    return save(promotions)


def search_google_news(keyword):
    """透過 Google News RSS 搜尋新聞"""
    items = []

    # 使用 Google News RSS feed
    url = f'https://news.google.com/rss/search?q={keyword}+when:7d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant'
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.encoding = 'utf-8'
        if resp.status_code == 200:
            items.extend(parse_rss(resp.text, keyword))
    except Exception as e:
        print(f'[新聞] Google News RSS 失敗: {e}')

    return items


def parse_rss(xml_text, keyword):
    """解析 RSS XML"""
    items = []
    soup = BeautifulSoup(xml_text, 'lxml-xml')

    for item in soup.select('item'):
        title_el = item.select_one('title')
        link_el = item.select_one('link')
        pub_date_el = item.select_one('pubDate')
        source_el = item.select_one('source')

        title = title_el.get_text(strip=True) if title_el else ''
        if not title:
            continue

        # 過濾：標題必須包含優惠相關關鍵字
        has_deal_keyword = any(kw in title for kw in [
            '優惠', '特價', '折扣', '買一送一', '半價', '免費',
            '送', '折', '省', '降價', '促銷', '回饋', '加購',
            '寄杯', '限時', '好康', '划算', '撿便宜', '必買',
            '買1送1', '第二件', '銅板價', '均一價',
            '第二件半價', '第二件10元', '第2件', '買2送2',
            '買3送3', '買5送5', '加1元多1件',
        ])
        if not has_deal_keyword:
            continue

        link = link_el.get_text(strip=True) if link_el else ''
        source = source_el.get_text(strip=True) if source_el else ''

        # 解析日期
        pub_date = ''
        if pub_date_el:
            try:
                dt = datetime.strptime(
                    pub_date_el.get_text(strip=True),
                    '%a, %d %b %Y %H:%M:%S %Z'
                )
                pub_date = dt.strftime('%Y-%m-%d')
            except (ValueError, AttributeError):
                pass

        items.append({
            'title': title,
            'image': '',
            'start_date': pub_date,
            'end_date': '',
            'link': link,
            'description': f'來源：{source}' if source else '優惠新聞',
            'type': 'campaign',
        })

    return items


def save(promotions):
    os.makedirs(DATA_DIR, exist_ok=True)
    result = {
        'store': '優惠新聞',
        'store_id': 'news',
        'logo': '',
        'website': 'https://news.google.com',
        'scraped_at': datetime.now().isoformat(),
        'promotions': promotions,
    }
    path = os.path.join(DATA_DIR, 'news.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'[優惠新聞] 抓到 {len(promotions)} 筆新聞，已儲存到 {path}')
    return result


if __name__ == '__main__':
    scrape()
