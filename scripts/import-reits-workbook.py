#!/usr/bin/env python3
"""Import the REITs sector's annual results workbook (Argaam export).

Usage:
    python3 scripts/import-reits-workbook.py "<الصناديق العقارية - الأرباح السنوية.xlsx>"

REITs report their own items, kept exactly as in the workbook: rental income,
funds from operations (FFO), net income, number of units (millions), FFO per unit
and earnings per unit. "ربح الوحدة قبل البنود الاستثنائية" is "غير متوفر" for every
fund, so that row is skipped. Other "غير متوفر" cells are stored empty. The script
copies the workbook to argaam_reits.xlsx and writes dist/reits-financials.json. A
fund listed later than the others has no columns for the early years; only the
years it has are stored, so its table starts at its first year.

Workbook layout: one sheet per company "<name> - سنوي"; row 1 title with "(symbol)";
row 2 headers "السنة المالية 2021", "التغير السنوي", …; the items below. The
"التغير السنوي" columns are ignored (the page computes changes itself).
"""
import argparse, hashlib, json, math, re, shutil, sys
from datetime import datetime, timezone
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "dist" / "reits-financials.json"
TARGET = ROOT / "argaam_reits.xlsx"
SECTOR = "الصناديق العقارية المتداولة"
METRIC_KEYS = {
    "إيرادات الإيجار": "rentalIncome",
    "الدخل من العمليات التشغيلية (FFO)": "ffo",
    "صافي الدخل": "netProfit",
    "عدد الوحدات": "units",
    "ربح الوحدة من العمليات التشغيلية": "ffoPerUnit",
    "ربح الوحدة": "eps",
}
# Rows in the workbook that are left out on purpose (empty for every fund).
SKIPPED = {"ربح الوحدة قبل البنود الاستثنائية"}

class ImportValidationError(ValueError): pass

def norm(v): return " ".join(str(v).split()) if v is not None else ""
def finite(v): return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)

def read_sheet(ws):
    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 3: raise ImportValidationError(f"الورقة «{ws.title}» فارغة")
    title = norm(rows[0][0])
    found = re.search(r"\((\d{4})\)", title)
    if not found: raise ImportValidationError(f"لا يوجد رمز الشركة بين قوسين في عنوان «{ws.title}»")
    columns = []
    for index, header in enumerate(rows[1]):
        year = re.fullmatch(r"السنة المالية (\d{4})", norm(header))
        if year: columns.append((index, int(year.group(1))))
    if not columns: raise ImportValidationError(f"لا توجد أعمدة «السنة المالية …» في الصف الثاني من «{ws.title}»")
    values = {year: dict.fromkeys(METRIC_KEYS.values()) for _, year in columns}
    seen = set()
    for row in rows[2:]:
        label = norm(row[0])
        if not label or label in SKIPPED: continue
        key = METRIC_KEYS.get(label)
        if not key: raise ImportValidationError(f"بند غير معروف «{label}» في «{ws.title}»")
        seen.add(key)
        for index, year in columns:
            cell = row[index] if index < len(row) else None
            values[year][key] = round(float(cell), 6) if finite(cell) else None
    missing = [label for label, key in METRIC_KEYS.items() if key not in seen]
    if missing: raise ImportValidationError(f"بنود ناقصة في «{ws.title}»: {'، '.join(missing)}")
    name = re.sub(r"\s*-\s*سنوي$", "", norm(ws.title))
    return {
        "symbol": found.group(1), "name": name, "fullName": title.split("—")[0].strip(), "sourceSheet": ws.title,
        "years": [{"year": year, "period": "FY", "values": values[year]} for year in sorted(values)],
    }

def import_workbook(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    companies, symbols = [], set()
    for ws in wb.worksheets:
        company = read_sheet(ws)
        if company["symbol"] in symbols: raise ImportValidationError(f"الشركة {company['symbol']} مكررة")
        symbols.add(company["symbol"])
        companies.append(company)
    years = sorted({record["year"] for company in companies for record in company["years"]})
    for company in companies:
        have = {record["year"] for record in company["years"]}
        if have != set(range(min(have), years[-1] + 1)):
            raise ImportValidationError(f"سنوات {company['name']} ليست متصلة حتى {years[-1]}")
    return {
        "schemaVersion": 1,
        "sector": SECTOR,
        "years": years,
        "source": {"name": TARGET.name, "provider": "أرقام",
                   "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                   "importedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "note": "البنود كما في ملف أرقام؛ المبالغ بالمليون ريال، وعدد الوحدات بالمليون، وربح الوحدة بالريال. «غير متوفر» يُحفظ فارغًا، و«التغير السنوي» يُحسب في الصفحة."},
        "companies": companies,
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("workbook")
    source = Path(parser.parse_args().workbook).expanduser().resolve()
    try:
        data = import_workbook(source)
    except ImportValidationError as error:
        sys.exit(f"خطأ: {error}")
    if source != TARGET: shutil.copyfile(source, TARGET)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    nulls = sum(v is None for c in data["companies"] for r in c["years"] for v in r["values"].values())
    print(f"كُتب {OUTPUT.relative_to(ROOT)}: {len(data['companies'])} شركة، السنوات {data['years'][0]}–{data['years'][-1]}، قيم ناقصة: {nulls}")
    for company in data["companies"]:
        first = company["years"][0]["year"]
        if first > data["years"][0]: print(f"  {company['name']}: يبدأ من {first}")

if __name__ == "__main__":
    main()
