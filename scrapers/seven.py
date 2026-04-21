"""7-ELEVEN 優惠活動爬蟲 - 含商品級優惠解析"""
import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime

import requests
from bs4 import BeautifulSoup

from categorize import categorize_promotions

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': 'https://www.7-11.com.tw/',
}
BASE = 'https://www.7-11.com.tw'
NOW = datetime.now()
TODAY_STR = NOW.strftime('%Y%m%d')


def scrape():
    promotions = []

    # 透過 readxml.aspx 取得各類活動
    for num in [0, 1, 2, 6]:
        try:
            resp = requests.post(
                f'{BASE}/readxml.aspx',
                data=f'num={num}',
                headers=HEADERS,
                timeout=30,
            )
            resp.encoding = 'utf-8'
            items = parse_xml_response(resp.text)
            for item in items:
                if not any(p['title'] == item['title'] for p in promotions):
                    promotions.append(item)
        except Exception as e:
            print(f'[7-ELEVEN] num={num} 抓取失敗: {e}')

    if not promotions:
        promotions = scrape_html_fallback()

    promotions = categorize_promotions(promotions)
    return save(promotions)


def parse_xml_response(xml_text):
    """解析 readxml.aspx 的 XML"""
    items = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    for item_el in root.findall('Item'):
        # 取得各欄位
        fields = {}
        for child in item_el:
            fields[child.tag] = (child.text or '').strip()

        title = fields.get('APP_BannerTitle', '') or fields.get('Title', '')
        if not title:
            continue

        sdate = fields.get('SDate', '')
        edate = fields.get('EDate', '')
        link = fields.get('Link', '')
        image = fields.get('Image', '')
        content = fields.get('Content', '')
        remark = fields.get('Remark', '')
        itype = fields.get('IType', '')

        # 修正 URL
        if link and not link.startswith('http'):
            link = f'{BASE}/{link.lstrip("/")}'
        if image and not image.startswith('http'):
            image = f'{BASE}/{image.lstrip("/")}'

        # 過濾已過期（日期格式：YYYYMMDD）
        if edate and edate != '99999999':
            try:
                if int(edate) < int(TODAY_STR):
                    continue
            except ValueError:
                pass

        fmt_sdate = format_date(sdate)
        fmt_edate = format_date(edate)

        # 嘗試從 Remark 提取商品級優惠
        if remark:
            product_items = parse_remark_products(remark, link, image, fmt_sdate, fmt_edate)
            if product_items:
                items.extend(product_items)
                # 也保留活動本身
                items.append({
                    'title': title,
                    'image': image,
                    'start_date': fmt_sdate,
                    'end_date': fmt_edate,
                    'link': link or BASE,
                    'description': content or itype,
                    'type': 'campaign',
                })
                continue

        items.append({
            'title': title,
            'image': image,
            'start_date': fmt_sdate,
            'end_date': fmt_edate,
            'link': link or BASE,
            'description': content or itype,
            'type': 'campaign',
        })

    return items


