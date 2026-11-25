"""
قراءة ملفات XBRL من تداول وجداول الملخص، وتحويلها إلى «حقائق» مؤرخة لكل شركة.
يستخدمه build-statements.py. لا يتصل بالإنترنت.
"""
import datetime as dt
import json
import os
import re
from pathlib import Path

from bs4 import BeautifulSoup

CACHE = Path(os.environ.get("STATEMENTS_CACHE", Path.home() / ".cache" / "saudi-statements"))
XBRL_DIRS = [CACHE / "xbrl", Path.home() / "Desktop" / "sector_scripts" / "xbrl_cache"]
PARSED_DIR = CACHE / "parsed"
PARSER_VERSION = 3


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("‏", "").replace("‎", "")).strip()


def parse_num(s):
    s = clean(s).replace(",", "").replace("٬", "").replace("−", "-").replace(" ", "")
    if not s or s in ("-", "—", "--"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def parse_date(s):
    try:
        return dt.date.fromisoformat(clean(s)[:10]).isoformat()
    except (ValueError, TypeError):
        return None


def rounding_factor(text):
    t = text or ""
    if "مليون" in t or "ملايين" in t:
        return 1_000_000
    if re.search(r"آلاف|الاف|ألف|الآلاف|الألوف", t):
        return 1000
    return 1


def xbrl_path(name):
    for d in XBRL_DIRS:
        p = d / name
        if p.exists():
            return p
    return None


def _statement_table(rows):
    """{cols: [[start, end]], rows: [[label, [v…]]]} من جدول قائمة."""
    starts = ends = None
    body = []
    for r in rows:
        if r and r[0] == "بداية الفترة":
            starts = [parse_date(x) for x in r[1:]]
        elif r and r[0] == "نهاية الفترة":
            ends = [parse_date(x) for x in r[1:]]
        else:
            body.append(r)
    if not ends:
        return None
    n = len([e for e in ends if e])
    ends = ends[:n]
    starts = ((starts or []) + [None] * n)[:n]
    out_rows = []
    for r in body:
        if not r or not r[0]:
            continue
        vals = [parse_num(r[j + 1]) if j + 1 < len(r) else None for j in range(n)]
        out_rows.append([r[0], vals])
    return {"cols": [[s, e] for s, e in zip(starts, ends)], "rows": out_rows}


def parse_xbrl_file(name):
    """يقرأ ملف XBRL (HTML) مع ذاكرة مؤقتة للنتيجة."""
    cached = PARSED_DIR / (name + ".json")
    if cached.exists():
        data = json.loads(cached.read_text(encoding="utf-8"))
        if data.get("v") == PARSER_VERSION:
            return data
    path = xbrl_path(name)
    if path is None:
        return None
    html = path.read_text(encoding="utf-8", errors="replace")
    # الإيضاحات هي معظم الملف ولا نحتاجها: نقص ما بعد عنوانها الثاني (الأول في الفهرس)
    cut = [m.start() for m in re.finditer(r"\[4\d{5}\]", html)]
    if len(cut) >= 2:
        html = html[: cut[1]]
    soup = BeautifulSoup(html, "html.parser")
    info = {"v": PARSER_VERSION, "name": "", "currency": "", "rounding": "", "docEnd": None, "bs": None, "cf": None, "bsTitle": "", "cfTitle": ""}
    title = ""
    for t in soup.find_all("table"):
        rows = [[clean(c.get_text(" ", strip=True)) for c in tr.find_all(["td", "th"])] for tr in t.find_all("tr")]
        rows = [r for r in rows if any(r)]
        if not rows:
            continue
        if len(rows) == 1:
            joined = " ".join(x for x in rows[0] if x)
            if re.match(r"^\[\d{6}\]", joined):
                title = joined
            continue
        if "[100010]" in title:
            for r in rows:
                vals = [x for x in r[1:] if x]
                if not vals:
                    continue
                if "اسم المنشأة" in r[0] and not info["name"]:
                    info["name"] = vals[0]
                elif "عملة العرض" in r[0] and not info["currency"]:
                    info["currency"] = vals[0]
                elif "مستوى التقريب" in r[0]:
                    info["rounding"] = vals[0]
                elif "تاريخ نهاية الفترة" in r[0] and not info["docEnd"]:
                    info["docEnd"] = parse_date(vals[0])
            continue
        if not re.match(r"^\[3\d{5}\]", title):
            continue
        key = "bs" if "المركز المالي" in title else "cf" if "التدفقات النقدية" in title else None
        if key and info[key] is None:
            table = _statement_table(rows)
            if table:
                info[key] = table
                info[key + "Title"] = title
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
    return info


# ------------------------------------------------------------------ جداول ملخص تداول
SUMMARY_KEYS = [
    ("totalAssets", r"^إجمالي الموجودات$"),
    ("totalLiabilities", r"^إجمالي المطلوبات$"),
    ("parentEquity", r"^إجمالي حقوق الملكية \(بعد استبعاد|^حقوق المساهمين$"),
    ("cfo", r"^صافي (النقد|التدفق النقدي|التدفقات النقدية) (من|المستخدم في) (ال)?أنشطة التشغيلية"),
    ("cfi", r"^صافي (النقد|التدفق النقدي|التدفقات النقدية) (من|المستخدم في) (ال)?أنشطة ال[إا]ستثمارية"),
    ("cff", r"^صافي (النقد|التدفق النقدي|التدفقات النقدية) (من|المستخدم في) (ال)?أنشطة التمويلية"),
    ("cashEnd", r"^النقد وما يماثله في نهاية الفترة"),
]


def parse_summary(tables):
    """{key: {date: value بالريال}} من جداول الملخص في صفحة الشركة."""
    out = {}
    for rows in tables:
        if not rows:
            continue
        dates = [parse_date(x) for x in rows[0][1:]]
        units = None
        for r in rows:
            if r and r[0].startswith("جميع الأرقام"):
                units = [rounding_factor(x) if x else None for x in r[1:]]
        if units is None:
            continue
        for r in rows:
            label = clean(r[0]) if r else ""
            for key, pat in SUMMARY_KEYS:
                if re.search(pat, label):
                    for j, d in enumerate(dates):
                        v = parse_num(r[j + 1]) if j + 1 < len(r) else None
                        u = units[j] if j < len(units) else None
                        if d and v is not None and u:
                            out.setdefault(key, {}).setdefault(d, v * u)
                    break
    return out
