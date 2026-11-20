#!/usr/bin/env python3
"""Build dist/announcements/<symbol>.json from the sector workbooks «<القطاع> - إعلانات آخر 3 أشهر.xlsx».

Usage: python3 scripts/import-announcements-workbook.py <folder-with-xlsx-files>

Each workbook has one sheet per company. A1 reads «الاسم (الرمز) — إعلانات تداول السعودية»; the table
header (row 4) is «التاريخ الميلادي | عنوان الإعلان | فحوى الإعلان الكامل | الرابط المرجعي في تداول»,
and the link cell carries the Tadawul URL whose anId is the announcement id.

Writes one file per company that has announcements, plus latest.json (newest 100 across the market).
Existing items (for example ones the automatic updater added later) are kept; ids are never duplicated.
"""
import glob
import json
import os
import re
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'dist', 'announcements')
SYMBOL = re.compile(r'\((\d{4})\)')
AN_ID = re.compile(r'anId=(\d+)')
DMY = re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?')


def iso(value):
    """'26/10/2026' or '26/10/2026 19:30' -> '2026-10-26' / '2026-10-26T19:30'."""
    if hasattr(value, 'strftime'):
        return value.strftime('%Y-%m-%d')
    match = DMY.match(str(value or '').strip())
    if not match:
        return None
    day, month, year, hour, minute = match.groups()
    out = f'{year}-{int(month):02d}-{int(day):02d}'
    return f'{out}T{int(hour):02d}:{minute}' if hour else out


def sheet_items(sheet):
    symbol = SYMBOL.search(str(sheet.cell(1, 1).value or ''))
    if not symbol:
        return None, []
    items = []
    for row in sheet.iter_rows(min_row=5):
        date = iso(row[0].value)
        title = str(row[1].value or '').strip()
        link = row[3].hyperlink.target if len(row) > 3 and row[3].hyperlink else None
        found = AN_ID.search(link or '')
        if not date or not title or not found:
            continue
        items.append({
            'id': found.group(1),
            't': date,
            'title': title,
            'body': str(row[2].value or '').strip(),
            'url': link,
        })
    return symbol.group(1), items


def newest_first(items):
    return sorted(items, key=lambda item: (item['t'][:10], int(item['id'])), reverse=True)


def main(folder):
    files = sorted(glob.glob(os.path.join(folder, '*.xlsx')))
    if not files:
        sys.exit(f'no .xlsx files in {folder}')
    os.makedirs(OUT, exist_ok=True)
    by_symbol = {}
    for path in files:
        workbook = openpyxl.load_workbook(path)
        for sheet in workbook.worksheets:
            symbol, items = sheet_items(sheet)
            if symbol and items:
                by_symbol.setdefault(symbol, []).extend(items)

    written, total, market = 0, 0, []
    for symbol, items in sorted(by_symbol.items()):
        target = os.path.join(OUT, f'{symbol}.json')
        known = {}
        if os.path.exists(target):
            with open(target, encoding='utf-8') as handle:
                known = {item['id']: item for item in json.load(handle).get('items', [])}
        for item in items:
            known.setdefault(item['id'], item)
        merged = newest_first(list(known.values()))
        newest = merged[0]['t'][:10]
        with open(target, 'w', encoding='utf-8') as handle:
            json.dump({'symbol': symbol, 'updated': newest, 'items': merged}, handle, ensure_ascii=False, separators=(',', ':'))
        written += 1
        total += len(merged)
        market.extend({'symbol': symbol, **{k: v for k, v in item.items() if k != 'body'}} for item in merged)

    market = sorted(market, key=lambda item: (item['t'][:10], int(item['id'])), reverse=True)[:100]
    with open(os.path.join(OUT, 'latest.json'), 'w', encoding='utf-8') as handle:
        json.dump({'items': market}, handle, ensure_ascii=False, separators=(',', ':'))
    print(f'{written} companies, {total} announcements -> {OUT}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
