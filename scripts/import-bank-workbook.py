#!/usr/bin/env python3
"""Import only FY 2021–2025 from a user bank workbook, without external data.

Usage: python3 scripts/import-bank-workbook.py INPUT.xlsx [--output OUTPUT.json]
Spreadsheet dependency: openpyxl. The source workbook is opened, never saved.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import tempfile
from datetime import datetime, timezone

import openpyxl
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "dist" / "banks-financials.json"
SITE_DATA = ROOT / "dist" / "data.json"
YEARS = [2021, 2022, 2023, 2024, 2025]
EXPECTED_BANKS = 10

# Match original column labels, including the variants present in this workbook.
HEADER_ALIASES = {
    "assets": ("الموجودات",),
    "financing": ("التمويل", "التمويل (صافي القروض)"),
    "deposits": ("ودائع العملاء",),
    "equity": ("حقوق المساهمين",),
    "netFinancingIncome": (
        "صافي دخل من التمويل والاستثمار", "صافي دخل التمويل والاستثمار",
    ),
    "operatingIncome": ("دخل العمليات",),
    "netProfit": ("صافي الربح",),
    "eps": ("ربحية السهم",),
    "dilutedEps": ("ربح السهم المخفف", "ربحية السهم المخففة", "ربح السهم المخفض"),
    "loansToDeposits": ("نسبة القروض إلى الودائع",),
    "returnOnEquity": ("العائد على حقوق المساهمين",),
    "retailFinancingShare": ("نسبة تمويل الأفراد",),
    "corporateFinancingShare": ("نسبة تمويل الشركات",),
    "internationalFinancingShare": ("دولية", "نسبة التمويل الدولي"),
    "pe": ("مكرر الأرباح",),
}
ABSENT_METRICS = ("provisions", "averageShares", "recurringEps")
REQUIRED_METRICS = tuple(k for k in HEADER_ALIASES if k != "internationalFinancingShare")
METRICS = tuple(HEADER_ALIASES) + ABSENT_METRICS
RATIOS = {
    "loansToDeposits": ("financing", "deposits"),
    "returnOnEquity": ("netProfit", "equity"),
}


class ImportValidationError(ValueError):
    """The workbook does not satisfy the required import contract."""


def normalized(value):
    return " ".join(str(value).split()) if value is not None else ""


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def numeric(value, location, optional=False):
    if value is None and optional:
        return None
    if not is_number(value):
        raise ImportValidationError(f"قيمة رقمية مطلوبة في {location}: {value!r}")
    return value


def safe_divide(numerator, denominator):
    """Return null for invalid operands/zero; no formula evaluator or cached values."""
    if not is_number(numerator) or not is_number(denominator) or denominator == 0:
        return None
    result = numerator / denominator
    return result if math.isfinite(result) else None


def parse_year(value, location):
    if isinstance(value, str) and re.fullmatch(r"\d{4}", value.strip()):
        return int(value.strip())
    if is_number(value) and float(value).is_integer():
        return int(value)
    raise ImportValidationError(f"سنة FY غير صالحة في {location}: {value!r}")


def load_bank_names(site_data):
    with Path(site_data).open(encoding="utf-8") as handle:
        data = json.load(handle)
    sectors = [sector for sector in data["sectors"] if normalized(sector["name"]) == "البنوك"]
    if len(sectors) != 1:
        raise ImportValidationError("يجب وجود قطاع بنوك واحد في dist/data.json")
    names = {}
    for stock in sectors[0]["stocks"]:
        symbol = str(stock["symbol"])
        if symbol in names or not isinstance(stock["name"], str) or not stock["name"]:
            raise ImportValidationError(f"رمز مكرر أو اسم غير صالح في قائمة الموقع: {symbol}")
        names[symbol] = stock["name"]
    if len(names) != EXPECTED_BANKS:
        raise ImportValidationError(f"عدد بنوك الموقع يجب أن يكون {EXPECTED_BANKS}؛ وُجد {len(names)}")
    return names


def find_header(sheet):
    """Annual tables are identified by the year and period headers, not sheet names."""
    for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 20)):
        labels = [normalized(cell.value) for cell in row]
        if "السنة" not in labels or "الفترة" not in labels:
            continue
        if labels.count("السنة") != 1 or labels.count("الفترة") != 1:
            raise ImportValidationError(f"رؤوس سنة/فترة مكررة: {sheet.title}")
        columns = {"year": labels.index("السنة") + 1, "period": labels.index("الفترة") + 1}
        for metric, aliases in HEADER_ALIASES.items():
            matches = [i + 1 for i, label in enumerate(labels) if label in aliases]
            if len(matches) > 1:
                raise ImportValidationError(f"رأس عمود مكرر {metric}: {sheet.title}")
            if not matches and metric in REQUIRED_METRICS:
                raise ImportValidationError(f"رأس عمود مطلوب مفقود {metric}: {sheet.title}")
            columns[metric] = matches[0] if matches else None
        return row[0].row, columns
    return None


def find_symbol(sheet):
    # The supplied workbook has the symbol at B11, next to the label at A11.
    matches = []
    for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 60)):
        for cell in row:
            if normalized(cell.value) == "رمز السهم":
                value = sheet.cell(cell.row, cell.column + 1).value
                if is_number(value) and float(value).is_integer():
                    symbol = str(int(value))
                else:
                    symbol = normalized(value)
                if not re.fullmatch(r"\d{4}", symbol):
                    raise ImportValidationError(f"رمز سهم غير صالح: {sheet.title}: {value!r}")
                matches.append(symbol)
    if len(matches) != 1:
        raise ImportValidationError(f"يجب وجود رمز سهم واحد: {sheet.title}")
    return matches[0]


def ratio_value(sheet, row, metric, columns, values):
    cell = sheet.cell(row, columns[metric])
    if cell.data_type != "f":
        return numeric(cell.value, f"{sheet.title}!{cell.coordinate}")
    numerator_key, denominator_key = RATIOS[metric]
    numerator_ref = f"{get_column_letter(columns[numerator_key])}{row}"
    denominator_ref = f"{get_column_letter(columns[denominator_key])}{row}"
    # Whitelist the exact same-row division only, optionally surrounded by parentheses.
    # No eval, GoogleFinance, formula cache, or general spreadsheet engine is used.
    expression = re.sub(r"\s+", "", cell.value).upper()
    expected = f"{numerator_ref}/{denominator_ref}"
    if expression not in (f"={expected}", f"=({expected})"):
        raise ImportValidationError(f"صيغة غير مسموحة في {sheet.title}!{cell.coordinate}: {cell.value}")
    result = safe_divide(values[numerator_key], values[denominator_key])
    if result is None:
        raise ImportValidationError(f"قسمة غير صالحة في {sheet.title}!{cell.coordinate}؛ لا يُكتب ملف ناقص")
    return result


def validate_payload(payload, names):
    banks = payload["banks"]
    symbols = [bank["symbol"] for bank in banks]
    if len(banks) != EXPECTED_BANKS or len(set(symbols)) != EXPECTED_BANKS or set(symbols) != set(names):
        raise ImportValidationError("يجب تطابق عشرة رموز بنوك دون تكرار أو نقص مع قائمة الموقع")
    for bank in banks:
        if bank["name"] != names[bank["symbol"]]:
            raise ImportValidationError(f"اسم الموقع غير مطابق: {bank['symbol']}")
        years = [record["year"] for record in bank["years"]]
        if years != YEARS:
            raise ImportValidationError(f"سنوات ناقصة أو مكررة أو غير مرتبة: {bank['symbol']}: {years}")
        for record in bank["years"]:
            if record["period"] != "FY" or set(record["values"]) != set(METRICS):
                raise ImportValidationError("الفترة أو مفاتيح القيم غير مطابقة")
            if set(record["cells"]) != set(METRICS):
                raise ImportValidationError("مفاتيح خلايا التتبع غير مطابقة")
            for metric, value in record["values"].items():
                if metric in REQUIRED_METRICS and not is_number(value):
                    raise ImportValidationError(f"قيمة مطلوبة مفقودة: {bank['symbol']}/{record['year']}/{metric}")
                if value is not None and not is_number(value):
                    raise ImportValidationError(f"قيمة غير رقمية: {metric}")
                if metric in ABSENT_METRICS and (value is not None or record["cells"][metric] is not None):
                    raise ImportValidationError(f"لا يجوز استنتاج {metric}")


def import_workbook(input_path, site_data=SITE_DATA):
    input_path = Path(input_path)
    before_hash = hashlib.sha256(input_path.read_bytes()).hexdigest()
    names = load_bank_names(site_data)
    workbook = openpyxl.load_workbook(input_path, data_only=False, read_only=False)
    banks_by_symbol = {}
    excluded_sheets = []
    excluded_fy = 0
    excluded_other_periods = 0
    formula_count = 0
    try:
        for sheet in workbook.worksheets:
            header = find_header(sheet)
            if header is None:
                excluded_sheets.append(sheet.title)
                continue
            header_row, columns = header
            symbol = find_symbol(sheet)
            if symbol not in names:
                raise ImportValidationError(f"رمز ورقة غير مطابق لبنوك الموقع: {sheet.title}: {symbol}")
            if symbol in banks_by_symbol:
                raise ImportValidationError(f"رمز بنك مكرر في المصنف: {symbol}")
            records = {}
            full_names = set()
            for row in range(header_row + 1, sheet.max_row + 1):
                period = normalized(sheet.cell(row, columns["period"]).value)
                if not period:
                    continue
                if period != "FY":
                    # Count only rows with a plausible year, not secondary tables/headers.
                    value = sheet.cell(row, columns["year"]).value
                    if re.fullmatch(r"\d{4}(?:\.0)?", normalized(value)):
                        excluded_other_periods += 1
                    continue
                year = parse_year(sheet.cell(row, columns["year"]).value, f"{sheet.title}/row {row}")
                if year not in YEARS:
                    excluded_fy += 1
                    continue
                if year in records:
                    raise ImportValidationError(f"سنة FY مكررة: {sheet.title}/{year}")
                full_name = sheet.cell(row, 1).value
                if not isinstance(full_name, str) or not full_name.strip():
                    raise ImportValidationError(f"اسم الشركة مفقود في {sheet.title}!A{row}")
                full_names.add(full_name)
                values, cells = {}, {}
                for metric in HEADER_ALIASES:
                    column = columns[metric]
                    cells[metric] = sheet.cell(row, column).coordinate if column is not None else None
                    if metric in RATIOS:
                        continue
                    value = sheet.cell(row, column).value if column is not None else None
                    values[metric] = numeric(
                        value, f"{sheet.title}!{cells[metric]}", optional=metric == "internationalFinancingShare"
                    )
                for metric in RATIOS:
                    values[metric] = ratio_value(sheet, row, metric, columns, values)
                    formula_count += int(sheet.cell(row, columns[metric]).data_type == "f")
                for metric in ABSENT_METRICS:
                    values[metric], cells[metric] = None, None
                records[year] = {
                    "year": year, "period": "FY",
                    "values": {metric: values[metric] for metric in METRICS},
                    "cells": {metric: cells[metric] for metric in METRICS},
                }
            if set(records) != set(YEARS):
                missing = sorted(set(YEARS) - set(records))
                raise ImportValidationError(f"سنوات FY مطلوبة مفقودة: {sheet.title}: {missing}")
            if len(full_names) != 1:
                raise ImportValidationError(f"أسماء الشركة تختلف بين الصفوف السنوية: {sheet.title}")
            banks_by_symbol[symbol] = {
                "symbol": symbol, "name": names[symbol], "fullName": next(iter(full_names)),
                "sourceSheet": sheet.title, "years": [records[year] for year in YEARS],
            }
    finally:
        workbook.close()
    if hashlib.sha256(input_path.read_bytes()).hexdigest() != before_hash:
        raise ImportValidationError("تغير ملف المصدر أثناء القراءة؛ أُلغي الاستيراد")
    missing_symbols = set(names) - set(banks_by_symbol)
    if missing_symbols:
        raise ImportValidationError(f"بنوك مطلوبة مفقودة: {sorted(missing_symbols)}")
    notes = [
        "أُدرجت فترات السنة المالية الكاملة FY للأعوام 2021–2025 فقط؛ لم تُدرج الفترات الفصلية أو بيانات معلومات السهم الحالية.",
        "القيم الرقمية من ملف المستخدم كما هي، دون تصحيح أو مطابقة بمصدر خارجي؛ المصدر user_workbook وليس Argaam API.",
        "أُعيد حساب صيغ نسبة القروض إلى الودائع = التمويل ÷ ودائع العملاء، والعائد على حقوق المساهمين = صافي الربح ÷ حقوق المساهمين، من القيم الأصلية دون استعمال النتائج المخزنة المقرّبة. لا تُنفّذ أي صيغ أخرى أو GOOGLEFINANCE.",
        "العائد على حقوق المساهمين يستخدم حقوق المساهمين في نهاية السنة وفق صيغة الملف، لا متوسط حقوق المساهمين.",
        "النسب محفوظة ككسور عشرية: 0.2 تعني 20%؛ لم تُضرب القيم النسبية في 100.",
        "مقياس البنود المالية هو مليون ريال، كما في القيم الأصلية؛ مثال: موجودات الراجحي 2025 = 1,043,268 مليون ريال. ربحية السهم بالريال والمكرر بالمرات؛ لم تُغيّر الوحدات أو تُضرب أو تُقسم القيم بمليون.",
        "ربحية السهم وربحية السهم المخففة من الأرقام الأصلية وقد لا تكون قابلة للمقارنة بين السنوات بسبب اختلاف أسس الأسهم أو التعديلات؛ لم يُستنتج عدد أسهم تاريخي من بيانات السهم الحالية.",
        "provisions وaverageShares وrecurringEps تساوي null لكل السنوات لأنها غير موجودة في الجدول السنوي؛ null لا تعني صفرًا.",
        "حصّة التمويل الدولي متاحة في الملف للأهلي 2025 فقط؛ بقية السنوات والبنوك null، دون استنتاج الفرق بين حصص الأفراد والشركات.",
        "حُفظت أرقام الراجحي كما وردت: صافي ربح 2024 = 19731 وربحية السهم = 4.93؛ صافي ربح 2025 = 24792 وربحية السهم = 6.2.",
        f"استُبعدت {excluded_fy} صفوف FY خارج 2021–2025 و{excluded_other_periods} صفوف ذات فترات غير FY.",
        "الأوراق غير السنوية المستبعدة: " + ("، ".join(excluded_sheets) if excluded_sheets else "لا توجد") + ".",
        "cells تحدد خلية المصدر الأصلية لكل مؤشر؛ null في cells تعني عدم وجود عمود مصدر، أو أن المؤشر غير موجود في الجدول السنوي.",
    ]
    payload = {
        "schemaVersion": 1, "years": YEARS.copy(),
        "source": {
            "type": "user_workbook", "fileName": input_path.name, "sha256": before_hash,
            "importedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "note": "القيم كما وردت في ملف المستخدم؛ لم تُراجع بمصدر خارجي.",
        },
        "notes": notes,
        "banks": [banks_by_symbol[symbol] for symbol in names],
    }
    validate_payload(payload, names)
    report = {
        "banks": len(payload["banks"]),
        "records": sum(len(bank["years"]) for bank in payload["banks"]),
        "requiredNumericValues": sum(len(REQUIRED_METRICS) * len(bank["years"]) for bank in payload["banks"]),
        "numericValues": sum(value is not None for bank in payload["banks"] for record in bank["years"] for value in record["values"].values()),
        "nullValues": sum(value is None for bank in payload["banks"] for record in bank["years"] for value in record["values"].values()),
        "recalculatedFormulas": formula_count,
        "excludedFYRows": excluded_fy,
        "excludedNonFYRows": excluded_other_periods,
        "excludedSheets": excluded_sheets,
    }
    return payload, report


def write_payload(payload, output_path, input_path):
    output_path, input_path = Path(output_path), Path(input_path)
    if output_path.resolve() in (input_path.resolve(), SITE_DATA.resolve()):
        raise ImportValidationError("لا يجوز الكتابة فوق ملف Excel أو dist/data.json")
    if output_path.suffix.lower() != ".json":
        raise ImportValidationError("يجب أن يكون مسار الإخراج ملف .json")
    text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output_path.parent, suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(text)
        temporary.replace(output_path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description="استيراد بيانات البنوك السنوية من ملف المستخدم فقط")
    parser.add_argument("input", type=Path, help="مسار ملف .xlsx الأصلي")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="المسار الافتراضي: dist/banks-financials.json")
    args = parser.parse_args(argv)
    try:
        payload, report = import_workbook(args.input)
        write_payload(payload, args.output, args.input)
    except (ImportValidationError, OSError, KeyError, json.JSONDecodeError) as error:
        print(f"فشل الاستيراد: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"output": str(args.output.resolve()), **report}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
