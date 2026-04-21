"""全聯福利中心 優惠活動爬蟲 - 含商品級優惠"""
import json
import os
import re
from datetime import datetime
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

from categorize import categorize_promotions

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}

# 生活誌商品優惠頁面
LIFE_WILL_URL = 'https://www.pxmart.com.tw/campaign/life-will'
BEST_BUY_URL = 'https://www.pxmart.com.tw/campaign/life-will/best-buy'

NOW = datetime.now()


def scrape():
    promotions = []

    # 1. 從生活誌抓取商品級優惠 (主要資料來源)
    product_promos = scrape_life_will_products()
    promotions.extend(product_promos)

    # 2. 從活動頁面抓取活動級優惠 (滿額送、集點等)
    campaign_promos = scrape_campaigns()
    promotions.extend(campaign_promos)

    # 3. 自動分類
    promotions = categorize_promotions(promotions)

    return save(promotions)


def scrape_life_will_products():
    """從全聯生活誌 best-buy 頁面抓取商品級優惠"""
    promotions = []

    # 先取得目前有哪些分類
    try:
        resp = requests.get(LIFE_WILL_URL, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'lxml')
        script_tag = soup.find('script', id='__NEXT_DATA__')
        if not script_tag:
            print('[全聯] 生活誌: 找不到 __NEXT_DATA__')
            return promotions

        data = json.loads(script_tag.string)
        props = data.get('props', {}).get('pageProps', {})

        # 取得 parentCategories 列表
        parent_cats = props.get('parentCategories', [])
        if not parent_cats:
            # 嘗試直接抓 best-buy 頁面
            parent_cats = [{'name': ''}]

        print(f'[全聯] 生活誌: 找到 {len(parent_cats)} 個分類')

    except Exception as e:
        print(f'[全聯] 生活誌首頁抓取失敗: {e}')
        # fallback: 嘗試直接抓 best-buy
        parent_cats = [{'name': ''}]

    # 逐一抓取每個分類的商品
    for cat in parent_cats:
        cat_name = cat.get('name', '')
        try:
            if cat_name:
                url = f'{BEST_BUY_URL}/{quote(cat_name)}'
            else:
                url = BEST_BUY_URL

            resp = requests.get(url, headers=HEADERS, timeout=30)
            if resp.status_code != 200:
                continue

            soup = BeautifulSoup(resp.text, 'lxml')
            script_tag = soup.find('script', id='__NEXT_DATA__')
            if not script_tag:
                continue

            page_data = json.loads(script_tag.string)
            page_props = page_data.get('props', {}).get('pageProps', {})
            categories = page_props.get('categories', [])

            for sub_cat in categories:
                sub_cat_title = sub_cat.get('title', '')
                products = sub_cat.get('group', [])

                for product in products:
                    name = product.get('name', '')
                    if not name:
                        continue

                    promotion_tag = product.get('promotionTag', '')
                    price = product.get('price')
                    code = product.get('code', '')
                    start_date = product.get('startDate', '')
                    end_date = product.get('endDate', '')

                    # 過濾已過期
                    if end_date:
                        try:
                            end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                            if end_dt.replace(tzinfo=None) < NOW:
                                continue
                        except (ValueError, TypeError):
                            pass

                    # 格式化日期
                    fmt_start = format_iso_date(start_date)
                    fmt_end = format_iso_date(end_date)

                    # 圖片
                    image = f'https://www.pxmart.com.tw/Api/Images/Goods/{code}.png' if code else ''

                    # 組合標題：商品名 + 優惠標籤
                    if promotion_tag:
                        title = f'{name} — {promotion_tag}'
                    else:
                        title = name

                    price_str = f'${price}' if price else ''

                    promotions.append({
                        'title': title,
                        'image': image,
                        'start_date': fmt_start,
                        'end_date': fmt_end,
                        'link': 'https://www.pxmart.com.tw/campaign/life-will',
                        'description': f'{sub_cat_title} · {price_str}' if price_str else sub_cat_title,
                        'type': 'product',
                        'deal': promotion_tag,
                        'price': price,
                        'category': cat_name or sub_cat_title,
                    })

            print(f'[全聯] 分類 "{cat_name}": 抓到 {len(categories)} 子分類')

        except Exception as e:
            print(f'[全聯] 分類 "{cat_name}" 抓取失敗: {e}')

    print(f'[全聯] 生活誌共抓到 {len(promotions)} 筆商品優惠')
    return promotions


def scrape_campaigns():
    """從 /campaign/latest 抓取活動級優惠（滿額送、集點等）"""
    promotions = []
    try:
        url = 'https://www.pxmart.com.tw/campaign/latest'
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'lxml')
        script_tag = soup.find('script', id='__NEXT_DATA__')
        if not script_tag:
            return promotions

        data = json.loads(script_tag.string)
        props = data.get('props', {}).get('pageProps', {})
        campaigns = props.get('campaigns') or []

        for item in campaigns:
            attrs = item.get('attributes', item)
            title = attrs.get('title', '')
            if not title:
                continue

            item_id = item.get('id', '')
            link = f'https://www.pxmart.com.tw/campaign/latest/{item_id}' if item_id else ''

            # 圖片
            cover_data = attrs.get('listCover', {})
            image = ''
            if isinstance(cover_data, dict):
                inner = cover_data.get('data', {})
                if isinstance(inner, dict):
                    cover_attrs = inner.get('attributes', {})
                    image = cover_attrs.get('url', '')

            start_date = attrs.get('openDate', '')
            end_date = attrs.get('closeDate', '')

            # 過濾已過期
            if end_date:
                try:
                    end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                    if end_dt.replace(tzinfo=None) < NOW:
                        continue
                except (ValueError, TypeError):
                    pass

            promotions.append({
                'title': title,
                'image': image,
                'start_date': start_date[:10] if start_date else '',
                'end_date': end_date[:10] if end_date else '',
                'link': link,
                'description': attrs.get('label') or '',
                'type': 'campaign',
            })

    except Exception as e:
        print(f'[全聯] 活動頁面抓取失敗: {e}')

    print(f'[全聯] 活動頁面抓到 {len(promotions)} 筆活動')
    return promotions


def format_iso_date(iso_str):
    """將 ISO 日期轉為 YYYY-MM-DD"""
    if not iso_str:
        return ''
    try:
        dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        return dt.strftime('%Y-%m-%d')
    except (ValueError, TypeError):
        return iso_str[:10] if len(iso_str) >= 10 else iso_str


def save(promotions):
    os.makedirs(DATA_DIR, exist_ok=True)
    result = {
        'store': '全聯',
        'store_id': 'pxmart',
        'logo': 'https://www.pxmart.com.tw/favicon.ico',
        'website': 'https://www.pxmart.com.tw',
        'scraped_at': datetime.now().isoformat(),
        'promotions': promotions,
    }
    path = os.path.join(DATA_DIR, 'pxmart.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'[全聯] 共 {len(promotions)} 筆優惠，已儲存到 {path}')
    return result


if __name__ == '__main__':
    scrape()