def parse_remark_products(remark_html, link, image, start_date, end_date):
    """從 Remark HTML 中解析商品名 + 優惠類型（三種模式）"""
    products = []

    # 去掉 HTML，保留換行
    text = re.sub(r'<br\s*/?\s*>', '\n', remark_html, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&')

    # === 模式1: 超值組合 - 【XX元餐食品項】格式 ===
    combo_pattern = re.compile(r'【(\d+)元餐[^】]*】')
    if combo_pattern.search(text):
        products.extend(_parse_combo_meals(text, link, image, start_date, end_date))

    # === 模式2: 指定商品加碼 - "N.買N送N:商品A、商品B" 格式 ===
    numbered_deal = re.compile(
        r'\d+\.\s*(買\d+送\d+|買一送一|任選買?\d+送\d+|第\d+件\d+[折元]|其他)\s*[:：]\s*(.+)',
        re.IGNORECASE
    )
    if numbered_deal.search(text):
        products.extend(_parse_numbered_deals(text, numbered_deal, link, image, start_date, end_date))

    # === 模式3: 原有的【日期 優惠類型】格式 ===
    if not products:
        deal_pattern = re.compile(
            r'【[^】]*?(買一送一|買\d+送\d+|第\d+件\d+折|第\d+件\d+元|第二件半價|'
            r'\d+件\d+折|\d+件\d+元|任選?\d+件?\d+元|加\d+元多一件|'
            r'任選第二件\d+折|同品項買\d+送\d+|單件\d+折)[^】]*?】',
            re.IGNORECASE
        )
        blocks = deal_pattern.split(text)
        deal_types = deal_pattern.findall(text)

        for i, deal_type in enumerate(deal_types):
            if i + 1 >= len(blocks):
                break
            product_block = blocks[i + 1]
            lines = [line.strip() for line in product_block.split('\n')]
            for line in lines:
                if not _is_valid_product_line(line):
                    continue
                name = line.strip(' ·、，,.')
                if len(name) < 2 or len(name) > 50:
                    continue
                products.append({
                    'title': f'{name} — {deal_type}',
                    'image': image,
                    'start_date': start_date,
                    'end_date': end_date,
                    'link': link or BASE,
                    'description': f'7-ELEVEN · {deal_type}',
                    'type': 'product',
                    'deal': deal_type,
                })

    return products


def _parse_combo_meals(text, link, image, start_date, end_date):
    """解析超值組合：【45元餐食品項】→ 商品列表"""
    products = []
    combo_pattern = re.compile(r'【(\d+)元餐[^】]*】')

    parts = combo_pattern.split(text)
    prices = combo_pattern.findall(text)

    for i, price in enumerate(prices):
        if i + 1 >= len(parts):
            break
        block = parts[i + 1]
        lines = [line.strip() for line in block.split('\n')]

        for line in lines:
            # 跳過子分類標題 【麵包】【三明治】等
            if re.match(r'^【[^】]+】$', line):
                continue
            if not _is_valid_product_line(line):
                continue
            name = line.strip(' ·、，,.')
            if len(name) < 2 or len(name) > 50:
                continue

            deal = f'超值組合{price}元'
            products.append({
                'title': name,
                'image': image,
                'start_date': start_date,
                'end_date': end_date,
                'link': link or BASE,
                'description': f'7-ELEVEN · {deal}',
                'type': 'product',
                'deal': deal,
                'price': int(price),
            })

    return products


def _parse_numbered_deals(text, pattern, link, image, start_date, end_date):
    """解析編號優惠列表：1.買2送2:商品A、商品B"""
    products = []

    for m in pattern.finditer(text):
        deal_type = m.group(1).strip()
        product_text = m.group(2).strip()

        if deal_type == '其他':
            # "其他" 區塊裡每個商品自帶優惠類型，用頓號分隔
            items = re.split(r'[、，]', product_text)
            for item in items:
                item = item.strip()
                if not item or len(item) < 3:
                    continue
                if any(skip in item for skip in ['※', '注意', '以上', '詳見', '禁止']):
                    continue
                # 嘗試提取 deal
                deal_m = re.search(
                    r'(買\d+送\d+|第\d+件\d+[折元]|加\d+元多\d+件|\d+件\d+元|特價\d+元|\d+折)',
                    item
                )
                deal = deal_m.group() if deal_m else deal_type
                products.append({
                    'title': item,
                    'image': image,
                    'start_date': start_date,
                    'end_date': end_date,
                    'link': link or BASE,
                    'description': f'7-ELEVEN · {deal}',
                    'type': 'product',
                    'deal': deal,
                })
        else:
            # 正常的 "買1送1:商品A、商品B" 格式
            items = re.split(r'[、，]', product_text)
            for item in items:
                item = item.strip()
                if not item or len(item) < 2:
                    continue
                if any(skip in item for skip in ['※', '注意', '以上', '詳見', '禁止']):
                    continue
                # 清理尾部的括號備註
                name = re.sub(r'\([^)]*不含[^)]*\)', '', item).strip()
                if len(name) < 2 or len(name) > 60:
                    continue
                products.append({
                    'title': name,
                    'image': image,
                    'start_date': start_date,
                    'end_date': end_date,
                    'link': link or BASE,
                    'description': f'7-ELEVEN · {deal_type}',
                    'type': 'product',
                    'deal': deal_type,
                })

    return products


def _is_valid_product_line(line):
    """檢查是否為有效的商品名行"""
    if not line or len(line) < 3:
        return False
    # 跳過純數字行（combo price 殘留）
    if line.strip().isdigit():
        return False
    if any(skip in line for skip in [
        '※', '注意', '不適用', '除外', '排除', '門市',
        '限量', '售完', '以上', '以下', '詳見', '洽詢',
        '活動期間', '禁止', '未滿', '請勿', '參與品類',
        '不包含', '不得', '區域限定', '區域販售', '限聖娜',
    ]):
        return False
    if line.startswith(('(', '■', '①', '②', '③', '④', '·', '※')):
        return False
    return True


def format_date(date_str):
    """YYYYMMDD -> YYYY-MM-DD"""
    if not date_str or date_str == '99999999':
        return ''
    if len(date_str) == 8 and date_str.isdigit():
        return f'{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}'
    return date_str


def scrape_html_fallback():
    """從首頁 HTML 抓取"""
    resp = requests.get(BASE, headers=HEADERS, timeout=30)
    resp.encoding = 'utf-8'
    soup = BeautifulSoup(resp.text, 'lxml')

    promotions = []
    for a_tag in soup.select('a.m-article, .swiper-slide a'):
        img = a_tag.select_one('img')
        title_el = a_tag.select_one('.headline, p.headline, h5')
        time_el = a_tag.select_one('.time, p.time')

        title = title_el.get_text(strip=True) if title_el else ''
        if not title:
            continue

        image = img.get('src', '') if img else ''
        if image and not image.startswith('http'):
            image = f'{BASE}/{image.lstrip("/")}'

        promotions.append({
            'title': title,
            'image': image,
            'start_date': '',
            'end_date': '',
            'link': BASE,
            'description': time_el.get_text(strip=True) if time_el else '',
            'type': 'campaign',
        })

    return promotions


def save(promotions):
    os.makedirs(DATA_DIR, exist_ok=True)
    result = {
        'store': '7-ELEVEN',
        'store_id': 'seven',
        'logo': f'{BASE}/favicon.ico',
        'website': BASE,
        'scraped_at': datetime.now().isoformat(),
        'promotions': promotions,
    }
    path = os.path.join(DATA_DIR, 'seven.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'[7-ELEVEN] 抓到 {len(promotions)} 筆優惠，已儲存到 {path}')
    return result


if __name__ == '__main__':
    scrape()
