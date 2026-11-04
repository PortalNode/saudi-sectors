#!/usr/bin/env python3
"""Explicit Python tests; not included in the project's existing Node test defaults.

python3 scripts/import-bank-workbook.test.py [--input /path/to/البنوك.xlsx]
The original workbook is read only. Mutation tests use temporary copies.
"""

import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("bank_importer", ROOT / "scripts" / "import-bank-workbook.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)
WORKBOOK_PATH = Path("/home/ubuntu/upload/البنوك.xlsx")

# Independent source-column references for the supplied workbook, not the importer map.
DIRECT_COLUMNS = {
    "assets": "D", "financing": "E", "deposits": "F", "equity": "G",
    "netFinancingIncome": "H", "operatingIncome": "I", "netProfit": "J",
    "eps": "K", "dilutedEps": "L", "retailFinancingShare": "O",
    "corporateFinancingShare": "P", "pe": "Q",
}
EXPECTED_KEYS = set(DIRECT_COLUMNS) | {
    "loansToDeposits", "returnOnEquity", "internationalFinancingShare",
    "provisions", "averageShares", "recurringEps",
}


class BankImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source_hash = hashlib.sha256(WORKBOOK_PATH.read_bytes()).hexdigest()
        cls.source = openpyxl.load_workbook(WORKBOOK_PATH, data_only=False)
        cls.payload, cls.report = importer.import_workbook(WORKBOOK_PATH)
        with (ROOT / "dist" / "banks-financials.json").open(encoding="utf-8") as handle:
            cls.json_payload = json.load(handle)
        cls.names = importer.load_bank_names(ROOT / "dist" / "data.json")

    @classmethod
    def tearDownClass(cls):
        cls.source.close()
        if hashlib.sha256(WORKBOOK_PATH.read_bytes()).hexdigest() != cls.source_hash:
            raise AssertionError("Original workbook changed during tests")

    def temporary_workbook(self, edit):
        # Copy values/formulas only into a temporary workbook; never save the source.
        workbook = openpyxl.Workbook()
        workbook.remove(workbook.active)
        for source_sheet in self.source:
            sheet = workbook.create_sheet(source_sheet.title)
            for row in source_sheet.iter_rows(min_row=1, max_row=19, max_col=18):
                for cell in row:
                    if cell.value is not None:
                        sheet[cell.coordinate] = cell.value
        edit(workbook)
        directory = tempfile.TemporaryDirectory(prefix="bank-import-tests-")
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "fixture.xlsx"
        workbook.save(path)
        workbook.close()
        return path

    def assert_invalid(self, edit, message):
        path = self.temporary_workbook(edit)
        with self.assertRaisesRegex(importer.ImportValidationError, message):
            importer.import_workbook(path)

    def test_static_json_matches_import_exactly_except_timestamp(self):
        payload = dict(self.payload)
        payload["source"] = dict(payload["source"])
        payload["source"]["importedAt"] = self.json_payload["source"]["importedAt"]
        self.assertEqual(self.json_payload, payload)

    def test_all_700_required_numbers_and_additional_international_value_match_source(self):
        direct = ratios = international = required = 0
        for bank in self.json_payload["banks"]:
            sheet = self.source[bank["sourceSheet"]]
            self.assertEqual(bank["symbol"], str(sheet["B11"].value))
            self.assertEqual(bank["name"], self.names[bank["symbol"]])
            self.assertEqual(bank["fullName"], sheet["A3"].value)
            for record in bank["years"]:
                row = record["year"] - 2018
                self.assertEqual(str(sheet[f"B{row}"].value), str(record["year"]))
                self.assertEqual(sheet[f"C{row}"].value, "FY")
                self.assertEqual(set(record["values"]), EXPECTED_KEYS)
                self.assertEqual(set(record["cells"]), EXPECTED_KEYS)
                for metric, column in DIRECT_COLUMNS.items():
                    if metric == "pe" and bank["symbol"] == "1180":
                        column = "R"
                    coordinate = f"{column}{row}"
                    self.assertEqual(record["values"][metric], sheet[coordinate].value, (bank["symbol"], record["year"], metric))
                    self.assertEqual(record["cells"][metric], coordinate)
                    direct += 1
                    required += 1
                for metric, numerator, denominator, column in (
                    ("loansToDeposits", "E", "F", "M"),
                    ("returnOnEquity", "J", "G", "N"),
                ):
                    expected = sheet[f"{numerator}{row}"].value / sheet[f"{denominator}{row}"].value
                    self.assertEqual(record["values"][metric], expected, (bank["symbol"], record["year"], metric))
                    self.assertEqual(record["cells"][metric], f"{column}{row}")
                    ratios += 1
                    required += 1
                value = record["values"]["internationalFinancingShare"]
                cell = record["cells"]["internationalFinancingShare"]
                if bank["symbol"] == "1180":
                    self.assertEqual(cell, f"Q{row}")
                    self.assertEqual(value, sheet[cell].value)
                    if record["year"] == 2025:
                        self.assertEqual(value, 0.0328)
                        international += 1
                    else:
                        self.assertIsNone(value)
                else:
                    self.assertIsNone(value)
                    self.assertIsNone(cell)
                for metric in ("provisions", "averageShares", "recurringEps"):
                    self.assertIsNone(record["values"][metric])
                    self.assertIsNone(record["cells"][metric])
        self.assertEqual((required, direct, ratios, international), (700, 600, 100, 1))
        print("\nAUDIT: 700/700 required numeric matches; 600 direct + 100 divisions; 1/1 international match.", flush=True)

    def test_counts_missing_values_provenance_and_exclusions(self):
        self.assertEqual(self.report, {
            "banks": 10, "records": 50, "requiredNumericValues": 700,
            "numericValues": 701, "nullValues": 199, "recalculatedFormulas": 100,
            "excludedFYRows": 10, "excludedNonFYRows": 0,
            "excludedSheets": ["الودائع تحت الطلب"],
        })
        source = self.json_payload["source"]
        self.assertEqual(source["type"], "user_workbook")
        self.assertEqual(source["fileName"], WORKBOOK_PATH.name)
        self.assertEqual(source["sha256"], self.source_hash)
        self.assertRegex(source["importedAt"], r"^\d{4}-\d{2}-\d{2}T.*Z$")
        self.assertEqual(source["note"], "القيم كما وردت في ملف المستخدم؛ لم تُراجع بمصدر خارجي.")
        nulls = Counter(metric for bank in self.json_payload["banks"] for record in bank["years"] for metric, value in record["values"].items() if value is None)
        self.assertEqual(dict(nulls), {"internationalFinancingShare": 49, "provisions": 50, "averageShares": 50, "recurringEps": 50})
        self.assertEqual(self.json_payload["years"], [2021, 2022, 2023, 2024, 2025])
        self.assertEqual(self.json_payload["schemaVersion"], 1)
        for bank in self.json_payload["banks"]:
            self.assertEqual([r["year"] for r in bank["years"]], [2021, 2022, 2023, 2024, 2025])

    def test_pinned_alrajhi_values_and_fractional_ratios_are_not_corrected(self):
        bank = next(bank for bank in self.json_payload["banks"] if bank["symbol"] == "1120")
        by_year = {record["year"]: record["values"] for record in bank["years"]}
        self.assertEqual((by_year[2024]["netProfit"], by_year[2024]["eps"]), (19731, 4.93))
        self.assertEqual((by_year[2025]["netProfit"], by_year[2025]["eps"]), (24792, 6.2))
        self.assertEqual(by_year[2025]["retailFinancingShare"], 0.6404)
        self.assertEqual(by_year[2025]["returnOnEquity"], 24792 / 114000)
        # Cached figures in the original file are rounded; don't use them.
        cached = openpyxl.load_workbook(WORKBOOK_PATH, data_only=True)
        self.addCleanup(cached.close)
        self.assertNotEqual(by_year[2025]["returnOnEquity"], cached[bank["sourceSheet"]]["N7"].value)

    def test_parenthesized_formula_is_supported(self):
        bank = next(bank for bank in self.json_payload["banks"] if bank["symbol"] == "1050")
        self.assertEqual(self.source[bank["sourceSheet"]]["M3"].value, "=(E3/F3)")
        self.assertEqual(bank["years"][0]["values"]["loansToDeposits"], 147812 / 141950)

    def test_shuffled_columns_are_read_by_headers(self):
        def swap(workbook):
            sheet = workbook["الأهلي"]
            for row in range(1, 8):
                sheet[f"D{row}"].value, sheet[f"E{row}"].value = sheet[f"E{row}"].value, sheet[f"D{row}"].value
                sheet[f"Q{row}"].value, sheet[f"R{row}"].value = sheet[f"R{row}"].value, sheet[f"Q{row}"].value
                if row > 1:
                    sheet[f"M{row}"] = f"=(D{row}/F{row})"
        payload, _ = importer.import_workbook(self.temporary_workbook(swap))
        actual = next(bank for bank in payload["banks"] if bank["symbol"] == "1180")
        expected = next(bank for bank in self.payload["banks"] if bank["symbol"] == "1180")
        for got, want in zip(actual["years"], expected["years"]):
            self.assertEqual(got["values"], want["values"])
            row = got["year"] - 2018
            self.assertEqual(got["cells"]["assets"], f"E{row}")
            self.assertEqual(got["cells"]["financing"], f"D{row}")
            self.assertEqual(got["cells"]["pe"], f"Q{row}")
            self.assertEqual(got["cells"]["internationalFinancingShare"], f"R{row}")

    def test_quarter_rows_and_current_share_figures_are_ignored(self):
        def edit(workbook):
            sheet = workbook["الأهلي"]
            sheet["B20"] = 2025
            sheet["C20"] = "Q4"
            sheet["J20"] = 999999
            sheet["B13"] = 123456789
            sheet["B15"] = '=GOOGLEFINANCE("Tadawul:1180", "price")'
        payload, report = importer.import_workbook(self.temporary_workbook(edit))
        self.assertEqual(payload["banks"], self.payload["banks"])
        self.assertEqual(report["excludedNonFYRows"], 1)

    def test_duplicate_year_is_rejected(self):
        self.assert_invalid(lambda workbook: setattr(workbook["الأهلي"]["B4"], "value", 2021), "مكررة")

    def test_missing_year_is_rejected(self):
        self.assert_invalid(lambda workbook: setattr(workbook["الأهلي"]["C4"], "value", "Q4"), "مفقودة")

    def test_missing_bank_is_rejected(self):
        self.assert_invalid(lambda workbook: workbook.remove(workbook["الأهلي"]), "بنوك مطلوبة مفقودة")

    def test_duplicate_symbol_is_rejected(self):
        self.assert_invalid(lambda workbook: setattr(workbook["الأهلي"]["B11"], "value", "1120"), "رمز بنك مكرر")

    def test_unmatched_symbol_is_rejected(self):
        self.assert_invalid(lambda workbook: setattr(workbook["الأهلي"]["B11"], "value", "9999"), "غير مطابق")

    def test_missing_required_numeric_is_rejected(self):
        self.assert_invalid(lambda workbook: setattr(workbook["الأهلي"]["J7"], "value", None), "قيمة رقمية مطلوبة")

    def test_non_numeric_and_bool_are_rejected(self):
        for value in ("25013", True):
            with self.subTest(value=value):
                self.assert_invalid(lambda workbook: setattr(workbook["الأهلي"]["J7"], "value", value), "قيمة رقمية مطلوبة")

    def test_missing_required_header_is_rejected(self):
        self.assert_invalid(lambda workbook: setattr(workbook["الأهلي"]["R1"], "value", None), "رأس عمود مطلوب مفقود")

    def test_unsupported_formula_is_rejected_without_evaluation(self):
        for formula in ('=GOOGLEFINANCE("Tadawul:1180", "price")', "=E7/F6", "=SUM(E7)/F7"):
            with self.subTest(formula=formula):
                self.assert_invalid(lambda workbook: setattr(workbook["الأهلي"]["M7"], "value", formula), "صيغة غير مسموحة")

    def test_divide_by_zero_does_not_write_an_incomplete_payload(self):
        self.assert_invalid(lambda workbook: setattr(workbook["الأهلي"]["F7"], "value", 0), "قسمة غير صالحة")
        for operands in ((1, 0), (None, 1), (1, None), (float("nan"), 1), (1, float("inf"))):
            self.assertIsNone(importer.safe_divide(*operands))
        self.assertEqual(importer.safe_divide(1, 5), 0.2)

    def test_cli_optional_output_and_source_immutability(self):
        with tempfile.TemporaryDirectory(prefix="bank-cli-tests-") as directory:
            path = Path(directory) / "banks.json"
            result = subprocess.run([sys.executable, str(ROOT / "scripts" / "import-bank-workbook.py"), str(WORKBOOK_PATH), "--output", str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["requiredNumericValues"], 700)
            with path.open(encoding="utf-8") as handle:
                self.assertEqual(json.load(handle)["banks"], self.payload["banks"])
            self.assertEqual(hashlib.sha256(WORKBOOK_PATH.read_bytes()).hexdigest(), self.source_hash)

    def test_source_and_site_data_cannot_be_overwritten(self):
        for path in (WORKBOOK_PATH, ROOT / "dist" / "data.json"):
            with self.assertRaisesRegex(importer.ImportValidationError, "لا يجوز الكتابة فوق"):
                importer.write_payload(self.payload, path, WORKBOOK_PATH)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="اختبارات محوّل بيانات البنوك، دون تعديل ملف المستخدم")
    parser.add_argument("--input", type=Path, default=WORKBOOK_PATH)
    args, remaining = parser.parse_known_args()
    WORKBOOK_PATH = args.input
    unittest.main(argv=[sys.argv[0], *remaining], verbosity=2)
