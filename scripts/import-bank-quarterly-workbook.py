#!/usr/bin/env python3
"""Import the banks' quarterly results workbook (Argaam export) for the banks page period views.

Usage:
    python3 scripts/import-bank-quarterly-workbook.py "<البنوك - الأرباح الربعية.xlsx>"

Banks report different items from the other sectors, so they have their own importer.
The script:
  1. copies the workbook to argaam_banks_quarterly.xlsx in the project root (unless it
     already is that file),
  2. matches every sheet to a bank in dist/banks-financials.json (by the symbol in the
     sheet title "(1120)", then by sheet/bank name),
  3. writes dist/banks-quarterly-financials.json,
  4. prints any year where Q1+Q2+Q3+Q4 differs from the annual figure (restatements).

Workbook layout: one sheet per bank; row 1 title with "(symbol)"; row 2 headers
"الربع الأول 2022", "التغير السنوي", "الربع الثاني 2022" …; first column holds the six items
below. "التغير السنوي" columns are ignored (the page computes changes itself), and
"غير متوفر" is stored as null. Q4 must be the standalone fourth quarter, not the full year.
The annual file dist/banks-financials.json is only read, never written.
"""
import argparse, json, math, re, shutil, sys
from datetime import datetime, timezone
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SECTOR = "البنوك"
# Item names exactly as in the workbook → keys used by the banks annual file.
METRIC_KEYS = {
    "صافي الدخل من الاستثمارات والتمويل": "netFinancingIncome",
    "دخل العمليات": "operatingIncome",
    "المخصصات": "provisions",
    "صافي الدخل": "netProfit",
    "ربح السهم": "eps",
    "ربح السهم المخفض": "dilutedEps",
}
QUARTER_NAMES = {"الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4}

class ImportValidationError(ValueError): pass

def norm(v): return " ".join(str(v).split()) if v is not None else ""
def arnorm(v): return re.sub("[أإآ]", "ا", norm(v)).replace("ة", "ه").replace("ى", "ي").replace("ی", "ي").replace("ک", "ك")
def finite(v): return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)

def match_bank(sheet_title, title_cell, banks):
    found = re.search(r"\((\d{4})\)", norm(title_cell))
    if found:
        for bank in banks:
            if bank["symbol"] == found.group(1): return bank
    for bank in banks:
        names = {bank.get("sourceSheet"), bank.get("name"), bank.get("fullName")}
        if any(n and arnorm(n) == arnorm(sheet_title) for n in names): return bank
    raise ImportValidationError(f"لم أجد بنكًا مطابقًا للورقة «{sheet_title}» في الملف السنوي")

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
        label = norm(row[0])
        if not label: continue
        key = METRIC_KEYS.get(label)
        if not key: raise ImportValidationError(f"بند غير معروف «{label}» في «{ws.title}»")
        seen.add(key)
        for index, quarter in columns:
            value = row[index] if index < len(row) else None
            quarters[quarter][key] = round(float(value), 6) if finite(value) else None
    if "netProfit" not in seen: raise ImportValidationError(f"لم أجد بند صافي الدخل في «{ws.title}»")
    return rows[0][0], {q: v for q, v in sorted(quarters.items()) if any(x is not None for x in v.values())}

def import_workbook(input_path):
    annual = json.loads((DIST / "banks-financials.json").read_text(encoding="utf-8"))
    wb = openpyxl.load_workbook(input_path, data_only=True, read_only=True)
    by_symbol = {}
    for ws in wb.worksheets:
        title, quarters = read_sheet(ws)
        bank = match_bank(ws.title, title, annual["banks"])
        if bank["symbol"] in by_symbol: raise ImportValidationError(f"البنك {bank['name']} مكرر في أكثر من ورقة")
        by_symbol[bank["symbol"]] = {"symbol": bank["symbol"], "name": bank["name"], "sourceSheet": ws.title, "quarters": quarters}
    companies = [by_symbol[b["symbol"]] for b in annual["banks"] if b["symbol"] in by_symbol]
    missing = [b["name"] for b in annual["banks"] if b["symbol"] not in by_symbol]
    data = {
        "schemaVersion": 1,
        "sector": SECTOR,
        "quarters": sorted({q for c in companies for q in c["quarters"]}),
        "source": {"name": "argaam_banks_quarterly.xlsx", "provider": "أرقام",
                   "importedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "note": "أرباع مستقلة؛ فترات 6 و9 أشهر تُجمع من الأرباع داخل الصفحة. «غير متوفر» محفوظ null."},
        "companies": companies,
    }
    return data, annual, missing

def restatement_report(data, annual):
    lines = []
    fy = {b["symbol"]: {r["year"]: r["values"] for r in b["years"]} for b in annual["banks"]}
    for company in data["companies"]:
        for year, values in fy.get(company["symbol"], {}).items():
            for key in ("netFinancingIncome", "operatingIncome", "netProfit"):
                parts = [company["quarters"].get(f"{year}Q{n}", {}).get(key) for n in range(1, 5)]
                total, official = (sum(parts) if None not in parts else None), values.get(key)
                if total is not None and finite(official) and abs(total - official) > max(1, abs(official) * 0.005):
                    lines.append(f"  {company['name']} {year} {key}: مجموع الأرباع {total:,.2f} ≠ السنوي {official:,.2f}")
    return lines

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("workbook")
    source = Path(parser.parse_args().workbook).expanduser().resolve()
    target = ROOT / "argaam_banks_quarterly.xlsx"
    try:
        data, annual, missing = import_workbook(source)
    except ImportValidationError as error:
        sys.exit(f"خطأ: {error}")
    if source != target: shutil.copyfile(source, target)
    output = DIST / "banks-quarterly-financials.json"
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"كُتب {output.relative_to(ROOT)}: {len(data['companies'])} بنوك، من {data['quarters'][0]} إلى {data['quarters'][-1]}")
    unavailable = sorted({c["name"] for c in data["companies"] if all(v.get("netFinancingIncome") is None for v in c["quarters"].values())})
    if unavailable: print("بنوك بلا «صافي الدخل من الاستثمارات والتمويل» ربعيًا (غير متوفر في الملف): " + "، ".join(unavailable))
    if missing: print("بنوك في الملف السنوي بلا بيانات ربعية: " + "، ".join(missing))
    report = restatement_report(data, annual)
    print("فروق بين مجموع الأرباع والسنوي (غالبًا تعديل أرقام سابقة):\n" + "\n".join(report) if report else "مجموع الأرباع يطابق السنوي في كل السنوات.")

if __name__ == "__main__":
    main()
