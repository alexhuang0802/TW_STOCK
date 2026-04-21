"""萊爾富 優惠活動爬蟲 (使用 curl_cffi 繞過 Akamai WAF) - 含商品級優惠"""
import json
import os
import re
from datetime import datetime

from curl_cffi import requests
from bs4 import BeautifulSoup

from categorize import categorize_promotions

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
BASE = 'https://www.hilife.com.tw'
NOW = datetime.now()

DEAL_KEYWORDS = [
    '買1送1', '買一送一', '買2送2', '買3送3',
    '第2件', '第二件', '半價', '特價', '元',
    '折', '加購', '任選', '送一', '2杯',
]


def scrape():
    promotions = []

    # 1. 首頁輪播 - 商品優惠
    try:
        resp = requests.get(BASE, impersonate='chrome', timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'lxml')

        slider = soup.select_one('#video-gallery, .royalSlider')
        if slider:
            for a_tag in slider.select('a[href]'):
                href = a_tag.get('href', '').strip()
                if not href or href == '#':
                    continue
                img = a_tag.select_one('img')
                title_el = a_tag.select_one('h5, .rsTmb h5')
                title = title_el.get_text(strip=True) if title_el else ''
                if not title:
                    continue

                link = href if href.startswith('http') else fix_url(href)
                is_product = any(kw in title for kw in DEAL_KEYWORDS)
                deal = extract_deal_type(title) if is_product else ''

                promotions.append({
                    'title': title,
                    'image': fix_url(img.get('src', '')) if img else '',
                    'start_date': '',
                    'end_date': '',
                    'link': link,
                    'description': f'萊爾富 · {deal}' if deal else '',
                    'type': 'product' if is_product else 'campaign',
                    'deal': deal,
                })
    except Exception as e:
        print(f'[萊爾富] 首頁抓取失敗: {e}')

    # 2. 活動列表頁面 - 抓日期
    try:
        activity_resp = requests.get(f'{BASE}/events_activity.aspx', impersonate='chrome', timeout=30)
        if activity_resp.status_code == 200:
            activity_soup = BeautifulSoup(activity_resp.text, 'lxml')
            parse_activity_list(activity_soup, promotions)
    except Exception as e:
        print(f'[萊爾富] 活動列表抓取失敗: {e}')

    # 3. 側邊資訊欄 (infoBox)
    try:
        resp2 = requests.get(BASE, impersonate='chrome', timeout=30)
        soup2 = BeautifulSoup(resp2.text, 'lxml')
        for dl in soup2.select('dl.infoBox'):
            for dd in dl.select('dd'):
                a_tag = dd.select_one('a')
                if a_tag:
                    title = a_tag.get_text(strip=True)
                    href = a_tag.get('href', '')
                    link = href if href.startswith('http') else f'{BASE}/{href}'
                    if title and not any(p['title'] == title for p in promotions):
                        is_product = any(kw in title for kw in DEAL_KEYWORDS)
                        deal = extract_deal_type(title) if is_product else ''
                        promotions.append({
                            'title': title,
                            'image': '',
                            'start_date': '',
                            'end_date': '',
                            'link': link,
                            'description': f'萊爾富 · {deal}' if deal else '',
                            'type': 'product' if is_product else 'campaign',
                            'deal': deal,
                        })
    except Exception:
        pass

    # 自動分類
    promotions = categorize_promotions(promotions)

    return save(promotions)


