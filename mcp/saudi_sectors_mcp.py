#!/usr/bin/env python3
"""MCP server (stdio, no dependencies) exposing the Saudi sectors site data.

Reads JSON straight from the published site, falling back to the local
dist/ folder when the site can't be reached.
"""
import json
import os
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

SITE = os.environ.get("SAUDI_SECTORS_URL", "https://portalnode.github.io/saudi-sectors/").rstrip("/") + "/"
LOCAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
CACHE_TTL = 600  # seconds

SLUGS = [
    "agriculture", "banks", "business-services", "cement", "consumer", "education",
    "exchange", "finance", "financial-services", "food", "glass", "health",
    "healthservices", "hotels-tourism", "industrial", "information-technology",
    "insurance", "materials", "media", "mining", "multi", "oilgas", "petrochem",
    "pharma", "realestate", "reits", "retail", "sports", "telecom", "transport",
    "utilities",
]

_cache = {}
_lock = threading.Lock()


def fetch(name):
    now = time.time()
    with _lock:
        hit = _cache.get(name)
        if hit and now - hit[0] < CACHE_TTL:
            return hit[1]
    data = None
    try:
        req = urllib.request.Request(SITE + name + f"?t={int(now)}", headers={"User-Agent": "saudi-sectors-mcp"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception:
        path = os.path.join(LOCAL, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
    with _lock:
        _cache[name] = (now, data)
    return data


def norm(s):
    s = str(s or "").strip().lower()
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي"), ("ـ", "")):
        s = s.replace(a, b)
    return s


def stocks():
    d = fetch("data.json") or {}
    out = []
    for sec in d.get("sectors", []):
        for st in sec.get("stocks", []):
            out.append((sec["name"], st))
    return d, out


def financial_index():
    """symbol -> {"annual": company, "quarterly": company, "units": note}"""
    names = []
    for s in SLUGS:
        names.append(f"{s}-financials.json")
        if s != "reits":
            names.append(f"{s}-quarterly-financials.json")
        names.append(f"{s}-statements.json")
    with ThreadPoolExecutor(8) as ex:
        results = dict(zip(names, ex.map(fetch, names)))
    idx = {}
    for name, doc in results.items():
        if not doc:
            continue
        kind = "quarterly" if "quarterly" in name else "statements" if "statements" in name else "annual"
        for c in doc.get("companies") or doc.get("banks") or []:
            idx.setdefault(str(c.get("symbol")), {})[kind] = c
    return idx


def find(query):
    _, all_stocks = stocks()
    q = norm(query)
    exact = [x for x in all_stocks if x[1].get("symbol") == str(query).strip() or norm(x[1].get("name")) == q]
    if exact:
        return exact
    return [x for x in all_stocks if q and q in norm(x[1].get("name"))]


QUOTE_KEYS = [
    "symbol", "name", "price", "priceDate", "priceStatus", "day", "ytd", "month3", "month6", "year1",
    "marketCap", "shares", "eps", "pe", "bookValue", "pb", "dividendYield",
    "week52Low", "week52High", "tradedValue", "suspended",
]


def tool_search(args):
    q = args.get("query", "")
    res = find(q)
    if not res:
        qn = norm(q)
        _, all_stocks = stocks()
        res = [x for x in all_stocks if qn in norm(x[0])]
    return [{"symbol": s["symbol"], "name": s["name"], "sector": sec, "price": s.get("price")} for sec, s in res[:40]]


def tool_company(args):
    res = find(args.get("company", ""))
    if not res:
        return {"error": "لم أجد شركة بهذا الاسم أو الرمز. جرّب search_companies."}
    if len(res) > 1 and not args.get("first"):
        return {"matches": [{"symbol": s["symbol"], "name": s["name"], "sector": sec} for sec, s in res]}
    sector, st = res[0]
    sym = st["symbol"]
    d = fetch("data.json") or {}
    out = {
        "sector": sector,
        "quote": {k: st.get(k) for k in QUOTE_KEYS if k in st},
        "units": "القيمة السوقية بالمليون ريال؛ الأداء بالنسبة المئوية؛ البنود المالية بالمليون ريال؛ الهوامش والنسب ككسور (0.2 = 20%)",
        "financialPeriodForRatios": d.get("financialPeriod"),
        "pageUrl": SITE + "index.html",
    }
    prof = (fetch("company-profiles.json") or {}).get(sym)
    if prof:
        out["profile"] = prof
    fin = financial_index().get(sym, {})
    if "annual" in fin:
        out["annual"] = [{"year": y.get("year"), **(y.get("values") or {})} for y in fin["annual"].get("years", [])]
    if "quarterly" in fin:
        qs = fin["quarterly"].get("quarters", {})
        n = int(args.get("quarters", 8))
        out["quarterly"] = [{"quarter": k, **v} for k, v in sorted(qs.items())[-n:]]
    stm = fin.get("statements")
    if stm and stm.get("status") == "ok":
        out["statements"] = {
            "note": "المركز المالي (bs) والتدفقات النقدية (cf) بالمليون ريال من ملفات XBRL الرسمية في تداول، والإجماليات مطابقة لملخص تداول. المفاتيح: سنوات مثل 2025، وأرباع مثل 2026Q3 (التدفقات الربعية لكل ربع منفرد). صافي الدين السالب = فائض نقدي.",
            "fiscalYearEndMonth": stm.get("fiscalYearEnd"),
            "years": stm.get("years"), "quarters": stm.get("quarters"),
            "balanceSheet": stm.get("bs"), "cashFlow": stm.get("cf"),
        }
    cal = fetch(f"earnings-calendar/{sym}.json")
    if cal and cal.get("recs"):
        out["resultsDates"] = {
            "note": "next = الموعد المتوقع لإعلان النتائج القادمة: تقدير من سجل الشركة (وسيط آخر 3 سنوات للفترة نفسها) وليس موعدًا رسميًا. lag = أيام بعد نهاية الفترة، rx = حركة السهم % في أول جلسة بعد الإعلان، yoy = تغير صافي الربح % عن نفس الفترة.",
            "fiscalYearEndMonth": cal.get("fye"),
            "next": cal.get("next"),
            "speedVsMarketDays": cal.get("rel"), "sectorSpeedRank": cal.get("rank"), "sectorCompanies": cal.get("peers"),
            "backtest": cal.get("bt"),
            "history": [{k: r.get(k) for k in ("fy", "q", "pe", "d", "tm", "lag", "yoy", "rx")} for r in cal["recs"][-12:]],
        }
    ohlc = fetch(f"ohlc/{sym}.json")
    if ohlc and ohlc.get("c"):
        c, dts = ohlc["c"], ohlc["d"]

        def chg(n):
            return round((c[-1] / c[-1 - n] - 1) * 100, 2) if len(c) > n and c[-1 - n] else None
        last250 = c[-250:]
        out["priceHistory"] = {
            "lastDate": dts[-1], "lastClose": c[-1],
            "change1w%": chg(5), "change1m%": chg(21), "change3m%": chg(63), "change1y%": chg(250),
            "high1y": max(ohlc["h"][-250:]), "low1y": min(ohlc["l"][-250:]),
            "avgClose50d": round(sum(c[-50:]) / len(c[-50:]), 2),
            "avgClose200d": round(sum(c[-200:]) / len(c[-200:]), 2),
            "avgVolume20d": round(sum(ohlc["v"][-20:]) / 20) if ohlc.get("v") else None,
            "closes1y": len(last250),
        }
    return out


def tool_sector(args):
    q = norm(args.get("sector", ""))
    d = fetch("data.json") or {}
    secs = [s for s in d.get("sectors", []) if q and q in norm(s["name"])]
    if not secs:
        return {"error": "قطاع غير معروف", "sectors": [s["name"] for s in d.get("sectors", [])]}
    keys = ["symbol", "name", "price", "day", "ytd", "year1", "marketCap", "pe", "pb", "dividendYield"]
    return [{"sector": s["name"], "stocks": [{k: st.get(k) for k in keys} for st in s["stocks"]]} for s in secs]


def tool_market(args):
    d = fetch("data.json") or {}
    _, all_stocks = stocks()
    live = [s for _, s in all_stocks if isinstance(s.get("day"), (int, float))]
    live.sort(key=lambda s: s["day"])
    pick = lambda arr: [{"symbol": s["symbol"], "name": s["name"], "day": s["day"]} for s in arr]
    return {
        "asOf": d.get("asOf"),
        "tasi": d.get("marketSummary"),
        "sectors": [s["name"] for s in d.get("sectors", [])],
        "topGainers": pick(live[::-1][:10]),
        "topLosers": pick(live[:10]),
        "companyCount": len(all_stocks),
    }


TOOLS = {
    "search_companies": (tool_search, "ابحث عن شركة بالاسم أو الرمز أو القطاع في موقع قطاعات السوق السعودي. Search companies by name, symbol or sector.",
                         {"query": {"type": "string", "description": "اسم الشركة أو رمزها أو اسم القطاع"}}, ["query"]),
    "get_company": (tool_company, "كل بيانات شركة من الموقع: السعر والمكررات والأداء، النبذة، النتائج السنوية والربعية، المركز المالي والتدفقات النقدية، مواعيد إعلان النتائج (السابقة والموعد المتوقع القادم)، وملخص تاريخ السعر.",
                    {"company": {"type": "string", "description": "اسم الشركة أو رمزها مثل 2222 أو الراجحي"},
                     "quarters": {"type": "integer", "description": "عدد الأرباع الأخيرة (افتراضي 8)"},
                     "first": {"type": "boolean", "description": "خذ أول تطابق إذا تعددت النتائج"}}, ["company"]),
    "get_sector": (tool_sector, "قائمة شركات قطاع مع السعر والأداء والقيمة السوقية والمكرر والعائد.",
                   {"sector": {"type": "string", "description": "اسم القطاع مثل البنوك أو الاسمنت"}}, ["sector"]),
    "market_overview": (tool_market, "ملخص السوق: مؤشر تاسي، القطاعات، أكثر الأسهم ارتفاعاً وانخفاضاً اليوم.", {}, []),
}


def handle(msg):
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
        result = {
            "protocolVersion": msg.get("params", {}).get("protocolVersion", "2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "saudi-sectors", "version": "1.0.0"},
        }
    elif method == "tools/list":
        result = {"tools": [
            {"name": n, "description": d, "inputSchema": {"type": "object", "properties": p, "required": r}}
            for n, (_, d, p, r) in TOOLS.items()
        ]}
    elif method == "tools/call":
        p = msg.get("params", {})
        tool = TOOLS.get(p.get("name"))
        if not tool:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": "unknown tool"}}
        try:
            data = tool[0](p.get("arguments") or {})
            result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
        except Exception as e:
            result = {"content": [{"type": "text", "text": f"خطأ: {e}"}], "isError": True}
    elif method == "ping":
        result = {}
    elif mid is None:
        return None  # notification
    else:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found"}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            resp = handle(json.loads(line))
        except Exception as e:
            resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(e)}}
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
