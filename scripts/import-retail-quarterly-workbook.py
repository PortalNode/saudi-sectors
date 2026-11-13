#!/usr/bin/env python3
"""Import quarterly retail sector results (Q1 2022 onward) from the supplied workbook.

Each sheet holds one company; columns are standalone quarters ("الربع الأول 2022" …).
The fourth quarter is the standalone Q4, not the full year. Output is consumed by
dist/retail.js for the quarter / 6-month / 9-month views.
"""
import argparse, json, math, re
from datetime import datetime, timezone
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "argaam_retail_quarterly.xlsx"
DEFAULT_OUTPUT = ROOT / "dist" / "retail-quarterly-financials.json"
ANNUAL = ROOT / "dist" / "retail-financials.json"
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
def finite(v): return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)

def import_workbook(input_path, annual_path=ANNUAL):
    annual = json.loads(Path(annual_path).read_text(encoding="utf-8"))
    by_sheet = {norm(c["sourceSheet"]): c for c in annual["companies"]}
    wb = openpyxl.load_workbook(input_path, data_only=True, read_only=True)
    companies, all_quarters = [], set()
    for ws in wb.worksheets:
        ref = by_sheet.get(norm(ws.title))
        if ref is None: raise ImportValidationError(f"ورقة غير موجودة في الملف السنوي: {ws.title}")
        rows = list(ws.iter_rows(values_only=True))
        columns = []
        for index, header in enumerate(rows[1]):
            match = re.fullmatch(r"الربع (\S+) (\d{4})", norm(header))
            if match:
                if match.group(1) not in QUARTER_NAMES: raise ImportValidationError(f"عنوان ربع غير معروف: {header}")
                columns.append((index, f"{match.group(2)}Q{QUARTER_NAMES[match.group(1)]}"))
        if not columns: raise ImportValidationError(f"لا توجد أعمدة ربعية في {ws.title}")
        quarters = {key: {m: None for m in METRIC_KEYS.values()} for _, key in columns}
        for row in rows[2:]:
            key = METRIC_KEYS.get(norm(row[0]))
            if not key: continue
            for index, quarter in columns:
                value = row[index] if index < len(row) else None
                quarters[quarter][key] = round(float(value), 6) if finite(value) else None
        quarters = {q: v for q, v in quarters.items() if any(x is not None for x in v.values())}
        all_quarters.update(quarters)
        companies.append({"symbol": ref["symbol"], "name": ref["name"], "sourceSheet": ws.title,
                          "quarters": dict(sorted(quarters.items()))})
    order = {c["symbol"]: i for i, c in enumerate(annual["companies"])}
    companies.sort(key=lambda c: order[c["symbol"]])
    if len(companies) != len(annual["companies"]): raise ImportValidationError("عدد الشركات لا يطابق الملف السنوي")
    return {
        "schemaVersion": 1,
        "sector": annual["sector"],
        "quarters": sorted(all_quarters),
        "source": {"name": Path(input_path).name, "provider": "أرقام",
                   "importedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "note": "أرباع مستقلة؛ فترات 6 و9 أشهر تُجمع من الأرباع داخل الصفحة."},
        "companies": companies,
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", default=DEFAULT_INPUT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    data = import_workbook(args.input)
    Path(args.output).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {args.output}: {len(data['companies'])} companies, {data['quarters'][0]}–{data['quarters'][-1]}")
