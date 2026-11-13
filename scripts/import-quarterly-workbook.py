#!/usr/bin/env python3
"""Import a sector's quarterly results workbook (Argaam export) for the period views.

Usage:
    python3 scripts/import-quarterly-workbook.py <slug> <workbook.xlsx>

<slug> is the page name in dist/ (retail, cement, food, hotels-tourism …). The script:
  1. copies the workbook to argaam_<slug>_quarterly.xlsx in the project root (unless
     it already is that file),
  2. matches every sheet to a company in dist/<slug>-financials.json (by the symbol in
     the sheet title "(1214)", then by sheet/company name),
  3. writes dist/<slug>-quarterly-financials.json,
  4. prints any year where Q1+Q2+Q3+Q4 differs from the annual figure (restatements).

Workbook layout: one sheet per company; row 1 title with "(symbol)"; row 2 headers
"الربع الأول 2022", "الربع الثاني 2022" …; first column holds the item names below.
Q4 must be the standalone fourth quarter, not the full year.
"""
import argparse, json, math, re, shutil, sys
from datetime import datetime, timezone
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
METRIC_KEYS = {
    "الإيرادات": "revenue",
    "إجمالي الدخل": "grossIncome",
    "دخل العمليات": "operatingIncome",
    "صافي الدخل": "netProfit",
    "ربح السهم قبل البنود الاستثنائية": "epsBeforeExceptional",
    "ربح السهم": "eps",
}
QUARTER_NAMES = {"الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4}

class ImportValidationError(ValueError): pass

def norm(v): return " ".join(str(v).split()) if v is not None else ""
def arnorm(v): return re.sub("[أإآ]", "ا", norm(v)).replace("ة", "ه").replace("ى", "ي").replace("ی", "ي").replace("ک", "ك")
def finite(v): return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)

def match_company(sheet_title, title_cell, companies):
    found = re.search(r"\((\d{4})\)", norm(title_cell))
    if found:
        for company in companies:
            if company["symbol"] == found.group(1): return company
    for company in companies:
        names = {company.get("sourceSheet"), company.get("name")}
        if any(n and arnorm(n) == arnorm(sheet_title) for n in names): return company
    raise ImportValidationError(f"لم أجد شركة مطابقة للورقة «{sheet_title}» في الملف السنوي")

def read_sheet(ws):
    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 3: raise ImportValidationError(f"الورقة «{ws.title}» فارغة")
    columns = []
    for index, header in enumerate(rows[1]):
        found = re.fullmatch(r"الربع (\S+) (\d{4})", norm(header))
        if not found: continue
        if found.group(1) not in QUARTER_NAMES: raise ImportValidationError(f"عنوان ربع غير معروف: {header}")
        columns.append((index, f"{found.group(2)}Q{QUARTER_NAMES[found.group(1)]}"))
    if not columns: raise ImportValidationError(f"لا توجد أعمدة «الربع …» في الصف الثاني من «{ws.title}»")
    quarters = {key: dict.fromkeys(METRIC_KEYS.values()) for _, key in columns}
    seen = set()
    for row in rows[2:]:
        key = METRIC_KEYS.get(norm(row[0]))
        if not key: continue
        seen.add(key)
        for index, quarter in columns:
            value = row[index] if index < len(row) else None
            quarters[quarter][key] = round(float(value), 6) if finite(value) else None
    if "revenue" not in seen and "netProfit" not in seen:
        raise ImportValidationError(f"لم أجد بندي الإيرادات وصافي الدخل في «{ws.title}»")
    return rows[0][0], {q: v for q, v in sorted(quarters.items()) if any(x is not None for x in v.values())}

def import_workbook(slug, input_path):
    annual_path = DIST / f"{slug}-financials.json"
    if not annual_path.exists(): raise ImportValidationError(f"لا يوجد ملف سنوي: {annual_path.name}")
    annual = json.loads(annual_path.read_text(encoding="utf-8"))
    wb = openpyxl.load_workbook(input_path, data_only=True, read_only=True)
    by_symbol = {}
    for ws in wb.worksheets:
        title, quarters = read_sheet(ws)
        company = match_company(ws.title, title, annual["companies"])
        if company["symbol"] in by_symbol: raise ImportValidationError(f"الشركة {company['name']} مكررة في أكثر من ورقة")
        by_symbol[company["symbol"]] = {"symbol": company["symbol"], "name": company["name"], "sourceSheet": ws.title, "quarters": quarters}
    companies = [by_symbol[c["symbol"]] for c in annual["companies"] if c["symbol"] in by_symbol]
    missing = [c["name"] for c in annual["companies"] if c["symbol"] not in by_symbol]
    all_quarters = sorted({q for c in companies for q in c["quarters"]})
    data = {
        "schemaVersion": 1,
        "sector": annual["sector"],
        "quarters": all_quarters,
        "source": {"name": f"argaam_{slug}_quarterly.xlsx", "provider": "أرقام",
                   "importedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "note": "أرباع مستقلة؛ فترات 6 و9 أشهر تُجمع من الأرباع داخل الصفحة."},
        "companies": companies,
    }
    return data, annual, missing

def restatement_report(data, annual):
    lines = []
    fy = {c["symbol"]: {r["year"]: r["values"] for r in c.get("years", [])} for c in annual["companies"]}
    for company in data["companies"]:
        for year, values in fy.get(company["symbol"], {}).items():
            for key in ("revenue", "netProfit"):
                parts = [company["quarters"].get(f"{year}Q{n}", {}).get(key) for n in range(1, 5)]
                total, official = (sum(parts) if None not in parts else None), values.get(key)
                if total is not None and finite(official) and abs(total - official) > max(1, abs(official) * 0.005):
                    lines.append(f"  {company['name']} {year} {key}: مجموع الأرباع {total:,.2f} ≠ السنوي {official:,.2f}")
    return lines

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("slug")
    parser.add_argument("workbook")
    args = parser.parse_args()
    source = Path(args.workbook).expanduser().resolve()
    target = ROOT / f"argaam_{args.slug}_quarterly.xlsx"
    try:
        data, annual, missing = import_workbook(args.slug, source)
    except ImportValidationError as error:
        sys.exit(f"خطأ: {error}")
    if source != target: shutil.copyfile(source, target)
    output = DIST / f"{args.slug}-quarterly-financials.json"
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"كُتب {output.relative_to(ROOT)}: {len(data['companies'])} شركة، من {data['quarters'][0]} إلى {data['quarters'][-1]}")
    if missing: print("شركات في الملف السنوي بلا بيانات ربعية: " + "، ".join(missing))
    report = restatement_report(data, annual)
    print("فروق بين مجموع الأرباع والسنوي (غالبًا تعديل أرقام سابقة):\n" + "\n".join(report) if report else "مجموع الأرباع يطابق السنوي في كل السنوات.")

if __name__ == "__main__":
    main()
