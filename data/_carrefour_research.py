"""Carrefour Taiwan research script - investigate API endpoints for product-level deals."""
import os
import re
import json
import sys

import requests
from bs4 import BeautifulSoup

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
}

API_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
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
    path = os.path.join(DATA_DIR, '_carrefour_debug.txt')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out_lines))
    log(f'Debug saved to {path}')


def probe_url(url, headers=None, label=None):
    """Fetch a URL and return (response, status_info)"""
    h = headers or HEADERS
    label = label or url
    try:
        r = requests.get(url, headers=h, timeout=15, allow_redirects=True)
        log(f'  [{r.status_code}] {label} -> {r.url} ({len(r.text)} bytes)')
        return r
    except Exception as e:
        log(f'  [ERR] {label}: {e}')
        return None


def extract_next_data(html):
    """Extract __NEXT_DATA__ from HTML"""
    if '__NEXT_DATA__' not in html:
        return None
    try:
        idx = html.find('__NEXT_DATA__')
        s = html.find('>', idx) + 1
        e = html.find('</script>', s)
        return json.loads(html[s:e])
    except Exception:
        return None


def main():
    log('=' * 70)
    log('CARREFOUR TAIWAN - API ENDPOINT RESEARCH')
    log('=' * 70)

    # ============================================================
    # PART 1: Probe online.carrefour.com.tw (e-commerce site)
    # ============================================================
    log('\n## PART 1: online.carrefour.com.tw (e-commerce)')
    log('-' * 50)

    online_urls = [
        'https://online.carrefour.com.tw/',
        'https://online.carrefour.com.tw/zh/',
        'https://online.carrefour.com.tw/zh/promotions',
        'https://online.carrefour.com.tw/zh/hot-deals',
        'https://online.carrefour.com.tw/zh/category/promotions',
    ]

    build_id = None
    for url in online_urls:
        r = probe_url(url)
        if r and r.status_code == 200:
            nd = extract_next_data(r.text)
            if nd:
                build_id = nd.get('buildId')
                log(f'  __NEXT_DATA__ found! buildId={build_id}')
                log(f'  Keys: {list(nd.keys())}')
                if 'props' in nd:
                    log(f'  props keys: {list(nd["props"].keys())}')
                    pp = nd.get('props', {}).get('pageProps', {})
                    if pp:
                        log(f'  pageProps keys: {list(pp.keys())}')
                        log(f'  pageProps (first 3000): {json.dumps(pp, ensure_ascii=False)[:3000]}')
                # Check runtimeConfig
                rc = nd.get('runtimeConfig') or nd.get('publicRuntimeConfig')
                if rc:
                    log(f'  runtimeConfig: {json.dumps(rc, ensure_ascii=False)[:2000]}')
            else:
                # Check for other SPA markers
                for marker in ['__NUXT__', '__INITIAL_STATE__', 'id="__next"', 'id="app"',
                               'window.__DATA__', 'window.__APOLLO_STATE__']:
                    if marker in r.text:
                        log(f'  Found marker: {marker}')
                # Show first 3000 chars
                log(f'  HTML (first 3000): {r.text[:3000]}')

    # ============================================================
    # PART 2: Try common API patterns on online store
    # ============================================================
    log('\n## PART 2: API endpoint probing (online store)')
    log('-' * 50)

    api_urls = [
        'https://online.carrefour.com.tw/api/promotions',
        'https://online.carrefour.com.tw/api/v1/promotions',
        'https://online.carrefour.com.tw/api/v1/products?promotion=true',
        'https://online.carrefour.com.tw/api/v1/deals',
        'https://online.carrefour.com.tw/graphql',
        'https://online.carrefour.com.tw/api/v1/categories',
        'https://online.carrefour.com.tw/api/products?filter=promotion',
        'https://online.carrefour.com.tw/content/v1/promotions',
        # Hybris-style (SAP Commerce Cloud used by many Carrefour sites)
        'https://online.carrefour.com.tw/occ/v2/carrefour/promotions',
        'https://online.carrefour.com.tw/occ/v2/carrefourtw/promotions',
        'https://online.carrefour.com.tw/api/v2/promotions',
        # Vtex-style
        'https://online.carrefour.com.tw/api/catalog_system/pub/products/search?fq=productClusterIds:137',
    ]

    for url in api_urls:
        r = probe_url(url, headers=API_HEADERS)
        if r and r.status_code == 200:
            ct = r.headers.get('content-type', '')
            if 'json' in ct:
                try:
                    data = r.json()
                    log(f'  JSON response! Type={type(data).__name__}')
                    if isinstance(data, list):
                        log(f'  Array length: {len(data)}')
                        if data:
                            log(f'  First item keys: {list(data[0].keys()) if isinstance(data[0], dict) else data[0]}')
                            log(f'  First item: {json.dumps(data[0], ensure_ascii=False)[:1000]}')
                    elif isinstance(data, dict):
                        log(f'  Keys: {list(data.keys())}')
                        log(f'  Content (3000): {json.dumps(data, ensure_ascii=False)[:3000]}')
                except Exception:
                    log(f'  Response (1000): {r.text[:1000]}')
            else:
                log(f'  Content-Type: {ct}')

    # ============================================================
    # PART 3: Use __NEXT_DATA__ buildId for data routes
    # ============================================================
    if build_id:
        log(f'\n## PART 3: Next.js data routes (buildId={build_id})')
        log('-' * 50)
        next_routes = [
            f'https://online.carrefour.com.tw/_next/data/{build_id}/zh.json',
            f'https://online.carrefour.com.tw/_next/data/{build_id}/zh/promotions.json',
            f'https://online.carrefour.com.tw/_next/data/{build_id}/zh/hot-deals.json',
            f'https://online.carrefour.com.tw/_next/data/{build_id}/zh/category/promotions.json',
        ]
        for url in next_routes:
            r = probe_url(url, headers=API_HEADERS)
            if r and r.status_code == 200:
                try:
                    data = r.json()
                    pp = data.get('pageProps', {})
                    log(f'  pageProps keys: {list(pp.keys())}')
                    log(f'  Content (3000): {json.dumps(pp, ensure_ascii=False)[:3000]}')
                except Exception:
                    log(f'  Response (1000): {r.text[:1000]}')

    # ============================================================
    # PART 4: www.carrefour.com.tw WP posts with deals
    # ============================================================
    log('\n## PART 4: WordPress posts with product deals')
    log('-' * 50)

    wp_urls = [
        'https://www.carrefour.com.tw/wp-json/wp/v2/posts?per_page=50&search=%E7%89%B9%E5%83%B9',  # 特價
        'https://www.carrefour.com.tw/wp-json/wp/v2/posts?per_page=50&search=%E5%84%AA%E6%83%A0',  # 優惠
        'https://www.carrefour.com.tw/wp-json/wp/v2/posts?per_page=50&search=%E6%8A%98',  # 折
        'https://www.carrefour.com.tw/wp-json/wp/v2/posts?per_page=100',
    ]

    all_posts = {}
    for url in wp_urls:
        r = probe_url(url, headers=API_HEADERS, label=url.split('?')[1] if '?' in url else url)
        if r and r.status_code == 200:
            try:
                posts = r.json()
                log(f'  Got {len(posts)} posts')
                for p in posts:
                    pid = p['id']
                    if pid not in all_posts:
                        all_posts[pid] = p
                        title = p.get('title', {}).get('rendered', '')
                        link = p.get('link', '')
                        date = p.get('date', '')
                        # Extract price mentions from content
                        content = p.get('content', {}).get('rendered', '')
                        prices = re.findall(r'[\$＄]?\d{2,5}[元]?', content)
                        excerpt = p.get('excerpt', {}).get('rendered', '')
                        log(f'    [{pid}] {date[:10]} {title}')
                        log(f'      Link: {link}')
                        if prices:
                            log(f'      Prices found: {prices[:10]}')
            except Exception as e:
                log(f'  Parse error: {e}')

    log(f'\n  Total unique posts: {len(all_posts)}')

    # ============================================================
    # PART 5: Catalogues page Vue plugin investigation
    # ============================================================
    log('\n## PART 5: Catalogues page Vue plugin')
    log('-' * 50)

    r = probe_url('https://www.carrefour.com.tw/catalogues/')
    if r and r.status_code == 200:
        soup = BeautifulSoup(r.text, 'html.parser')
        # Find all script tags
        scripts = soup.find_all('script')
        log(f'  Found {len(scripts)} script tags')
        for i, s in enumerate(scripts):
            src = s.get('src', '')
            if src:
                log(f'  Script [{i}]: {src}')
            elif s.string:
                text = s.string.strip()
                if any(kw in text.lower() for kw in ['vulcan', 'catalogue', 'api', 'fetch', 'axios', 'ajax']):
                    log(f'  Inline script [{i}] (relevant): {text[:500]}')

        # Find Vue mount points
        vulcan = soup.find(id='carrefour-tw-vulcan-block-catalogue-list')
        if vulcan:
            log(f'  Vue component found: {vulcan.attrs}')

        # Look for JS bundles with 'vulcan' in path
        for s in scripts:
            src = s.get('src', '')
            if 'vulcan' in src.lower() or 'catalogue' in src.lower():
                log(f'  Relevant JS bundle: {src}')
                r2 = probe_url(src if src.startswith('http') else f'https://www.carrefour.com.tw{src}')
                if r2:
                    # Look for API endpoints in the JS
                    api_matches = re.findall(r'["\']([^"\']*(?:api|endpoint|catalogue|promotion)[^"\']*)["\']', r2.text, re.I)
                    if api_matches:
                        log(f'    API refs in JS: {api_matches[:20]}')

    # ============================================================
    # PART 6: Try admin-ajax.php for catalogue data
    # ============================================================
    log('\n## PART 6: admin-ajax.php catalogue queries')
    log('-' * 50)

    ajax_actions = [
        'get_catalogues',
        'carrefour_get_catalogues',
        'vulcan_get_catalogues',
        'load_catalogues',
        'get_promotions',
    ]

    for action in ajax_actions:
        try:
            r = requests.post(
                'https://www.carrefour.com.tw/wp-admin/admin-ajax.php',
                headers={**HEADERS, 'X-Requested-With': 'XMLHttpRequest'},
                data={'action': action, 'category_ids': '34,35,37,38,39,137'},
                timeout=10
            )
            log(f'  action={action}: [{r.status_code}] {r.text[:300]}')
        except Exception as e:
            log(f'  action={action}: ERR {e}')

    # ============================================================
    # PART 7: c4fast.carrefour.com.tw (fast delivery)
    # ============================================================
    log('\n## PART 7: c4fast.carrefour.com.tw')
    log('-' * 50)

    r = probe_url('https://c4fast.carrefour.com.tw/')
    if r and r.status_code == 200:
        nd = extract_next_data(r.text)
        if nd:
            log(f'  __NEXT_DATA__ buildId={nd.get("buildId")}')
            pp = nd.get('props', {}).get('pageProps', {})
            log(f'  pageProps keys: {list(pp.keys())}')
            log(f'  pageProps (2000): {json.dumps(pp, ensure_ascii=False)[:2000]}')
        else:
            for marker in ['__NUXT__', 'id="__next"', 'id="app"']:
                if marker in r.text:
                    log(f'  Found marker: {marker}')
            log(f'  HTML (2000): {r.text[:2000]}')

    # ============================================================
    # PART 8: Check for Carrefour Taiwan mobile app API
    # ============================================================
    log('\n## PART 8: Mobile app API patterns')
    log('-' * 50)

    mobile_urls = [
        'https://api.carrefour.com.tw/promotions',
        'https://api.carrefour.com.tw/v1/promotions',
        'https://m.carrefour.com.tw/',
        'https://ecapi.carrefour.com.tw/',
        'https://ecapi.carrefour.com.tw/api/v1/promotions',
    ]

    for url in mobile_urls:
        probe_url(url, headers=API_HEADERS)

    # Save
    save_debug()
    log('\nDone!')


if __name__ == '__main__':
    main()
