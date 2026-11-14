#!/usr/bin/env python3
"""Build dist/company-profiles.json from the sector workbooks «تواريخ التأسيس والإدراج».

Usage: python3 scripts/import-company-profiles.py <folder-with-xlsx-files>

Each workbook has one sheet per company, either as a row table headed by «رمز السهم»
or as a vertical key/value sheet («رمز الشركة في تداول», «مجال العمل (باختصار)», ...).
Columns are read by header name, so extra columns such as «السوق» are safe.

Listing dates missing from the workbooks are filled from scripts/company-listing-dates.json,
which records the researched date and its source for each symbol.
"""
import glob
import json
import os
import re
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, 'dist', 'company-profiles.json')
OVERRIDES = os.path.join(ROOT, 'scripts', 'company-listing-dates.json')


def iso(value):
    if value is None:
        return None
    if hasattr(value, 'strftime'):
        return value.strftime('%Y-%m-%d')
    match = re.fullmatch(r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})', str(value).strip())
    return f'{match[1]}-{int(match[2]):02d}-{int(match[3]):02d}' if match else None


def records(sheet):
    rows = [row for row in sheet.iter_rows(values_only=True) if any(cell is not None for cell in row)]
    header = next((i for i, row in enumerate(rows) if row[0] == 'رمز السهم'), None)
    if header is not None:
        names = [str(cell).strip() if cell else '' for cell in rows[header]]
        for row in rows[header + 1:]:
            if row[0] is None:
                continue
            item = dict(zip(names, row))
            yield dict(code=item['رمز السهم'], activity=item.get('مجال عمل الشركة'),
                       founded=item.get('تاريخ التأسيس'), listed=item.get('تاريخ الإدراج'),
                       market=item.get('السوق'))
    else:
        item = {str(row[0]).strip(): row[1] for row in rows if row[0]}
        yield dict(code=item.get('رمز الشركة في تداول'), activity=item.get('مجال العمل (باختصار)'),
                   founded=item.get('تاريخ التأسيس'), listed=item.get('تاريخ الإدراج'),
                   official=item.get('الاسم الرسمي الكامل'))


def main(folder):
    profiles = {}
    for path in sorted(glob.glob(os.path.join(folder, '*.xlsx'))):
        for sheet in openpyxl.load_workbook(path, data_only=True).worksheets:
            for item in records(sheet):
                code = str(item['code']).strip()
                if not re.fullmatch(r'\d{4}', code):
                    raise SystemExit(f'Invalid symbol {code!r} in {path} / {sheet.title}')
                profile = {'activity': ' '.join(str(item['activity'] or '').split()),
                           'founded': iso(item['founded']), 'listed': iso(item['listed'])}
                if not profile['activity'] or not profile['founded']:
                    raise SystemExit(f'Missing activity or founding date for {code} in {path}')
                if item.get('market'):
                    profile['market'] = str(item['market']).strip()
                if item.get('official'):
                    profile['official'] = str(item['official']).strip()
                profiles[code] = profile

    overrides = json.load(open(OVERRIDES, encoding='utf-8')) if os.path.exists(OVERRIDES) else {}
    for code, entry in overrides.get('symbols', {}).items():
        # The researched entry wins even after its date is copied into the workbook, so the source stays attached.
        if code in profiles and entry.get('listed'):
            profiles[code]['listed'] = entry['listed']
            profiles[code]['listedSource'] = entry['source']
            if entry.get('precision') == 'month':
                profiles[code]['listedPrecision'] = 'month'

    for code, profile in profiles.items():
        if profile['listed'] and profile['listed'] < profile['founded']:
            raise SystemExit(f'Listing date before founding date for {code}')

    with open(OUTPUT, 'w', encoding='utf-8') as handle:
        json.dump(dict(sorted(profiles.items())), handle, ensure_ascii=False, separators=(',', ':'))
    missing = sorted(code for code, profile in profiles.items() if not profile['listed'])
    print(f'{len(profiles)} profiles written to {os.path.relpath(OUTPUT, ROOT)}; listing date missing for {len(missing)}: {" ".join(missing)}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
