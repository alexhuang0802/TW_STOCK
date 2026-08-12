"""
台股篩選程式 — Yahoo Finance 版
=================================
主篩選（必要條件）
  收盤 > MA5/10/20/60/120/240 + 月線扣低/即將扣低 + 距前高 ≤20% + 非創新高
附加標記（不影響入選，只加註）
  嚴格多頭排列 (price>MA5>…>MA240) + 股價貼近季線 ≤5%
共同條件
  電子股 + 成交金額 > 5000萬

資料來源: Yahoo Finance (yfinance)
輸出: frontend/public/scan-results.json（給網站顯示用）
"""

import sys, time, json, warnings
import pandas as pd
import yfinance as yf
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")

warnings.filterwarnings("ignore")

BASE_DIR    = Path(__file__).parent
RESULT_PATH = BASE_DIR / "frontend" / "public" / "scan-results.json"

# ── 可調整參數 ─────────────────────────────────
MIN_TRADE_VALUE  = 50_000_000   # 成交金額下限 (元)
HISTORY_DAYS     = 520          # 下載幾天歷史 (520天≈370交易日，足夠算 MA240)
KOU_DI_DAYS      = 5            # 即將扣低：往後看幾個交易日
MA_PERIODS       = [5, 10, 20, 60, 120, 240]
NEAR_MA60_PCT    = 5.0          # 貼季線：距 MA60 上方幅度上限 (%)
MAX_WORKERS      = 10           # 平行下載執行緒數

ENABLE_GROUP_B   = True         # 是否額外標記 Group B（嚴格多頭排列＋貼近季線），僅加註不影響入選

ELECTRONIC_INDUSTRIES = {
    "半導體業", "電腦及週邊設備業", "光電業", "通信網路業",
    "電子零組件業", "電子通路業", "資訊服務業", "其他電子業",
    "電子工業", "軟體業",
}


# ═══════════════════════════════════════════════
#  1. 股票清單
# ═══════════════════════════════════════════════

def get_stock_list() -> list[dict]:
    stocks = []
    headers = {"User-Agent": "Mozilla/5.0"}
    STOCK_SECTIONS = {"股票", "上櫃股票"}
    EXIT_SECTIONS  = {
        "ETF", "上櫃ETF", "臺灣存託憑證(TDR)", "受益憑證", "上櫃受益憑證",
        "不動產投資信託受益憑證", "資產基礎證券", "上市認購(售)權證",
        "上櫃認購(售)權證", "牛熊證", "可交換公司債", "附認股權公司債",
        "認購權證", "認售權證", "上櫃牛熊證", "交換公司債",
    }

    for mode, market in [("2", "TWSE"), ("4", "TPEX")]:
        url = f"https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}"
        try:
            import io
            resp = requests.get(url, headers=headers, timeout=20)
            resp.encoding = "big5"
            df = pd.read_html(io.StringIO(resp.text))[0]
            in_section = False
            for _, row in df.iterrows():
                cell = str(row.iloc[0]).strip()
                if cell in STOCK_SECTIONS:
                    in_section = True;  continue
                if cell in EXIT_SECTIONS:
                    in_section = False; continue
                if not in_section:
                    continue
                if "　" in cell:
                    parts = cell.split("　")
                    code  = parts[0].strip()
                    name  = parts[1].strip() if len(parts) > 1 else ""
                    ind   = str(row.iloc[4]).strip() if len(row) > 4 else ""
                    if ind in ("nan", "None", "－"):
                        ind = ""
                    if code.isdigit() and len(code) == 4:
                        stocks.append({"code": code, "market": market,
                                       "name": name, "industry": ind})
            print(f"  {market}: {sum(1 for s in stocks if s['market']==market)} 支")
        except Exception as e:
            print(f"  [警告] {market} 清單失敗: {e}")

    return stocks


# ═══════════════════════════════════════════════
#  2. Yahoo Finance 下載（含快取）
# ═══════════════════════════════════════════════

