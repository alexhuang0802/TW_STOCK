import requests
import time
from datetime import datetime, timezone

BASE_URL = "https://open-api.bingx.com"

def get_all_contracts():
    """取得所有合約列表"""
    url = f"{BASE_URL}/openApi/swap/v2/quote/contracts"
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"取得合約列表失敗: {data}")
    return [c["symbol"] for c in data["data"]]

def get_premium_index_all():
    """取得所有合約的資金費率（不帶 symbol 參數可一次拿全部）"""
    url = f"{BASE_URL}/openApi/swap/v2/quote/premiumIndex"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"取得資金費率失敗: {data}")
    return data["data"]

def format_next_funding_time(ts_ms):
    """將毫秒時間戳轉為易讀格式"""
    if not ts_ms:
        return "N/A"
    dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
    # 換算為本地時間顯示（UTC+8 台灣）
    from datetime import timedelta
    dt_local = dt + timedelta(hours=8)
    return dt_local.strftime("%m/%d %H:%M (台北)")

def time_until(ts_ms):
    """距離下次收費還有多久"""
    if not ts_ms:
        return ""
    now_ms = time.time() * 1000
    diff_s = (ts_ms - now_ms) / 1000
    if diff_s < 0:
        return "即將結算"
    h = int(diff_s // 3600)
    m = int((diff_s % 3600) // 60)
    return f"{h}h {m:02d}m 後"

def print_ranking(entries, title, top_n=20):
    print(f"\n{'='*65}")
    print(f"  {title}")
    print(f"{'='*65}")
    print(f"{'排名':<4} {'交易對':<18} {'資金費率':>10} {'下次結算':>18} {'距離':>12}")
    print(f"{'-'*65}")
    for i, e in enumerate(entries[:top_n], 1):
        symbol     = e.get("symbol", "")
        rate       = float(e.get("lastFundingRate", 0))
        next_time  = e.get("nextFundingTime", 0)
        rate_pct   = f"{rate * 100:.4f}%"
        next_fmt   = format_next_funding_time(next_time)
        until      = time_until(next_time)
        print(f"{i:<4} {symbol:<18} {rate_pct:>10} {next_fmt:>18} {until:>12}")

def main():
    print("正在從 BingX 抓取資金費率資料...")
    try:
        entries = get_premium_index_all()
    except Exception as e:
        print(f"錯誤: {e}")
        return

    # 過濾掉費率為 0 或缺失的項目，並轉換費率為 float
    valid = []
    for e in entries:
        try:
            rate = float(e.get("lastFundingRate", 0))
            e["_rate"] = rate
            valid.append(e)
        except (ValueError, TypeError):
            continue

    print(f"共取得 {len(valid)} 個合約的資金費率")

    # 排序
    sorted_desc = sorted(valid, key=lambda x: x["_rate"], reverse=True)  # 正費率最高
    sorted_asc  = sorted(valid, key=lambda x: x["_rate"])               # 負費率最低

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n資料更新時間: {now_str}")

    print_ranking(sorted_desc, "資金費率排行榜 TOP 20（正費率最高 → 做空方付錢）")
    print_ranking(sorted_asc,  "資金費率排行榜 TOP 20（負費率最低 → 做多方付錢）")

    print(f"\n{'='*65}")
    print("說明：")
    print("  正費率 (+) → 多方付給空方，合約價格高於現貨")
    print("  負費率 (-) → 空方付給多方，合約價格低於現貨")
    print("  BingX 每 8 小時結算一次（00:00 / 08:00 / 16:00 UTC）")
    print(f"{'='*65}\n")

if __name__ == "__main__":
    main()
