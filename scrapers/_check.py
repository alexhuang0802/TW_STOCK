import json

with open('data/_check.txt', 'w', encoding='utf-8') as f:
    with open('data/hilife.json', encoding='utf-8') as jf:
        data = json.load(jf)

    f.write(f'=== 萊爾富 ({len(data["promotions"])} 筆) ===\n')
    has_date = [p for p in data['promotions'] if p.get('start_date')]
    no_date = [p for p in data['promotions'] if not p.get('start_date')]
    products = [p for p in data['promotions'] if p.get('type') == 'product']
    f.write(f'有日期: {len(has_date)} 筆, 無日期: {len(no_date)} 筆, 商品: {len(products)} 筆\n\n')

    f.write('有日期的:\n')
    for p in has_date:
        t = p.get('title', '')[:40]
        f.write(f'  {t} | {p["start_date"]}~{p["end_date"]} | {p.get("type")} | {p.get("category","")}\n')

    f.write('\n商品優惠:\n')
    for p in products:
        t = p.get('title', '')[:40]
        f.write(f'  {t} | deal={p.get("deal")} | cat={p.get("category","")}\n')

    f.write('\n無日期的:\n')
    for p in no_date[:10]:
        t = p.get('title', '')[:40]
        f.write(f'  {t} | {p.get("type")}\n')

print('done')
