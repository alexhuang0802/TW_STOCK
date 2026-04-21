"""7-ELEVEN combo deal research script - investigate where product data lives."""
import os
import re
import sys
import xml.etree.ElementTree as ET

import requests
from bs4 import BeautifulSoup

BASE = 'https://www.7-11.com.tw'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': 'https://www.7-11.com.tw/',
}
DATA_DIR = os.path.dirname(os.path.abspath(__file__))

out_lines = []

def log(msg=''):
    try:
        print(str(msg).encode('utf-8', errors='replace').decode('utf-8', errors='replace'))
    except Exception:
        pass
    out_lines.append(str(msg))

def save_debug():
    path = os.path.join(DATA_DIR, '_seven_debug2.txt')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out_lines))
    print(f'\n=== Debug output saved to {path} ===')


def main():
    combo_links = []

    for num in [0, 1, 2, 6]:
        log(f'\n{"="*80}')
        log(f'FETCHING num={num}')
        log(f'{"="*80}')

        try:
            resp = requests.post(
                f'{BASE}/readxml.aspx',
                data=f'num={num}',
                headers=HEADERS,
                timeout=30,
            )
            resp.encoding = 'utf-8'
            raw = resp.text
        except Exception as e:
            log(f'  ERROR: {e}')
            continue

        # Save raw response
        raw_path = os.path.join(DATA_DIR, f'_seven_raw_{num}.txt')
        with open(raw_path, 'w', encoding='utf-8') as f:
            f.write(raw)
        log(f'  Saved raw XML to {raw_path} ({len(raw)} chars)')

        # Parse XML
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as e:
            log(f'  XML PARSE ERROR: {e}')
            log(f'  First 500 chars: {raw[:500]}')
            continue

        items = root.findall('Item')
        log(f'  Found {len(items)} items')

        for idx, item_el in enumerate(items):
            fields = {}
            for child in item_el:
                fields[child.tag] = (child.text or '').strip()

            title = fields.get('APP_BannerTitle', '') or fields.get('Title', '')
            remark = fields.get('Remark', '')
            link = fields.get('Link', '')
            itype = fields.get('IType', '')
            sdate = fields.get('SDate', '')
            edate = fields.get('EDate', '')
            content = fields.get('Content', '')

            # Fix URL
            full_link = link
            if link and not link.startswith('http'):
                full_link = f'{BASE}/{link.lstrip("/")}'

            log(f'\n  --- Item {idx} ---')
            log(f'  Title: {title}')
            log(f'  IType: {itype}')
            log(f'  SDate: {sdate}  EDate: {edate}')
            log(f'  Link: {full_link}')
            log(f'  Content: {content[:200]}')
            log(f'  All fields: {list(fields.keys())}')

            # Show Remark (first 500 chars)
            if remark:
                log(f'  Remark (first 500): {remark[:500]}')
            else:
                log(f'  Remark: (empty)')

            # Check if this looks like a combo deal
            is_combo = False
            combo_keywords = ['組合', '任選', '配對', '搭配', '元', '折', '買一送一',
                              '第二件', '加購', 'COMBO', 'combo', '件']
            for kw in combo_keywords:
                if kw in title or kw in remark:
                    is_combo = True
                    break

            if is_combo:
                log(f'  >>> LOOKS LIKE COMBO DEAL <<<')
                # Show more of the Remark
                if len(remark) > 500:
                    log(f'  Remark FULL ({len(remark)} chars):')
                    log(remark[:2000])

                # Check for product grid patterns in Remark
                if remark:
                    # Look for price patterns
                    prices = re.findall(r'(\d+)\s*元', remark)
                    if prices:
                        log(f'  Prices found in Remark: {prices[:20]}')

                    # Look for img tags (product images)
                    imgs = re.findall(r'<img[^>]*src=["\']([^"\']+)["\']', remark, re.I)
                    if imgs:
                        log(f'  Images in Remark ({len(imgs)}): {imgs[:5]}')

                    # Look for product name patterns
                    soup = BeautifulSoup(remark, 'html.parser')
                    # Check for table/grid structures
                    tables = soup.find_all('table')
                    divs_with_class = soup.find_all('div', class_=True)
                    log(f'  HTML structure: {len(tables)} tables, {len(divs_with_class)} divs with class')

                    # Extract text blocks that might be product names
                    text = soup.get_text('\n', strip=True)
                    text_lines = [l.strip() for l in text.split('\n') if l.strip()]
                    log(f'  Text lines in Remark ({len(text_lines)}):')
                    for tl in text_lines[:30]:
                        log(f'    | {tl}')

                if full_link and full_link != BASE:
                    combo_links.append((title, full_link))

    # Now try to fetch some detail pages
    log(f'\n\n{"="*80}')
    log(f'FETCHING DETAIL PAGES')
    log(f'{"="*80}')

    # Also try common event URLs
    extra_links = [
        ('events page', f'{BASE}/events/'),
    ]

    all_links = combo_links[:5] + extra_links
    log(f'Will try {len(all_links)} links')

    for title, url in all_links:
        log(f'\n  --- Fetching: {title} ---')
        log(f'  URL: {url}')
        try:
            get_headers = {k: v for k, v in HEADERS.items() if k != 'Content-Type'}
            resp = requests.get(url, headers=get_headers, timeout=30, allow_redirects=True)
            resp.encoding = 'utf-8'
            html = resp.text
            log(f'  Status: {resp.status_code}, Length: {len(html)}')
            log(f'  Final URL: {resp.url}')

            soup = BeautifulSoup(html, 'html.parser')

            # Look for product grids / combo deal structures
            # Common patterns: divs with product names + prices
            price_elements = soup.find_all(string=re.compile(r'\d+\s*元'))
            log(f'  Elements with prices: {len(price_elements)}')
            for pe in price_elements[:10]:
                parent = pe.parent
                log(f'    Price: {pe.strip()[:80]}  Parent tag: {parent.name if parent else "?"} class={parent.get("class") if parent else "?"}')

            # Look for product listing structures
            for selector in ['.prd', '.product', '.item', '.card', '.grid-item',
                             '[class*="product"]', '[class*="item"]', '[class*="prd"]']:
                found = soup.select(selector)
                if found:
                    log(f'  Selector "{selector}": {len(found)} matches')
                    for f in found[:3]:
                        log(f'    Text: {f.get_text(" ", strip=True)[:120]}')

            # Show page title and key structure
            page_title = soup.title.get_text(strip=True) if soup.title else '(no title)'
            log(f'  Page title: {page_title}')

            # Check for JavaScript data (sometimes data is in JS)
            scripts = soup.find_all('script')
            for s in scripts:
                if s.string and ('product' in s.string.lower() or 'item' in s.string.lower()
                                 or '元' in s.string):
                    log(f'  Script with product/item data ({len(s.string)} chars):')
                    log(f'    {s.string[:500]}')

            # Save first detail page fully for inspection
            if all_links.index((title, url)) == 0:
                detail_path = os.path.join(DATA_DIR, '_seven_detail_page.html')
                with open(detail_path, 'w', encoding='utf-8') as f:
                    f.write(html)
                log(f'  Saved full HTML to {detail_path}')

        except Exception as e:
            log(f'  ERROR: {e}')

    save_debug()


if __name__ == '__main__':
    main()