def parse_activity_list(soup, promotions):
    """從活動列表頁面抓取活動，包含日期
    結構: ul.activityList > li > [a>img] + [div > a(標題) + h3(日期) + p(描述)]
    """
    # 建立已存在的標題對照表（用來更新日期）
    existing = {p['title']: p for p in promotions}

    for li in soup.select('ul.activityList > li'):
        title_a = li.select_one('div > a')
        if not title_a:
            continue
        title = title_a.get_text(strip=True)
        if not title or len(title) < 2:
            continue

        # 連結
        href = title_a.get('href', '')
        link = href if href.startswith('http') else f'{BASE}/{href}'

        # 圖片
        img = li.select_one('a > img')
        image = fix_url(img.get('src', '')) if img else ''

        # 日期：h3 標籤，格式 "活動期間： YYYY-MM-DD ~ YYYY-MM-DD"
        start_date, end_date = '', ''
        h3 = li.select_one('h3')
        if h3:
            h3_text = h3.get_text(strip=True)
            m = re.search(r'(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})', h3_text)
            if m:
                start_date = m.group(1)
                end_date = m.group(2)
            else:
                s, e = parse_date_range(h3_text)
                if s:
                    start_date, end_date = s, e

        # 過濾已過期
        if end_date:
            try:
                end_dt = datetime.strptime(end_date, '%Y-%m-%d')
                if end_dt < NOW:
                    continue
            except ValueError:
                pass

        # 如果已存在（從首頁輪播抓的），更新日期和圖片
        if title in existing:
            if start_date:
                existing[title]['start_date'] = start_date
                existing[title]['end_date'] = end_date
            if image and not existing[title].get('image'):
                existing[title]['image'] = image
            continue

        is_product = any(kw in title for kw in DEAL_KEYWORDS)
        deal = extract_deal_type(title) if is_product else ''

        new_promo = {
            'title': title,
            'image': image,
            'start_date': start_date,
            'end_date': end_date,
            'link': link,
            'description': f'萊爾富 · {deal}' if deal else '',
            'type': 'product' if is_product else 'campaign',
            'deal': deal,
        }
        promotions.append(new_promo)
        existing[title] = new_promo


def extract_deal_type(title):
    """從標題中提取優惠類型"""
    patterns = [
        r'買\d+送\d+', r'同品項買\d+送\d+',
        r'第\d+件\d+折', r'第\d+件\d+元', r'第二件半價',
        r'\d+杯\d+元', r'\d+件\d+元',
        r'特價\d+元', r'單杯特價\d+元', r'單件特價\d+元',
        r'任選?\d+件?\d+元',
    ]
    for pattern in patterns:
        match = re.search(pattern, title)
        if match:
            return match.group()
    if '買一送一' in title or '買1送1' in title:
        return '買一送一'
    if '半價' in title:
        return '半價'
    if '特價' in title:
        m = re.search(r'特價\d+元', title)
        return m.group() if m else '特價'
    return ''


def parse_date_range(text):
    """從文字中提取日期範圍"""
    if not text:
        return '', ''
    # YYYY/MM/DD ~ YYYY/MM/DD
    m = re.search(r'(\d{4})[/.](\d{1,2})[/.](\d{1,2})\s*[~\-至]\s*(\d{4})[/.](\d{1,2})[/.](\d{1,2})', text)
    if m:
        start = f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
        end = f'{m.group(4)}-{int(m.group(5)):02d}-{int(m.group(6)):02d}'
        return start, end
    # MM/DD ~ MM/DD (同年)
    m = re.search(r'(\d{1,2})[/.](\d{1,2})\s*[~\-至]\s*(\d{1,2})[/.](\d{1,2})', text)
    if m:
        year = NOW.year
        start = f'{year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}'
        end = f'{year}-{int(m.group(3)):02d}-{int(m.group(4)):02d}'
        return start, end
    return '', ''


def fix_url(url):
    if not url:
        return ''
    if url.startswith('./'):
        return f'{BASE}/{url[2:]}'
    if url.startswith('/'):
        return f'{BASE}{url}'
    if not url.startswith('http'):
        return f'{BASE}/{url}'
    return url


def save(promotions):
    os.makedirs(DATA_DIR, exist_ok=True)
    result = {
        'store': '萊爾富',
        'store_id': 'hilife',
        'logo': f'{BASE}/favicon.ico',
        'website': BASE,
        'scraped_at': datetime.now().isoformat(),
        'promotions': promotions,
    }
    path = os.path.join(DATA_DIR, 'hilife.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'[萊爾富] 抓到 {len(promotions)} 筆優惠，已儲存到 {path}')
    return result


if __name__ == '__main__':
    scrape()
