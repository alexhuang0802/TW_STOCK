"""
台股篩選程式
===========
篩選條件:
  1. 收盤價在所有均線之上 (MA5 / MA10 / MA20 / MA60 / MA120 / MA240)
  2. 月線 (MA20) 正在往下扣低，或即將扣低 (未來 N 個交易日內)
  3. 最新一日成交量 >= 1000 張

【什麼是「扣低」?】
  MA20 每天會移除 20 天前的舊價格、加入今天的新價格。
  若被移除的舊價格很低 (扣低)，MA20 就會往上走或減緩下跌。
  用這個邏輯可以提早發現 MA20 即將翻揚的股票。

資料來源: 台灣 ISIN 網站 (股票清單) + yfinance (歷史行情)
需安裝套件: pip install yfinance pandas requests
"""

import os
import requests
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
import warnings
import sys
from pathlib import Path

# 程式所在資料夾 (CSV 會存在這裡)
BASE_DIR = Path(__file__).parent

warnings.filterwarnings("ignore")

# ──────────────────────────────────────────────
#  可調整參數
# ──────────────────────────────────────────────
MIN_VOLUME_ZHANG   = 1000   # 最低成交量 (張)
HISTORY_DAYS       = 520    # 下載幾天歷史資料 (需 > 240 交易日, 約 1.5~2 年)
KOU_DI_FUTURE_DAYS = 5      # 「即將扣低」往後看幾個交易日
MAX_WORKERS        = 20     # 同時下載執行緒數
MA_PERIODS         = [5, 10, 20, 60, 120, 240]
SAVE_CSV           = False  # 關閉 CSV 輸出，改由 Telegram 傳送文字

# Telegram 設定 (從環境變數讀取，GitHub Secrets 設定同名變數即可)
TG_TOKEN   = os.environ.get("TG_BOT_TOKEN", "")   # GitHub Secret: TG_BOT_TOKEN
TG_CHAT_ID = os.environ.get("TG_CHAT_ID",  "")    # GitHub Secret: TG_CHAT_ID

# 只保留電子相關產業 (上市 + 上櫃 的產業別名稱)
ELECTRONIC_INDUSTRIES = {
    "半導體業",
    "電腦及週邊設備業",
    "光電業",
    "通信網路業",
    "電子零組件業",
    "電子通路業",
    "資訊服務業",
    "其他電子業",
    # 上櫃常見名稱
    "電子工業",
    "軟體業",
}


# ──────────────────────────────────────────────
#  1. 取得股票清單
# ──────────────────────────────────────────────
def get_stock_list() -> list[dict]:
    """
    從 ISIN 網站取得上市 (TWSE) 及上櫃 (TPEX) 普通股清單。
    只取「股票」區段，排除 ETF、可轉債、權證、TDR、REITs 等。
    回傳格式: [{'code': '2330', 'market': 'TWSE'}, ...]
    """
    stocks = []
    headers = {"User-Agent": "Mozilla/5.0"}

    # 進入「股票」區段的標題 (TWSE 叫「股票」, TPEX 叫「上櫃股票」)
    STOCK_SECTION_NAMES = {"股票", "上櫃股票"}

    # 遇到以下區段標題就離開股票區段
    NON_STOCK_SECTIONS = {
        "ETF", "上櫃ETF",
        "臺灣存託憑證(TDR)", "受益憑證", "上櫃受益憑證",
        "不動產投資信託受益憑證", "資產基礎證券",
        "上市認購(售)權證", "上櫃認購(售)權證",
        "牛熊證", "可交換公司債", "附認股權公司債",
        "認購權證", "認售權證", "上櫃牛熊證",
        "交換公司債",
    }

    # strMode=2 → 上市;  strMode=4 → 上櫃
    modes = [("2", "TWSE"), ("4", "TPEX")]

    for mode, market in modes:
        url = f"https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}"
        try:
            resp = requests.get(url, headers=headers, timeout=20)
            resp.encoding = "big5"
            tables = pd.read_html(resp.text)
            df = tables[0]

            in_stock_section = False  # 是否在「股票」區段內
            section_names_found = set()  # debug 用: 記錄遇到的區段名稱

            for _, row in df.iterrows():
                cell = str(row.iloc[0]).strip()

                # ── 區段標題判斷 ──────────────────────────────
                if cell in STOCK_SECTION_NAMES:
                    in_stock_section = True
                    section_names_found.add(cell)
                    continue
                if cell in NON_STOCK_SECTIONS:
                    in_stock_section = False
                    section_names_found.add(cell)
                    continue

                if not in_stock_section:
                    continue

                # ── 取代碼、名稱、產業 (格式: "代碼\u3000名稱") ────
                if "\u3000" in cell:
                    parts = cell.split("\u3000")
                    code  = parts[0].strip()
                    name  = parts[1].strip() if len(parts) > 1 else ""
                    # 產業別在第 4 欄 (index=4)
                    industry = str(row.iloc[4]).strip() if len(row) > 4 else ""
                    if industry in ("nan", "None", "－"):
                        industry = ""
                    # 4 位純數字 (上市/上櫃普通股)
                    if code.isdigit() and len(code) == 4:
                        stocks.append({
                            "code"    : code,
                            "market"  : market,
                            "name"    : name,
                            "industry": industry,
                        })

            count = sum(1 for s in stocks if s["market"] == market)
            print(f"  {market}: 取得 {count} 支 (純股票)，偵測到區段: {section_names_found}")
        except Exception as e:
            print(f"  [警告] 取得 {market} 清單失敗: {e}")

    return stocks


