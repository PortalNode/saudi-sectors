#!/usr/bin/env python3
"""
يبني dist/<slug>-statements.json (المركز المالي والتدفقات النقدية) من ملفات XBRL الرسمية
التي نزّلها fetch-statements.py، ويتحقق منها بجداول ملخص تداول، ويكتب تقريرًا بالدقة.

    python3 scripts/build-statements.py                 # كل القطاعات
    python3 scripts/build-statements.py cement banks    # قطاعات محددة
    python3 scripts/build-statements.py --labels insurance   # البنود الخام الأكثر تكرارًا (للمراجعة)
"""
import collections
import datetime as dt
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from statements_xbrl import CACHE, parse_xbrl_file, parse_summary, rounding_factor  # noqa: E402
from statements_items import ITEMS, sector_type  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
PAGES_DIR = CACHE / "pages"
YEARS = [2021, 2022, 2023, 2024, 2025]
N_QUARTERS = 4
UNIT = 1_000_000  # مليون ريال
TOLERANCE = 0.005
USD_SAR = 3.75
# الصناديق العقارية: تداول يعرضها صناديقَ بلا ملفات XBRL ولا جدول ملخص في صفحة الشركة
SKIP_SECTORS = {"reits"}


def D(s):
    return dt.date.fromisoformat(s)


def month_end(year, month):
    nxt = dt.date(year + (month == 12), month % 12 + 1, 1)
    return nxt - dt.timedelta(days=1)


def file_stamp(name):
    m = re.search(r"_(\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d)_", name or "")
    return m.group(1) if m else ""


# ------------------------------------------------------------------ السنة المالية
class Fiscal:
    def __init__(self, end_month=12, label_by_start=False):
        self.end = end_month
        self.by_start = label_by_start

    def fy_end_year(self, d):
        return d.year if d.month <= self.end or self.end == 12 else d.year + 1

    def label(self, d):
        y = self.fy_end_year(d)
        return y - 1 if self.by_start and self.end != 12 else y

    def quarter(self, d):
        return ((d.month - self.end - 1) % 12) // 3 + 1

    def is_quarter_end(self, d):
        return (d.month - self.end) % 3 == 0 and d == month_end(d.year, d.month)

    def fy_start(self, d):
        y = self.fy_end_year(d)
        prev_end = month_end(y - 1, self.end)
        return prev_end + dt.timedelta(days=1)

    def prev_quarter_end(self, d):
        m = d.month - 3
        y = d.year
        if m <= 0:
            m += 12
            y -= 1
        return month_end(y, m)

    def key(self, d):
        return f"{self.label(d)}Q{self.quarter(d)}"


