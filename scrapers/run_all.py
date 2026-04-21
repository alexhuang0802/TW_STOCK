"""一鍵執行所有爬蟲"""
import importlib
import time
import sys
import os

# 確保 scrapers 目錄在路徑中
sys.path.insert(0, os.path.dirname(__file__))

SCRAPERS = [
    ('pxmart', '全聯'),
    ('simplemart', '美廉社'),
    ('hilife', '萊爾富'),
    ('okmart', 'OK超商'),
    ('seven', '7-ELEVEN'),
    ('familymart', '全家'),
    ('carrefour', '家樂福'),
    ('news', '優惠新聞'),
]


def main():
    print('=' * 50)
    print('  省錢小工具 - 優惠爬蟲')
    print('=' * 50)

    results = []
    start = time.time()

    for module_name, store_name in SCRAPERS:
        print(f'\n--- {store_name} ---')
        try:
            mod = importlib.import_module(module_name)
            result = mod.scrape()
            count = len(result.get('promotions', []))
            results.append((store_name, count, None))
        except Exception as e:
            print(f'[{store_name}] 錯誤: {e}')
            results.append((store_name, 0, str(e)))

    elapsed = time.time() - start

    print('\n' + '=' * 50)
    print('  結果摘要')
    print('=' * 50)
    total = 0
    for store_name, count, error in results:
        status = f'{count} 筆' if not error else f'失敗: {error}'
        print(f'  {store_name:8s}: {status}')
        total += count
    print(f'\n  共 {total} 筆優惠，耗時 {elapsed:.1f} 秒')


if __name__ == '__main__':
    main()
