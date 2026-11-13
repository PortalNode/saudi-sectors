#!/usr/bin/env python3
"""Switch a sector results page to the shared page module with the period selector.

Usage:
    python3 scripts/enable-quarterly-page.py <slug>

Rewrites dist/<slug>.js to call initSectorResultsPage (keeping the page's own metrics
and charts modules) and, in dist/<slug>.html, links quarterly-periods.css and bumps
the script/layout cache versions. Safe to run again: an already converted page is
only re-versioned. Run scripts/import-quarterly-workbook.py first so that
dist/<slug>-quarterly-financials.json exists.
"""
import argparse, re, sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SHARED_VERSION = "quarterly-20261113"
LAYOUT_VERSION = "20261113-periods"

def fail(message): sys.exit(f"خطأ: {message}")

def convert_script(slug, source):
    if "initSectorResultsPage" in source:
        metrics = re.search(r"import \* as metrics from '([^']+)';", source)
        charts = re.search(r"import \{ (render\w+Charts), (fit\w+Charts), getChartOptions \} from '([^']+)';", source)
        sector = re.search(r"sectorName: '([^']+)'", source)
        if not (metrics and charts and sector): fail(f"{slug}.js محوّل لكن شكله غير متوقع")
        return metrics.group(1), charts.group(1), charts.group(2), charts.group(3), sector.group(1)
    metrics = re.search(r"import \{[^}]*\} from '(\./" + re.escape(slug) + r"-metrics\.mjs[^']*)';", source)
    charts = re.search(r"import \{ (render\w+Charts), (fit\w+Charts), getChartOptions \} from '([^']+)';", source)
    sector = re.search(r"· قطاع (.+?) · نتائج سنوية فقط", source)
    for marker in (f"$('{slug}-panel')", f"$('{slug}-table-wrap')", "renderAnnualTable(company", "validateDataset("):
        if marker not in source: fail(f"{slug}.js لا يطابق قالب صفحات القطاعات (لم أجد {marker})")
    if not (metrics and charts and sector): fail(f"لم أستطع قراءة الاستيرادات أو اسم القطاع من {slug}.js")
    return metrics.group(1), charts.group(1), charts.group(2), charts.group(3), sector.group(1)

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("slug")
    slug = parser.parse_args().slug
    js_path, html_path = DIST / f"{slug}.js", DIST / f"{slug}.html"
    if not js_path.exists() or not html_path.exists(): fail(f"لا توجد صفحة {slug}.html / {slug}.js")
    if not (DIST / f"{slug}-quarterly-financials.json").exists(): fail(f"شغّل import-quarterly-workbook.py {slug} أولًا")
    version = f"{slug}-quarterly-{date.today():%Y%m%d}"
    metrics, render, fit, charts_path, sector = convert_script(slug, js_path.read_text(encoding="utf-8"))
    js_path.write_text(
        "// Page logic lives in sector-results-page.mjs (shared by all sector pages).\n"
        f"import * as metrics from '{metrics}';\n"
        f"import {{ {render}, {fit}, getChartOptions }} from '{charts_path}';\n"
        f"import {{ initSectorResultsPage }} from './sector-results-page.mjs?v={SHARED_VERSION}';\n"
        f"initSectorResultsPage({{ slug: '{slug}', sectorName: '{sector}', metrics, charts: {{ render: {render}, fit: {fit}, options: getChartOptions }}, version: '{version}' }});\n",
        encoding="utf-8")
    html = html_path.read_text(encoding="utf-8")
    css_link = f'<link rel="stylesheet" href="quarterly-periods.css?v={SHARED_VERSION}">'
    if "quarterly-periods.css" in html:
        html = re.sub(r'<link rel="stylesheet" href="quarterly-periods\.css[^"]*">', css_link, html)
    else:
        anchor = re.search(r'\s*<link rel="stylesheet" href="layout\.css[^"]*">', html)
        if not anchor: fail(f"لم أجد رابط layout.css في {slug}.html")
        html = html[:anchor.start()] + "\n  " + css_link + html[anchor.start():]
    html, count = re.subn(rf'src="{re.escape(slug)}\.js\?v=[^"]*"', f'src="{slug}.js?v={version}"', html)
    if count != 1: fail(f"لم أجد وسم {slug}.js في {slug}.html")
    html = re.sub(r'src="layout\.js\?v=[^"]*"', f'src="layout.js?v={LAYOUT_VERSION}"', html)
    html = re.sub(r"(<title>[^<]*?) \d{4}–\d{4}( \|)", r"\1\2", html)
    html_path.write_text(html, encoding="utf-8")
    print(f"تم ربط صفحة {slug} (قطاع {sector}) بشريط الفترات · الإصدار {version}")

if __name__ == "__main__":
    main()