# ──────────────────────────────────────────────
#  2. 下載歷史行情 (多執行緒)
# ──────────────────────────────────────────────
def flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    新版 yfinance 回傳的欄位可能是 MultiIndex，結構為 (Price, Ticker) 或 (Ticker, Price)。
    找到包含 'Close' 的那一層，將欄位攤平成單層。
    """
    if not isinstance(df.columns, pd.MultiIndex):
        return df
    for level in range(df.columns.nlevels):
        vals = df.columns.get_level_values(level)
        if "Close" in vals:
            df.columns = vals
            return df
    # 找不到就用第 0 層
    df.columns = df.columns.get_level_values(0)
    return df


def download_one(ticker: str, start: str, end: str):
    """
    下載單支股票歷史資料，失敗或資料無效回傳 None。
    使用 Ticker.history() 比 yf.download() 更能正確處理無效代碼。
    """
    try:
        t  = yf.Ticker(ticker)
        df = t.history(start=start, end=end, auto_adjust=True)
        df = flatten_columns(df)

        if df.empty or len(df) < 250:
            return ticker, None

        close = df["Close"].squeeze()
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]

        # 有效性檢查: 收盤價必須有合理波動 (std > 0)，否則是無效/重複資料
        if close.std() < 0.001:
            return ticker, None

        return ticker, df
    except Exception:
        return ticker, None


def download_all(stock_list: list[dict]) -> dict[str, pd.DataFrame]:
    """
    用多執行緒批次下載所有股票歷史資料。
    回傳 {ticker: DataFrame}
    """
    # end +1 天: yfinance 的 end 是「不含」當天，+1 才能包含今日收盤
    end   = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")

    # 建立 ticker 字串 (上市 .TW, 上櫃 .TWO)
    suffix_map = {"TWSE": ".TW", "TPEX": ".TWO"}
    ticker_map = {
        f"{s['code']}{suffix_map[s['market']]}": s for s in stock_list
    }

    all_data: dict[str, pd.DataFrame] = {}
    done = 0
    total = len(ticker_map)

    print(f"  開始下載 {total} 支股票...")
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {
            pool.submit(download_one, t, start, end): t
            for t in ticker_map
        }
        for future in as_completed(futures):
            ticker, df = future.result()
            done += 1
            if done % 100 == 0:
                print(f"    進度: {done}/{total}")
            if df is not None and len(df) >= 250:
                all_data[ticker] = df

    print(f"  成功取得資料: {len(all_data)} 支")
    return all_data, ticker_map


# ──────────────────────────────────────────────
#  3. 篩選條件
# ──────────────────────────────────────────────
def check_kou_di(close: pd.Series, ma_period: int = 20, future_days: int = KOU_DI_FUTURE_DAYS) -> tuple[bool, str]:
    """
    判斷月線是否「正在扣低」或「即將扣低」。

    邏輯:
      今天 MA20 計算中, 明天會移除 close[-20] 這個舊價格。
      如果 close[-20] < close[-1], 代表移除的是低價 → MA20 即將上揚 (扣低)。

      「即將扣低」: 往後 future_days 個交易日內, 即將被移除的舊價都低於今收盤。

    回傳 (是否符合, 說明字串)
    """
    current_close = close.iloc[-1]

    # --- 目前扣低 ---
    # 明天 MA20 會移除 close.iloc[-ma_period]
    if len(close) > ma_period:
        price_to_remove = close.iloc[-ma_period]
        if price_to_remove < current_close:
            return True, "目前扣低"

    # --- 即將扣低 (未來 N 個交易日) ---
    # 後天移除 close.iloc[-ma_period+1], 大後天移除 close.iloc[-ma_period+2], ...
    for i in range(1, future_days + 1):
        idx = -ma_period + i
        if idx < 0 and abs(idx) <= len(close):
            if close.iloc[idx] < current_close:
                return True, f"即將扣低({i}日後)"

    return False, ""


def analyze(ticker: str, df: pd.DataFrame, market: str) -> dict | None:
    """
    檢查單支股票是否符合所有篩選條件。
    符合則回傳結果 dict, 否則回傳 None。
    """
    # 確保取出的是 1D Series (新版 yfinance 有時回傳 DataFrame)
    close  = df["Close"].squeeze()
    volume = df["Volume"].squeeze()
    if isinstance(close,  pd.DataFrame): close  = close.iloc[:, 0]
    if isinstance(volume, pd.DataFrame): volume = volume.iloc[:, 0]
    close  = close.dropna()
    volume = volume.dropna()

    if len(close) < max(MA_PERIODS):
        return None

    # 計算各均線最新值
    mas = {p: close.rolling(p).mean().iloc[-1] for p in MA_PERIODS}
    if any(pd.isna(v) for v in mas.values()):
        return None

    latest_close = float(close.iloc[-1])

    # ── 條件 1: 收盤價在所有均線之上 ──────────────────────
    if not all(latest_close > float(mas[p]) for p in MA_PERIODS):
        return None

    # ── 條件 2: 只取「即將扣低」，排除「目前扣低」────────────
    kou_di, kou_di_label = check_kou_di(close)
    if not kou_di or not kou_di_label.startswith("即將"):
        return None

    # ── 條件 3: 成交量 >= 1000 張 ─────────────────────────
    latest_vol_zhang = int(volume.iloc[-1] / 1000)
    if latest_vol_zhang < MIN_VOLUME_ZHANG:
        return None

    # ── 條件 3b: 今日漲幅 < 5% ────────────────────────────
    prev_close  = float(close.iloc[-2])  if len(close)  >= 2 else latest_close
    prev_vol    = float(volume.iloc[-2]) if len(volume) >= 2 else float(volume.iloc[-1])
    change_pct  = (latest_close - prev_close) / prev_close * 100
    if change_pct >= 5.0:
        return None

    # ── 條件 4: 近 60 根收盤前高，非最新 K 棒創高，且距前高 20% 以內 ──
    close_60_series = close.iloc[-60:]
    high_60         = float(close_60_series.max())
    high_60_idx     = close_60_series.idxmax()
    latest_idx      = close_60_series.index[-1]

    if high_60_idx == latest_idx:
        return None

    dist_pct = (high_60 - latest_close) / high_60 * 100
    if dist_pct > 20:
        return None

    # ── ! 欄位：今漲配量增 或 今跌配量縮 ──────────────────
    # 漲 + 量比昨天多 → 放量上漲（趨勢強）
    # 跌 + 量比昨天少 → 縮量回調（健康拉回）
    today_vol = float(volume.iloc[-1])
    if (change_pct > 0 and today_vol > prev_vol) or \
       (change_pct < 0 and today_vol < prev_vol):
        signal = "!"
    else:
        signal = ""

    code = ticker.replace(".TWO", "").replace(".TW", "")

    return {
        "代碼"       : code,
        "市場"       : "上市" if market == "TWSE" else "上櫃",
        "收盤價"     : round(latest_close, 2),
        "漲幅(%)"    : round(change_pct, 2),
        "60日前高"   : round(high_60, 2),
        "距前高(%)"  : round(dist_pct, 1),
        "成交量(張)" : latest_vol_zhang,
        "扣低狀態"   : kou_di_label,
        "!"          : signal,
    }


# ──────────────────────────────────────────────
#  4. Telegram 通知
# ──────────────────────────────────────────────
def send_telegram(text: str) -> None:
    """發送文字訊息到 Telegram，超過 4096 字自動分段。"""
    if not TG_TOKEN or not TG_CHAT_ID:
        print("  [TG] 未設定 Token 或 Chat ID，跳過發送。")
        return
    url = f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage"
    limit = 4000  # 留緩衝，Telegram 上限 4096
    chunks = [text[i:i+limit] for i in range(0, len(text), limit)]
    for chunk in chunks:
        try:
            resp = requests.post(url, json={
                "chat_id"    : TG_CHAT_ID,
                "text"       : chunk,
                "parse_mode" : "HTML",
            }, timeout=15)
            if not resp.ok:
                print(f"  [TG] 發送失敗: {resp.text}")
        except Exception as e:
            print(f"  [TG] 發送錯誤: {e}")


def format_telegram_message(df: pd.DataFrame, date_str: str) -> str:
    """把篩選結果格式化成 Telegram 文字訊息。"""
    lines = [f"📊 <b>台股篩選結果 {date_str}</b>"]
    lines.append(f"符合條件：<b>{len(df)} 支</b>（均線多頭＋月線即將扣低＋電子股）\n")

    for _, row in df.iterrows():
        signal = "⚡" if row["!"] == "!" else ""
        change = row["漲幅(%)"]
        arrow  = "▲" if change > 0 else ("▼" if change < 0 else "─")
        lines.append(
            f"{signal}<b>{row['名稱']}</b>（{row['代碼']}）{row['產業']}\n"
            f"  {arrow} {row['收盤價']} ({change:+.2f}%)  "
            f"距前高 {row['距前高(%)']}%  "
            f"量 {row['成交量(張)']}張  "
            f"{row['扣低狀態']}"
        )
    return "\n".join(lines)


# ──────────────────────────────────────────────
#  5. 主程式
# ──────────────────────────────────────────────
def main():
    print("=" * 55)
    print("  台股篩選: 均線多頭排列 + 月線扣低 + 量 >= 1000 張")
    print("=" * 55)

    # Step 1 ── 取得清單
    print("\n[Step 1] 取得上市上櫃股票清單...")
    stocks = get_stock_list()
    print(f"  合計: {len(stocks)} 支")

    if not stocks:
        print("無法取得股票清單，程式結束。")
        sys.exit(1)

    # Step 2 ── 下載資料
    print("\n[Step 2] 下載歷史行情 (需要一點時間)...")
    all_data, ticker_map = download_all(stocks)

    # Step 3 ── 篩選
    print("\n[Step 3] 分析篩選...")
    results = []
    for ticker, df in all_data.items():
        info   = ticker_map.get(ticker, {})
        market = info.get("market", "TWSE")
        result = analyze(ticker, df, market)
        if result:
            industry = info.get("industry", "")
            if industry not in ELECTRONIC_INDUSTRIES:  # 非電子族群 → 跳過
                continue
            result["名稱"] = info.get("name", "")
            result["產業"] = industry
            results.append(result)

    # Step 4 ── 輸出
    print("\n" + "=" * 55)
    if not results:
        print("  沒有找到符合條件的股票。")
        return

    df_out = (
        pd.DataFrame(results)
        .sort_values("距前高(%)", ascending=True)   # 距高點最近的排前面
        .reset_index(drop=True)
    )
    df_out.index += 1

    print(f"  符合條件共 {len(results)} 支:\n")
    display_cols = ["名稱", "產業", "代碼", "市場", "收盤價",
                    "漲幅(%)", "60日前高", "距前高(%)", "成交量(張)", "扣低狀態", "!"]
    print(df_out[display_cols].to_string())

    # 發送 Telegram
    print("\n  發送 Telegram...")
    msg = format_telegram_message(df_out, datetime.now().strftime("%Y-%m-%d"))
    send_telegram(msg)


if __name__ == "__main__":
    main()
