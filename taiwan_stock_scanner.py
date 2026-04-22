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

資料來源: 台灣 ISIN 網站 (股票清單) + TWSE/TPEX 官方 API (歷史行情)
需安裝套件: pip install pandas requests lxml
"""

import os
import io
import time
import pickle
import requests
import pandas as pd
from datetime import datetime, timedelta
import warnings
import sys
from pathlib import Path

# 程式所在資料夾 (CSV 會存在這裡)
BASE_DIR  = Path(__file__).parent
CACHE_FILE = BASE_DIR / "stock_data_cache.pkl"   # 歷史資料快取

warnings.filterwarnings("ignore")

# ──────────────────────────────────────────────
#  可調整參數
# ──────────────────────────────────────────────
MIN_TRADE_VALUE    = 50_000_000  # 最低成交金額 (元)：成交量(張) × 1000 × 股價 >= 5000萬
HISTORY_DAYS       = 360    # 下載幾天歷史資料 (360天≈257交易日，足夠算 MA240)
KOU_DI_FUTURE_DAYS = 5      # 「即將扣低」往後看幾個交易日
MA_PERIODS         = [5, 10, 20, 60, 120, 240]
API_SLEEP          = 0.35   # 每次官方 API 呼叫後的禮貌延遲 (秒)
SAVE_CSV           = False  # 關閉 CSV 輸出，改由 Telegram 傳送文字

# Telegram 設定
# 本機直接填入；GitHub Actions 會優先用 Secrets 覆蓋
TG_TOKEN   = os.environ.get("TG_BOT_TOKEN", "8041061344:AAEaPljQwnvWI8QJnkt_q3VBz1RmU14KDB8")
TG_CHAT_ID = os.environ.get("TG_CHAT_ID",   "-5227897042")

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
            tables = pd.read_html(io.StringIO(resp.text))
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
#  2. 下載歷史行情 (官方 TWSE / TPEX API，不受 Yahoo Finance 限流)
# ──────────────────────────────────────────────

def _past_weekdays(n_calendar_days: int) -> list[str]:
    """回傳過去 n_calendar_days 天內所有工作日 (週一～週五)，格式 YYYYMMDD，由舊到新。"""
    today = datetime.now().date()
    days = []
    for i in range(n_calendar_days, -1, -1):
        d = today - timedelta(days=i)
        if d.weekday() < 5:
            days.append(d.strftime("%Y%m%d"))
    return days


def _to_float(s) -> float:
    """移除千位逗號並轉 float，失敗回傳 nan。"""
    try:
        return float(str(s).replace(",", "").strip())
    except Exception:
        return float("nan")


def _fetch_twse_day(date_str: str, session: requests.Session, retries: int = 3) -> dict[str, tuple[float, int]]:
    """
    下載 TWSE 當日所有上市股票收盤資料。
    來源: 台灣證券交易所 STOCK_DAY_ALL
    回傳 {代號: (收盤價, 成交量_張)}，非交易日或失敗回傳空 dict。
    """
    url = (
        "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL"
        f"?date={date_str}&response=json"
    )
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=20)
            if not resp.ok:
                time.sleep(1)
                continue
            data = resp.json()
            if data.get("stat") != "OK":
                return {}  # 非交易日或假日，不需要 retry
            result = {}
            for row in data.get("data", []):
                try:
                    code = str(row[0]).strip()
                    if not (code.isdigit() and len(code) == 4):
                        continue
                    # 欄位順序: 代號,名稱,成交股數,成交筆數,成交金額,開盤,最高,最低,收盤,...
                    close = _to_float(row[8])
                    vol_shares = int(_to_float(row[2]))
                    if close != close or vol_shares <= 0:   # nan guard
                        continue
                    result[code] = (close, vol_shares // 1000)  # 股→張
                except Exception:
                    continue
            return result
        except Exception:
            time.sleep(1)
    return {}


def _fetch_tpex_day(date_str: str, session: requests.Session, retries: int = 3) -> dict[str, tuple[float, int]]:
    """
    下載 TPEX 當日所有上櫃股票收盤資料。
    來源: TPEX OpenAPI (不分頁，一次回傳全部股票)
    回傳 {代號: (收盤價, 成交量_張)}，非交易日或失敗回傳空 dict。
    """
    d = datetime.strptime(date_str, "%Y%m%d")
    date_param = f"{d.month:02d}/{d.day:02d}/{d.year}"  # MM/DD/YYYY
    url = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
    params = {"date": date_param}
    for attempt in range(retries):
        try:
            resp = session.get(url, params=params, timeout=20)
            if not resp.ok:
                time.sleep(1)
                continue
            data = resp.json()
            if not data:
                return {}  # 非交易日
            result = {}
            for item in data:
                try:
                    code = str(item.get("SecuritiesCompanyCode", "")).strip()
                    if not (code.isdigit() and len(code) == 4):
                        continue
                    close = _to_float(item.get("Close", ""))
                    vol_zhang = int(_to_float(item.get("TradeVolume", "0")))
                    if close != close or vol_zhang <= 0:
                        continue
                    result[code] = (close, vol_zhang)
                except Exception:
                    continue
            return result
        except Exception:
            time.sleep(1)
    return {}


def _to_df(rows: list) -> pd.DataFrame | None:
    """將 [(date_str, close, vol_zhang), ...] 轉成 DataFrame。"""
    if len(rows) < 250:
        return None
    df = pd.DataFrame(rows, columns=["Date", "Close", "Volume"])
    df["Date"] = pd.to_datetime(df["Date"], format="%Y%m%d")
    df = df.set_index("Date").sort_index()
    df["Volume"] = df["Volume"] * 1000   # 張→股數，與 analyze() 的 /1000 對應
    if df["Close"].std() < 0.001:
        return None
    return df


def download_all(stock_list: list[dict]) -> tuple[dict[str, pd.DataFrame], dict]:
    """
    下載歷史行情，支援快取：
    - 第一次執行：完整下載 HISTORY_DAYS 天（慢）
    - 之後每次：從快取讀取，只補抓缺少的日期（快）
    回傳 ({ticker: DataFrame}, ticker_map)
    """
    suffix_map = {"TWSE": ".TW", "TPEX": ".TWO"}
    ticker_map = {f"{s['code']}{suffix_map[s['market']]}": s for s in stock_list}

    twse_codes = {s["code"] for s in stock_list if s["market"] == "TWSE"}
    tpex_codes = {s["code"] for s in stock_list if s["market"] == "TPEX"}

    # ── 讀取快取 ──────────────────────────────────────
    cache: dict[str, list] = {}
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, "rb") as f:
                cache = pickle.load(f)
            print(f"  快取已載入：{len(cache)} 支股票")
        except Exception:
            print("  快取損毀，重新下載...")
            cache = {}

    # ── 計算需要補抓的日期 ─────────────────────────────
    needed_days  = set(_past_weekdays(HISTORY_DAYS))
    cached_dates = set()
    if cache:
        # 取任一股票的已有日期當作參考
        sample = next(iter(cache.values()))
        cached_dates = {r[0] for r in sample}

    missing_days = sorted(needed_days - cached_dates)

    if missing_days:
        print(f"  補抓 {len(missing_days)} 個交易日（快取已有 {len(cached_dates)} 天）...")
    else:
        print("  快取已是最新，跳過下載！")

    # ── 補抓缺少的日期 ────────────────────────────────
    if missing_days:
        # 初始化新股票的欄位
        for code in twse_codes:
            cache.setdefault(f"{code}.TW", [])
        for code in tpex_codes:
            cache.setdefault(f"{code}.TWO", [])

        session = requests.Session()
        session.headers.update({"User-Agent": "Mozilla/5.0 (compatible)"})

        for i, day in enumerate(missing_days):
            if i % 20 == 0:
                print(f"    進度: {i}/{len(missing_days)} 日")

            for code, (close, vol) in _fetch_twse_day(day, session).items():
                ticker = f"{code}.TW"
                if ticker in cache:
                    cache[ticker].append((day, close, vol))

            for code, (close, vol) in _fetch_tpex_day(day, session).items():
                ticker = f"{code}.TWO"
                if ticker in cache:
                    cache[ticker].append((day, close, vol))

            time.sleep(API_SLEEP)

    # ── 裁剪到所需日期範圍並排序 ──────────────────────
    for ticker in list(cache.keys()):
        cache[ticker] = sorted(
            [r for r in cache[ticker] if r[0] in needed_days],
            key=lambda x: x[0]
        )

    # ── 儲存快取 ──────────────────────────────────────
    try:
        with open(CACHE_FILE, "wb") as f:
            pickle.dump(cache, f)
    except Exception as e:
        print(f"  [警告] 快取儲存失敗: {e}")

    # ── 組裝 DataFrame ────────────────────────────────
    all_data: dict[str, pd.DataFrame] = {}
    for ticker, rows in cache.items():
        df = _to_df(rows)
        if df is not None:
            all_data[ticker] = df

    print(f"  成功取得資料: {len(all_data)} 支")
    return all_data, ticker_map


# ──────────────────────────────────────────────
#  3. 即時股價（盤中用）
# ──────────────────────────────────────────────
def is_market_open() -> bool:
    """判斷台股目前是否在交易時段（09:00～13:30 台灣時間）。"""
    now_tw = datetime.utcnow() + timedelta(hours=8)
    if now_tw.weekday() >= 5:   # 週六、週日
        return False
    t = now_tw.hour * 60 + now_tw.minute
    return 9 * 60 <= t <= 13 * 60 + 30


def fetch_live_prices(stock_list: list[dict]) -> dict[str, float]:
    """
    從 TWSE 即時 API 批次取得所有股票的最新成交價。
    回傳 {代號: 即時成交價}，抓不到的股票不會出現在 dict 裡。
    """
    ex_ch_parts = []
    code_map    = {}   # "tse_2330" → "2330"
    for s in stock_list:
        code   = s["code"]
        prefix = "tse" if s["market"] == "TWSE" else "otc"
        ex_ch_parts.append(f"{prefix}_{code}.tw")
        code_map[f"{prefix}_{code}"] = code

    result     = {}
    batch_size = 50
    headers    = {"User-Agent": "Mozilla/5.0"}

    for i in range(0, len(ex_ch_parts), batch_size):
        ex_ch = "|".join(ex_ch_parts[i:i+batch_size])
        url   = f"https://mis.twse.com.tw/stock/api/getStockInfo.asp?ex_ch={ex_ch}&json=1&delay=0"
        try:
            resp = requests.get(url, timeout=10, headers=headers)
            for item in resp.json().get("msgArray", []):
                ex  = item.get("ex", "")
                c   = item.get("c", "")
                z   = item.get("z", "-")    # 即時成交價
                if z and z != "-":
                    code = code_map.get(f"{ex}_{c}")
                    if code:
                        try:
                            result[code] = float(z)
                        except ValueError:
                            pass
        except Exception:
            pass
        time.sleep(0.1)

    return result


# ──────────────────────────────────────────────
#  4. 篩選條件
# ──────────────────────────────────────────────
def check_kou_di(close: pd.Series, ma_period: int = 20,
                 future_days: int = KOU_DI_FUTURE_DAYS,
                 current_price: float | None = None) -> tuple[bool, str]:
    """
    判斷月線是否「正在扣低」或「即將扣低」。
    current_price: 盤中即時成交價；None 時使用最後一根收盤價。

    邏輯:
      今天 MA20 計算中, 明天會移除 close[-20] 這個舊價格。
      如果 close[-20] < current_price, 代表移除的是低價 → MA20 即將上揚 (扣低)。

    回傳 (是否符合, 說明字串)
    """
    current_close = current_price if current_price is not None else float(close.iloc[-1])

    # --- 目前扣低 ---
    if len(close) > ma_period:
        price_to_remove = close.iloc[-ma_period]
        if price_to_remove < current_close:
            return True, "目前扣低"

    # --- 即將扣低 (未來 N 個交易日) ---
    for i in range(1, future_days + 1):
        idx = -ma_period + i
        if idx < 0 and abs(idx) <= len(close):
            if close.iloc[idx] < current_close:
                return True, f"即將扣低({i}日後)"

    return False, ""


def analyze(ticker: str, df: pd.DataFrame, market: str,
            live_price: float | None = None) -> dict | None:
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
    # 盤中傳入 live_price，用即時成交價判斷扣低；盤後用收盤價
    kou_di, kou_di_label = check_kou_di(close, current_price=live_price)
    if not kou_di or not kou_di_label.startswith("即將"):
        return None

    # ── 條件 3: 成交量 >= 1000 張 ─────────────────────────
    latest_vol_zhang = int(volume.iloc[-1] / 1000)
    trade_value = latest_vol_zhang * 1000 * latest_close  # 成交金額（元）
    if trade_value < MIN_TRADE_VALUE:
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
    """把篩選結果格式化成 Telegram 表格訊息。"""
    lines = [
        f"📊 <b>台股篩選結果 {date_str}</b>",
        f"符合條件：<b>{len(df)} 支</b>（均線多頭＋月線即將扣低＋電子股）\n",
        "<pre>",
        f"  {'代碼':<5} {'名稱':<7} {'產業':<9} {'股價':>7}",
        "─" * 34,
    ]

    for _, row in df.iterrows():
        signal = "⚡" if row["!"] == "!" else "  "
        code   = str(row['代碼'])
        name   = str(row['名稱'])[:6]
        sector = str(row['產業']).replace("業", "")[:7]
        price  = row['收盤價']
        lines.append(f"{signal}{code:<5} {name:<7} {sector:<9} {price:>7.2f}")

    lines.append("</pre>")
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

    # Step 3 ── 即時股價（盤中才抓）
    live_prices: dict[str, float] = {}
    if is_market_open():
        print("\n[Step 3] 盤中模式：抓取即時成交價...")
        live_prices = fetch_live_prices(stocks)
        print(f"  取得即時價格: {len(live_prices)} 支")
    else:
        print("\n[Step 3] 盤後模式：使用收盤價判斷扣低")

    # Step 4 ── 篩選
    print("\n[Step 4] 分析篩選...")
    results = []
    for ticker, df in all_data.items():
        info   = ticker_map.get(ticker, {})
        market = info.get("market", "TWSE")
        code   = ticker.replace(".TWO", "").replace(".TW", "")
        live_price = live_prices.get(code)   # 盤後為 None
        result = analyze(ticker, df, market, live_price=live_price)
        if result:
            industry = info.get("industry", "")
            if industry not in ELECTRONIC_INDUSTRIES:  # 非電子族群 → 跳過
                continue
            result["名稱"] = info.get("name", "")
            result["產業"] = industry
            results.append(result)

    # Step 5 ── 輸出
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
    display_cols = ["代碼", "名稱", "產業", "市場", "收盤價",
                    "漲幅(%)", "60日前高", "距前高(%)", "成交量(張)", "扣低狀態", "!"]
    print(df_out[display_cols].to_string())

    # 發送 Telegram
    print("\n  發送 Telegram...")
    msg = format_telegram_message(df_out, datetime.now().strftime("%Y-%m-%d"))
    send_telegram(msg)


if __name__ == "__main__":
    main()