def fiscal_for(symbol, files):
    """السنة المالية من ملف الأرباع في الموقع إن وُجدت، وإلا من تواريخ الملفات السنوية."""
    for path in DIST.glob("*-quarterly-financials.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        for c in data.get("companies", []):
            if c["symbol"] == symbol and c.get("fiscalYearEnd"):
                note = c.get("fiscalNote") or ""
                return Fiscal(c["fiscalYearEnd"], "التي تبدأ فيها" in note)
    months = collections.Counter(D(f["docEnd"]).month for f in files if f["row"] == "سنوي" and f.get("docEnd"))
    return Fiscal(months.most_common(1)[0][0] if months else 12)


# ------------------------------------------------------------------ الحقائق المؤرخة لكل شركة
def snap_factor(raw, target):
    """أقرب مضاعف (1، ألف، مليون) يجعل raw قريبًا من target؛ None إن لم يقترب أي منها."""
    if not raw or not target:
        return None
    best = min((1, 1000, 1_000_000, 0.001), key=lambda f: abs(math.log(abs(raw * f / target))))
    return best if abs(raw * best / target - 1) < 0.1 else None


def _value_at(table, label_re, end):
    if not table:
        return None
    for label, vals in table["rows"]:
        if re.search(label_re, label):
            for (s, e), v in zip(table["cols"], vals):
                if e == end and v is not None:
                    return v
    return None


class Company:
    def __init__(self, record):
        self.record = record
        self.symbol = record["symbol"]
        self.notes = []          # ملاحظات التحقق والتصحيح
        self.summary = parse_summary(record.get("summary", []))
        self.files = []
        for f in sorted((f for f in record.get("files", []) if f.get("file")), key=lambda f: file_stamp(f["file"])):
            info = parse_xbrl_file(f["file"])
            if info and (info["bs"] or info["cf"]):
                docend = info.get("docEnd") or max((e for _, e in (info["bs"] or info["cf"])["cols"]), default=None)
                self.files.append({**f, "info": info, "docEnd": docend})
        self.fiscal = fiscal_for(self.symbol, self.files)
        self._resolve_factors()
        self._collect()

    # وحدة كل ملف: نصدق ملخص تداول أو ملفًا آخر متفقًا معه، لا ما كتبته الشركة فقط
    def _resolve_factors(self):
        ta = r"^إجمالي الموجودات$"
        known = {}  # date -> total assets بالريال
        for d, v in self.summary.get("totalAssets", {}).items():
            known[d] = v
        pending = []
        for f in self.files:
            info = f["info"]
            declared = rounding_factor(info.get("rounding"))
            f["factor"] = None
            # قوائم بالدولار (مثل أمريكانا) تُحوَّل إلى الريال بسعر الربط
            f["fx"] = USD_SAR if "دولار" in (info.get("currency") or "") else 1
            raw = _value_at(info["bs"], ta, f["docEnd"])
            raw = raw * f["fx"] if raw is not None else None
            snapped = snap_factor(raw, known.get(f["docEnd"]))
            if snapped:
                f["factor"] = snapped
            else:
                pending.append(f)
            if snapped and snapped != declared:
                self.notes.append(f"تصحيح وحدة ملف {f['row']} {f['year']}: الشركة كتبت «{info.get('rounding') or '—'}» والأرقام فعليًا ×{snapped:g}")
        # ملفات بلا ملخص لتاريخها: قارن أي عمود مشترك مع ملف حُسمت وحدته
        for _ in range(3):
            for f in [p for p in pending if p["factor"] is None]:
                for col in (f["info"]["bs"] or {"cols": []})["cols"]:
                    raw = _value_at(f["info"]["bs"], ta, col[1])
                    raw = raw * f["fx"] if raw is not None else None
                    other = next((g for g in self.files if g["factor"] and _value_at(g["info"]["bs"], ta, col[1])), None)
                    if other:
                        target = _value_at(other["info"]["bs"], ta, col[1]) * other["factor"] * other["fx"]
                        snapped = snap_factor(raw, target)
                        if snapped:
                            f["factor"] = snapped
                            declared = rounding_factor(f["info"].get("rounding"))
                            if snapped != declared:
                                self.notes.append(f"تصحيح وحدة ملف {f['row']} {f['year']}: الشركة كتبت «{f['info'].get('rounding') or '—'}» والأرقام فعليًا ×{snapped:g}")
                            break
        for f in self.files:
            if f["factor"] is None:
                f["factor"] = rounding_factor(f["info"].get("rounding"))

    def _collect(self):
        # الأرقام كما نُشرت في ملف الفترة نفسها (مثل ملخص تداول)؛ عمود المقارنة في ملف لاحق
        # يُستخدم فقط لفترة ليس لها ملف (مثل 2021). عند تكرار ملف الفترة يغلب الأحدث (المعدّل).
        own = {"bs": collections.defaultdict(dict), "cf": collections.defaultdict(dict)}
        comp = {"bs": collections.defaultdict(dict), "cf": collections.defaultdict(dict)}
        self.ends = set()
        for f in self.files:
            info, k, doc_end = f["info"], f["factor"] * f["fx"], f.get("docEnd")
            if doc_end:
                self.ends.add(doc_end)
            for stmt in ("bs", "cf"):
                table = info[stmt]
                if not table:
                    continue
                seen = set()
                for label, vals in table["rows"]:
                    for (s, e), v in zip(table["cols"], vals):
                        if v is None or not e:
                            continue
                        key = e if stmt == "bs" else (s, e)
                        if (label, key) in seen:
                            continue
                        seen.add((label, key))
                        target = own if e == doc_end else comp
                        target[stmt][label][key] = v * k
        self.bs = collections.defaultdict(dict)   # label -> {end: v}
        self.cf = collections.defaultdict(dict)   # label -> {(start, end): v}
        for stmt, store in (("bs", self.bs), ("cf", self.cf)):
            for label in set(own[stmt]) | set(comp[stmt]):
                store[label] = {**comp[stmt].get(label, {}), **own[stmt].get(label, {})}

    # ---------------- قيم الفترات
    def bs_at(self, label, end):
        return self.bs.get(label, {}).get(end)

    def cf_ytd(self, label, end):
        series = self.cf.get(label, {})
        fy_start = self.fiscal.fy_start(D(end))
        best = None
        for (s, e), v in series.items():
            if e != end:
                continue
            if s is None:            # أرصدة (النقد آخر الفترة) بلا تاريخ بداية
                best = best or (None, v)
                continue
            gap = abs((D(s) - fy_start).days)
            if gap <= 20 and (best is None or best[0] is None or gap < best[0]):
                best = (gap, v)
        return None if best is None else best[1]

    def cf_quarter(self, label, end, balance=False):
        cur = self.cf_ytd(label, end)
        if cur is None or balance:
            return cur
        d = D(end)
        if self.fiscal.quarter(d) == 1:
            return cur
        prev = self.cf_ytd(label, self.fiscal.prev_quarter_end(d).isoformat())
        return None if prev is None else cur - prev

    def annual_ends(self):
        """{سنة: تاريخ نهاية السنة المالية} للسنوات المطلوبة."""
        ends = {d for d in self.bs_dates() | self.summary_dates() if D(d).month == self.fiscal.end and D(d) == month_end(D(d).year, D(d).month)}
        out = {}
        for e in sorted(ends):
            out[self.fiscal.label(D(e))] = e
        return {y: out[y] for y in YEARS if y in out}

    def has_nci(self):
        """هل للشركة حصص غير مسيطرة فعلًا في المركز المالي؟"""
        if not hasattr(self, "_nci"):
            self._nci = any(re.search(r"غير المسيطرة|غير مسيطرة", lab) and any(abs(v) > 0 for v in series.values())
                            for lab, series in self.bs.items() if not lab.startswith("إجمالي حقوق الملكية المتعلقة"))
        return self._nci

    def summary_dates(self):
        """تواريخ لها إجمالي موجودات في ملخص تداول (تكمل سنوات وأرباعًا ليس لها ملف XBRL)."""
        return set(self.summary.get("totalAssets", {}))

    def bs_dates(self):
        return {e for series in self.bs.values() for e in series}

    def quarter_ends(self):
        ends = sorted(e for e in self.ends | self.summary_dates() if self.fiscal.is_quarter_end(D(e)))
        return ends[-N_QUARTERS:]


# ------------------------------------------------------------------ التوحيد
def _match(label, pat):
    return re.search(pat[3:], label) is not None if pat.startswith("re:") else label == pat


def resolve(company, stmt, spec, getter):
    """قيمة بند موحَّد في فترة: أول نمط له قيمة، أو مجموع البنود في وضع sum."""
    store = company.bs if stmt == "bs" else company.cf
    labels = list(store.keys())
    if spec.get("mode") == "sum":
        total, found, used = 0.0, False, set()
        for pat in spec["from"]:
            for lab in labels:
                if lab in used or not _match(lab, pat):
                    continue
                v = getter(lab)
                if v is not None:
                    total += v
                    found = True
                    used.add(lab)
                    if not spec.get("all"):
                        break
        value = total if found else None
    else:
        value = None
        for pat in spec["from"]:
            for lab in labels:
                if _match(lab, pat) and not any(_match(lab, x) for x in spec.get("exclude", [])):
                    v = getter(lab)
                    if v is not None:
                        value = v
                        break
            if value is not None:
                break
    if value is None and spec.get("fallback"):
        value = resolve(company, stmt, spec["fallback"], getter)
    if value is None and spec.get("fallbackNoNci") and not company.has_nci():
        value = resolve(company, stmt, {"from": spec["fallbackNoNci"]}, getter)
    if value is not None and spec.get("sign") == "out":
        value = -abs(value)
    return value


def compute(items, values):
    for item in items:
        if "calc" not in item:
            continue
        values[item["key"]] = {}
        periods = set().union(*(values.get(k, {}).keys() for k in item["needs"]))
        for p in periods:
            args = [values.get(k, {}).get(p) for k in item["needs"]]
            v = item["calc"](*args)
            if v is not None:
                values[item["key"]][p] = v


CORE = {"totalAssets": "bs", "totalLiabilities": "bs", "parentEquity": "bs", "cfo": "cf", "cfi": "cf", "cff": "cf", "cashEnd": "cf"}
BAD_GAP = 0.02   # فرق أكبر من 2% في الإجماليات يعني أن ملف الفترة نفسه خاطئ


def _differs(a, b, tol=TOLERANCE):
    return abs(a - b) > max(tol * abs(b), 0.05 * UNIT)


def build_company(record, stype):
    c = Company(record)
    items = ITEMS[stype]
    by_key = {i["key"]: i for stmt in ("bs", "cf") for i in items[stmt]}
    annual = c.annual_ends()
    quarters = c.quarter_ends()
    qkeys = {e: c.fiscal.key(D(e)) for e in quarters}
    s = c.summary
    c.checked = c.mismatched = c.filled = 0
    labels = {e: str(y) for y, e in annual.items()}
    labels.update({e: qkeys[e] for e in quarters})

    def xbrl(stmt, item, e):
        if stmt == "bs":
            return resolve(c, "bs", item, lambda lab: c.bs_at(lab, e))
        return resolve(c, "cf", item, lambda lab: c.cf_ytd(lab, e))

    # 1) مقارنة الإجماليات بملخص تداول لكل تاريخ، وتحديد الفترات التي ملفها خاطئ
    bad = {"bs": set(), "cf": set()}
    dates = set(labels) | {c.fiscal.prev_quarter_end(D(e)).isoformat() for e in quarters}
    for key, stmt in CORE.items():
        item = by_key.get(key)
        if not item or "calc" in item:
            continue
        for e in sorted(dates):
            official = s.get(key, {}).get(e)
            if official is None:
                continue
            mine = xbrl(stmt, item, e)
            if mine is None:
                continue
            c.checked += 1
            if _differs(mine, official):
                c.mismatched += 1
                where = labels.get(e, e) + (" (تراكمي)" if stmt == "cf" and e not in annual.values() and key != "cashEnd" else "")
                c.notes.append(f"{item['label']} {where}: ملف XBRL {mine / UNIT:,.1f} ≠ ملخص تداول {official / UNIT:,.1f} مليون → اعتُمد رقم تداول")
                if _differs(mine, official, BAD_GAP):
                    bad[stmt].add(e)
    for stmt in ("bs", "cf"):
        for e in sorted(bad[stmt]):
            if e in labels:
                c.notes.append(f"بنود {'المركز المالي' if stmt == 'bs' else 'التدفقات'} التفصيلية في {labels[e]} أُخفيت لأن ملف الشركة لتلك الفترة غير متسق")

    # 2) قيمة بند في تاريخ: الإجماليات من ملخص تداول إن وُجد، والبقية من XBRL ما لم يكن الملف خاطئًا
    def value(stmt, item, e):
        key = item["key"]
        if key in CORE:
            official = s.get(key, {}).get(e)
            if official is not None:
                return official
        elif e in bad[stmt]:
            return None
        return xbrl(stmt, item, e)

    out = {"bs": {}, "cf": {}}
    for stmt in ("bs", "cf"):
        for item in items[stmt]:
            if "calc" in item:
                continue
            vals = {}
            for y, e in annual.items():
                v = value(stmt, item, e)
                if v is not None:
                    vals[str(y)] = v
            # الربع المنفرد = التراكمي − تراكمي الربع السابق، بالإشارة كما نشرتها الشركة ثم نوحّد الإشارة
            raw = {k: v for k, v in item.items() if k != "sign"}
            for e in quarters:
                v = value(stmt, raw, e)
                out_item = item.get("sign") == "out"
                if stmt == "cf" and v is not None and not item.get("balance") and c.fiscal.quarter(D(e)) != 1:
                    prev = value(stmt, raw, c.fiscal.prev_quarter_end(D(e)).isoformat())
                    if prev is None:
                        v = None
                    elif out_item:
                        # مبالغ خارجة: بعض الشركات تقلب إشارتها بين ملف وآخر، فنطرح القيم المطلقة؛
                        # والتراكمي لا ينقص، فإن نقص فالأرقام متناقضة ولا نعرضها
                        v = abs(v) - abs(prev)
                        v = None if v < -0.05 * UNIT else max(v, 0.0)
                    else:
                        v = v - prev
                if v is not None and out_item:
                    v = -abs(v) if abs(v) >= 0.05 * UNIT else 0.0
                if v is not None:
                    vals[qkeys[e]] = v
            if item["key"] in CORE:
                for p, e in [(str(y), e) for y, e in annual.items()] + [(qkeys[e], e) for e in quarters]:
                    if p in vals and xbrl(stmt, item, e) is None and s.get(item["key"], {}).get(e) is not None:
                        c.filled += 1
            out[stmt][item["key"]] = vals
        compute(items[stmt], out[stmt])
    # التأمين: ملفاتها القديمة تفصل مطلوبات عمليات التأمين عن المساهمين بلا إجمالي؛ المطلوبات = الموجودات − حقوق المساهمين
    if stype == "insurance":
        tl, ta_, eq = out["bs"].setdefault("totalLiabilities", {}), out["bs"].get("totalAssets", {}), out["bs"].get("parentEquity", {})
        for p in ta_.keys() & eq.keys() - tl.keys():
            tl[p] = ta_[p] - eq[p]
    # بند في المركز المالي أكبر من إجمالي الموجودات خطأ (جمع مكرر أو بند في غير مكانه): لا يُعرض
    ta = out["bs"].get("totalAssets", {})
    for key, vals in out["bs"].items():
        # بنود الموجودات فقط: المطلوبات قد تتجاوز الموجودات فعلًا حين تكون حقوق الملكية سالبة
        if key == "totalAssets" or by_key[key].get("group") != "الموجودات" or by_key[key].get("unit") in ("ratio", "times") or "calc" in by_key[key]:
            continue
        for p in [p for p, v in vals.items() if ta.get(p) and abs(v) > 1.05 * abs(ta[p])]:
            c.notes.append(f"{by_key[key]['label']} {p}: {vals[p] / UNIT:,.1f} أكبر من إجمالي الموجودات {ta[p] / UNIT:,.1f} → لم يُعرض")
            del vals[p]
    for stmt in ("bs", "cf"):
        compute(items[stmt], out[stmt])
    # الديون جزء من المطلوبات: إن زادت عليها فالبنود مكررة، فلا تُعرض الديون ومؤشراتها لتلك الفترة
    debt, tl = out["bs"].get("totalDebt", {}), out["bs"].get("totalLiabilities", {})
    for p in [p for p, v in debt.items() if tl.get(p) is not None and v > 1.02 * tl[p]]:
        c.notes.append(f"إجمالي الديون {p}: {debt[p] / UNIT:,.1f} أكبر من إجمالي المطلوبات {tl[p] / UNIT:,.1f} → لم تُعرض الديون")
        for key in ("totalDebt", "shortDebt", "longDebt", "netDebt", "debtToEquity", "debtToAssets"):
            out["bs"].get(key, {}).pop(p, None)
    # شركة بلا حصص غير مسيطرة: «حقوق ملاك الشركة الأم» تكرر «إجمالي حقوق الملكية» فتُدمجان في صف واحد
    parent, total = out["bs"].get("parentEquity"), out["bs"].get("totalEquity")
    if stype != "insurance" and parent is not None and total is not None and all(abs(parent[p] - total[p]) < 0.0005 * max(abs(total[p]), 1) for p in parent.keys() & total.keys()):
        out["bs"]["totalEquity"] = {**parent, **total}
        del out["bs"]["parentEquity"]
    # إلى مليون ريال
    for stmt in ("bs", "cf"):
        for key, vals in list(out[stmt].items()):
            unit = by_key[key].get("unit")
            out[stmt][key] = {p: ((round(v, 4) if unit in ("ratio", "times") else round(v / UNIT, 2)) or 0.0) for p, v in vals.items()}
            if not out[stmt][key]:
                del out[stmt][key]
    name = next((f["info"]["name"] for f in reversed(c.files) if f["info"].get("name")), record["name"])
    return {
        "symbol": record["symbol"], "name": record["name"], "fullName": name,
        "status": "ok" if c.files or c.summary.get("totalAssets") else "missing",
        "fiscalYearEnd": c.fiscal.end,
        "years": [y for y in YEARS if y in annual],
        "quarters": [qkeys[e] for e in quarters],
        "quarterEnds": {qkeys[e]: e for e in quarters},
        "bs": out["bs"], "cf": out["cf"],
        "notes": c.notes,
    }, c


# ------------------------------------------------------------------ التشغيل
def sector_files():
    out = {}
    for path in sorted(DIST.glob("*-financials.json")):
        if "quarterly" in path.name:
            continue
        slug = path.name[: -len("-financials.json")]
        if slug in SKIP_SECTORS:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        out[slug] = (data.get("sector") or "البنوك", data.get("companies") or data.get("banks"))
    return out


def label_report(slug, year_end_hint=None):
    sector, companies = sector_files()[slug]
    counts = {"bs": collections.Counter(), "cf": collections.Counter()}
    n = 0
    for co in companies:
        p = PAGES_DIR / f"{co['symbol']}.json"
        if not p.exists():
            continue
        c = Company(json.loads(p.read_text(encoding="utf-8")))
        n += 1
        latest = max(c.ends) if c.ends else None
        for lab, series in c.bs.items():
            if latest in series:
                counts["bs"][lab] += 1
        for lab, series in c.cf.items():
            if any(e == latest for _, e in series):
                counts["cf"][lab] += 1
    print(f"{sector}: {n} شركة")
    for stmt in ("bs", "cf"):
        print("==", stmt)
        for lab, k in counts[stmt].most_common():
            print(k, lab)


def main(argv):
    if argv and argv[0] == "--labels":
        for slug in argv[1:]:
            label_report(slug)
        return
    sectors = sector_files()
    slugs = argv or list(sectors)
    report = ["# تقرير دقة البيانات المالية", "", f"المصدر: ملفات XBRL الرسمية في تداول، والتحقق بجداول الملخص في صفحة كل شركة. التاريخ: {dt.date.today()}", ""]
    totals = collections.Counter()
    for slug in slugs:
        sector, companies = sectors[slug]
        stype = sector_type(slug)
        items = ITEMS[stype]
        rows, lines = [], []
        for co in companies:
            p = PAGES_DIR / f"{co['symbol']}.json"
            if not p.exists():
                rows.append({"symbol": co["symbol"], "name": co["name"], "status": "missing"})
                lines.append(f"- ✗ {co['symbol']} {co['name']}: لم تُجلب")
                totals["missing"] += 1
                continue
            record = json.loads(p.read_text(encoding="utf-8"))
            record["name"] = co["name"]
            data, c = build_company(record, stype)
            if data["status"] != "ok":
                rows.append({"symbol": co["symbol"], "name": co["name"], "status": "missing"})
                lines.append(f"- ✗ {co['symbol']} {co['name']}: لا ملفات XBRL ({record.get('error') or '—'})")
                totals["missing"] += 1
                continue
            rows.append(data)
            totals["ok"] += 1
            totals["checked"] += c.checked
            totals["mismatched"] += c.mismatched
            totals["filled"] += c.filled
            gaps = [str(y) for y in YEARS if y not in data["years"]]
            mark = "✓" if not c.mismatched else "⚠"
            lines.append(f"- {mark} {co['symbol']} {co['name']}: سنوات {data['years'][0] if data['years'] else '—'}–{data['years'][-1] if data['years'] else '—'}"
                         f"{' (ناقص ' + '، '.join(gaps) + ')' if gaps else ''}، أرباع {'، '.join(data['quarters'])}؛ تحقق {c.checked} قيمة، اختلاف {c.mismatched}")
            lines += [f"    - {n}" for n in data["notes"]]
        dataset = {
            "schemaVersion": 1, "sector": sector, "unit": "مليون ريال", "type": stype, "years": YEARS,
            "source": {"name": "ملفات XBRL الرسمية — السوق المالية السعودية (تداول)", "checkedWith": "جداول الملخص في صفحة الشركة على موقع تداول", "builtAt": dt.date.today().isoformat()},
            "items": {stmt: [{k: v for k, v in i.items() if k in ("key", "label", "group", "total", "calc_label", "unit", "computed")} | ({"computed": True} if "calc" in i else {}) for i in items[stmt]] for stmt in ("bs", "cf")},
            "companies": [{k: v for k, v in r.items() if k != "notes"} | ({"notes": r["notes"]} if r.get("notes") else {}) for r in rows],
        }
        (DIST / f"{slug}-statements.json").write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        ok = sum(1 for r in rows if r.get("status") == "ok")
        report += [f"## {sector} ({ok}/{len(rows)})", *lines, ""]
        print(f"{slug}: {ok}/{len(rows)}", flush=True)
    report.insert(3, f"**الخلاصة:** {totals['ok']} شركة مكتملة، {totals['missing']} ناقصة؛ قيم مطابقة بملخص تداول {totals['checked'] - totals['mismatched']}/{totals['checked']}، وقيم أُخذت من الملخص {totals['filled']}.\n")
    (CACHE / "statements-report.md").write_text("\n".join(report), encoding="utf-8")
    print(f"\nالتقرير: {CACHE / 'statements-report.md'}")
    print(report[3])


if __name__ == "__main__":
    main(sys.argv[1:])