def _flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    if not isinstance(df.columns, pd.MultiIndex):
        return df
    for level in range(df.columns.nlevels):
        vals = df.columns.get_level_values(level)
        if "Close" in vals:
            df.columns = vals
            return df
    df.columns = df.columns.get_level_values(0)
    return df


def _download_one(ticker: str, start: str, end: str):
    try:
        t  = yf.Ticker(ticker)
        df = t.history(start=start, end=end, auto_adjust=True)
        df = _flatten_columns(df)
        if df.empty or len(df) < max(MA_PERIODS):
            return ticker, None
        close = df["Close"].squeeze()
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]
        if close.std() < 0.001:
            return ticker, None
        return ticker, df
    except Exception:
        return ticker, None


def download_all(stock_list: list[dict]) -> tuple[dict, dict]:
    end   = (datetime.now(TW_TZ) + timedelta(days=2)).strftime("%Y-%m-%d")
    start = (datetime.now(TW_TZ) - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")

    suffix_map = {"TWSE": ".TW", "TPEX": ".TWO"}
    ticker_map = {
        f"{s['code']}{suffix_map[s['market']]}": s for s in stock_list
    }

    print(f"  下載 {len(ticker_map)} 支（平行 {MAX_WORKERS} 執行緒）...")
    cache: dict[str, pd.DataFrame] = {}
    done = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {
            pool.submit(_download_one, t, start, end): t
            for t in ticker_map
        }
        for f in as_completed(futures):
            ticker, df = f.result()
            done += 1
            if done % 100 == 0 or done == len(ticker_map):
                print(f"    {done}/{len(ticker_map)}", end="\r", flush=True)
            if df is not None:
                cache[ticker] = df
    print(f"    {len(ticker_map)}/{len(ticker_map)} 完成！")

    return cache, ticker_map


# ═══════════════════════════════════════════════
#  3. 篩選
# ═══════════════════════════════════════════════

def _check_group_a(close: pd.Series, mas: dict, latest_close: float):
    """主篩選：收盤 > 所有均線 + 月線扣低/即將扣低 + 距前高 ≤20% + 非創新高"""
    if not all(latest_close > mas[p] for p in MA_PERIODS):
        return None

    # 近 60 日高點
    close_60     = close.iloc[-60:]
    high_60      = float(close_60.max())
    high_60_idx  = close_60.idxmax()
    latest_idx   = close_60.index[-1]

    if high_60_idx == latest_idx:   # 創新高，跳過
        return None

    dist_pct = (high_60 - latest_close) / high_60 * 100
    if dist_pct > 20:
        return None

    # close[-20] = 明天的扣抵點
    # 若 close[-20] <= 今日收盤 → 明天就扣低了 = 已在扣 → 不要
    # 若 close[-20] > 今日收盤 → 明天是扣高，再往後才是扣低 = 準備扣下去 → 要
    if close.iloc[-20] <= latest_close:
        return None

    # 從後天起找扣低點：close[-19]=2日後, close[-18]=3日後...
    for i in range(1, KOU_DI_DAYS + 1):
        idx = -20 + i   # i=1→-19(2日後), i=2→-18(3日後)...
        if close.iloc[idx] < latest_close:
            return f"即將扣低({i + 1}日後)"

    return None


def _check_group_b(mas: dict, latest_close: float):
    """附加標記：嚴格多頭排列 (price>MA5>MA10>...>MA240) + 股價貼近季線 ≤NEAR_MA60_PCT%"""
    chain = [latest_close] + [mas[p] for p in MA_PERIODS]
    if not all(chain[i] > chain[i + 1] for i in range(len(chain) - 1)):
        return None

    near_pct = (latest_close - mas[60]) / mas[60] * 100
    if near_pct > NEAR_MA60_PCT:
        return None

    return f"貼季線({near_pct:.1f}%)"


def scan(cache: dict, ticker_map: dict) -> list[dict]:
    results = []

    for ticker, info in ticker_map.items():
        df = cache.get(ticker)
        if df is None or df.empty:
            continue

        # 產業過濾
        industry = info.get("industry", "")
        if industry not in ELECTRONIC_INDUSTRIES:
            continue

        # 取出收盤價與成交量
        close  = df["Close"].squeeze()
        volume = df["Volume"].squeeze()
        if isinstance(close,  pd.DataFrame): close  = close.iloc[:, 0]
        if isinstance(volume, pd.DataFrame): volume = volume.iloc[:, 0]
        close  = close.dropna()
        volume = volume.dropna()

        if len(close) < max(MA_PERIODS):
            continue

        # 計算均線
        mas = {p: float(close.rolling(p).mean().iloc[-1]) for p in MA_PERIODS}
        if any(pd.isna(v) for v in mas.values()):
            continue

        latest_close = float(close.iloc[-1])
        prev_close   = float(close.iloc[-2]) if len(close) >= 2 else latest_close

        # 成交量 / 成交金額
        latest_vol_zhang = int(float(volume.iloc[-1]) / 1000)
        trade_value = latest_vol_zhang * 1000 * latest_close
        if trade_value < MIN_TRADE_VALUE:
            continue

        # 主篩選：必須符合才會入選
        kou_di_label = _check_group_a(close, mas, latest_close)
        if not kou_di_label:
            continue

        # 附加標記：在同一份資料上加註，不影響是否入選
        b_label = _check_group_b(mas, latest_close) if ENABLE_GROUP_B else None

        # 量縮：今日成交量 / 昨日成交量，僅加註不影響入選
        prev_volume   = float(volume.iloc[-2]) if len(volume) >= 2 else float(volume.iloc[-1])
        vol_ratio_pct = round(float(volume.iloc[-1]) / prev_volume * 100, 1) if prev_volume > 0 else None

        code       = info.get("code", ticker.replace(".TWO", "").replace(".TW", ""))
        market     = "上市" if info.get("market") == "TWSE" else "上櫃"
        change_pct = (latest_close - prev_close) / prev_close * 100

        results.append({
            "股票代號"     : code,
            "名稱"         : info.get("name", ""),
            "市場"         : market,
            "族群"         : industry,
            "價格"         : round(latest_close, 2),
            "扣低狀態"     : kou_di_label,
            "嚴選多頭(B)"  : b_label or "",
            "漲幅(%)"      : round(change_pct, 2),
            "量縮(%)"      : vol_ratio_pct,
            "成交量(張)"   : latest_vol_zhang,
        })

    return results


# ═══════════════════════════════════════════════
#  4. 主程式
# ═══════════════════════════════════════════════

def main():
    t0 = time.time()
    print("=" * 55)
    print("  台股篩選 — Yahoo Finance + 均線多頭 + 月線扣低")
    print("=" * 55)

    print("\n[1] 取得股票清單...")
    stocks = get_stock_list()
    print(f"    合計 {len(stocks)} 支")
    if not stocks:
        print("無法取得股票清單，程式結束。"); sys.exit(1)

    print("\n[2] 下載/更新歷史行情（Yahoo Finance）...")
    cache, ticker_map = download_all(stocks)

    print(f"\n[3] 篩選（{len(ticker_map)} 支）...")
    results = scan(cache, ticker_map)

    print("\n" + "=" * 55)

    now_str = datetime.now(TW_TZ).strftime("%Y-%m-%d %H:%M")
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)

    if not results:
        print("  沒有找到符合條件的股票。")
        RESULT_PATH.write_text(
            json.dumps({"updated_at": now_str, "results": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return

    df_out = (
        pd.DataFrame(results)
        .sort_values("扣低狀態", ascending=True)
        .reset_index(drop=True)
    )

    b_count = int((df_out["嚴選多頭(B)"] != "").sum())
    print(f"  共 {len(results)} 支（即將扣低），其中 {b_count} 支另符合嚴格多頭排列＋貼季線\n")
    print(df_out.to_string())

    RESULT_PATH.write_text(
        json.dumps(
            {"updated_at": now_str, "results": df_out.to_dict(orient="records")},
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n  已寫入 {RESULT_PATH}")
    print(f"\n  總耗時：{time.time()-t0:.1f} 秒")


if __name__ == "__main__":
    main()
