#!/usr/bin/env python3
"""
جلب إعلانات الشركات من تداول السعودية لآخر ثلاثة أشهر وتصديرها إلى Excel.

كل ملف Excel يمثل قطاعاً واحداً، وكل شركة داخل القطاع لها ورقة مستقلة.
مصدر قائمة القطاعات والشركات: dist/data.json في مشروع السوق السعودي.

التثبيت:
    python3 -m pip install openpyxl playwright

أمثلة:
    python3 tadawul_announcements_excel.py --list-sectors
    python3 tadawul_announcements_excel.py --sector "الصناعات التحويلية"
    python3 tadawul_announcements_excel.py --all
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
except ImportError:
    print("المكتبة ناقصة. نفّذ: python3 -m pip install openpyxl playwright", file=sys.stderr)
    raise
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("المكتبة ناقصة. نفّذ: python3 -m pip install playwright", file=sys.stderr)
    raise

LANDING_URL = (
    "https://www.saudiexchange.sa/wps/portal/saudiexchange/"
    "newsandreports/issuer-news/issuer-announcements?locale=ar"
)
PAGE_SIZE = 10
MAX_PAGES = 12
DEFAULT_DELAY = (3.0, 6.0)
ENDPOINT_PATH = ("p0/IZ7_5A602H80O0HTC060SG6UT81DI1="
                 "CZ6_5A602H80O0HTC060SG6UT81D26=NJgetAnnouncementListData=/")


class TadawulBlocked(RuntimeError):
    pass


def clean_filename(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '-', value).strip().rstrip('.')
    return value or "قطاع غير مسمى"


def clean_sheet_name(value: str, symbol: str, used: set[str]) -> str:
    name = re.sub(r'[\\/*?:\[\]]', '-', value).strip() or symbol
    name = name[:31]
    if name in used:
        suffix = f"-{symbol}"
        name = (name[: 31 - len(suffix)] + suffix)[:31]
    used.add(name)
    return name


def month_delta(d: date, months: int) -> date:
    # آخر ثلاثة أشهر: من نفس اليوم قبل ثلاثة أشهر، مع معالجة نهاية الشهر.
    month = d.month - months
    year = d.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    import calendar
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def date_range(months: int) -> tuple[date, date]:
    end = date.today()
    return month_delta(end, months), end


def tadawul_date(d: date) -> str:
    return d.strftime("%m/%d/%Y")


def parse_news_date(value: str) -> date | None:
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})", str(value or ""))
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None


def load_sectors(data_file: Path) -> dict[str, list[dict[str, str]]]:
    if not data_file.exists():
        raise FileNotFoundError(
            f"لم أجد ملف الشركات: {data_file}\n"
            "شغّل السكربت من مجلد المشروع أو استخدم --data-file /path/to/dist/data.json"
        )
    raw = json.loads(data_file.read_text(encoding="utf-8"))
    sectors: dict[str, list[dict[str, str]]] = {}
    for sector in raw.get("sectors", []):
        sectors[sector["name"]] = [
            {"name": str(stock.get("name", stock["symbol"])), "symbol": str(stock["symbol"])}
            for stock in sector.get("stocks", [])
        ]
    return sectors


def create_browser(playwright):
    profile = str(Path("browser_profile").absolute())
    try:
        context = playwright.chromium.launch_persistent_context(
            profile, headless=False, locale="ar-SA", channel="chrome",
            args=["--start-maximized"], viewport=None,
        )
    except Exception:
        # إذا لم يجد Playwright نسخة Chrome المثبتة، يستخدم Chromium الخاص به.
        context = playwright.chromium.launch_persistent_context(
            profile, headless=False, locale="ar-SA", args=["--start-maximized"], viewport=None,
        )
    page = context.pages[0] if context.pages else context.new_page()
    page.goto(LANDING_URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3500)
    body = page.inner_text("body").lower()
    markers = ["verify you are human", "just a moment", "لست روبوت", "security check"]
    if any(marker in body for marker in markers):
        print("\n⚠ ظهرت نافذة تحقق من تداول. حل التحقق في Chrome ثم اضغط Enter هنا للمتابعة.")
        input()
    base = page.locator("base").first.get_attribute("href") if page.locator("base").count() else page.url
    endpoint = urljoin(base, ENDPOINT_PATH)
    return context, page, endpoint


def normalise(item: dict) -> dict:
    raw_url = str(item.get("announcementUrl", ""))
    url = urljoin("https://www.saudiexchange.sa", raw_url)
    url = re.sub(r"locale=(?:en|ar)", "locale=ar", url)
    if "locale=" not in url:
        url += "&locale=ar" if "?" in url else "?locale=ar"
    return {
        "id": str(item.get("PRESS_REL_ID") or item.get("announcementNumber") or ""),
        "symbol": str(item.get("SYMBOL") or item.get("indexSymbol") or ""),
        "date": str(item.get("newsDateStr") or item.get("PR_DATE") or "").strip().split(" ")[0],
        "title": re.sub(r"\s+", " ", str(item.get("SHORT_DESC") or item.get("TITLE") or "")).strip(),
        "body": "",
        "url": url,
    }


def fetch_detail(detail_page, item: dict) -> dict:
    """يقرأ العنوان والفقرات وجدول التوضيح من صفحة الإعلان العربية."""
    detail_page.goto(item["url"], wait_until="domcontentloaded", timeout=60000)
    detail_page.wait_for_timeout(700)
    result = detail_page.evaluate("""
      () => {
        const root = document.querySelector('.article_body');
        const title = [...document.querySelectorAll('h3')]
          .map(node => node.innerText.trim())
          .find(text => text.length > 15 && !/تسجيل الدخول|الإعلانات السابقة|Forgot Password|أهلا بك|أدخل رمز التحقق/.test(text)) || '';
        if (!root) return {title, body: ''};
        const parts = [];
        root.querySelectorAll('tbody tr').forEach(row => {
          const cells = [...row.querySelectorAll('td')].map(cell => cell.innerText.trim()).filter(Boolean);
          if (cells.length) parts.push(cells.join(': '));
        });
        root.querySelectorAll(':scope > p').forEach(p => {
          if (p.querySelector('table')) return;
          const text = p.innerText.trim();
          if (text) parts.push(text);
        });
        return {title, body: [...new Set(parts)].join('\\n\\n')};
      }
    """)
    if result.get("title"):
        item["title"] = re.sub(r"\s+", " ", result["title"]).strip()
    if result.get("body"):
        item["body"] = re.sub(r"[ \t]+", " ", result["body"]).strip()
    return item


def fetch_company(page, detail_page, endpoint: str, symbol: str, start: date, end: date, delay: tuple[float, float]) -> list[dict]:
    collected: list[dict] = []
    total = 0
    for page_number in range(1, MAX_PAGES + 1):
        payload = {
            "locale": "ar", "annoucmentType": "1_-1", "symbol": symbol,
            "sectorDpId": "-1", "searchType": "1", "fromDate": tadawul_date(start),
            "toDate": tadawul_date(end), "datePeriod": "", "productType": "MAIN_MARKET",
            "advisorsList": "-1", "textSearch": "", "pageNumberDb": str(page_number),
            "pageSize": str(PAGE_SIZE),
        }
        result = page.evaluate("""
            async ({endpoint, payload}) => {
              const body = new URLSearchParams(payload).toString();
              const response = await fetch(endpoint, {
                method: 'POST', credentials: 'include',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                  'X-Requested-With': 'XMLHttpRequest'
                }, body
              });
              return {status: response.status, text: await response.text()};
            }
        """, {"endpoint": endpoint, "payload": payload})
        text = str(result.get("text", "")).lstrip()
        if result.get("status") in (403, 429) or not text.startswith("{"):
            raise TadawulBlocked(f"حظر عند الشركة {symbol}: HTTP {result.get('status')}")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise TadawulBlocked(f"استجابة غير صالحة من تداول للشركة {symbol}") from exc
        items = data.get("announcementList") or []
        total = int(data.get("totalCount") or (items[0].get("totalCount", 0) if items else 0) or 0)
        collected.extend(normalise(item) for item in items)
        if not items or len(collected) >= total or len(items) < PAGE_SIZE:
            break
        time.sleep(random.uniform(*delay))
    unique = {item["id"]: item for item in collected if item["id"]}
    enriched = []
    for item in unique.values():
        try:
            enriched.append(fetch_detail(detail_page, item))
        except Exception as exc:
            print(f"    ⚠ تعذر قراءة تفاصيل الإعلان {item['id']}: {exc}")
            enriched.append(item)
        time.sleep(random.uniform(max(0.8, delay[0] / 2), max(1.2, delay[1] / 2)))
    return enriched


def cache_path(output_dir: Path, sector: str) -> Path:
    return output_dir / f".{clean_filename(sector)} - cache.json"


def load_cache(path: Path) -> dict[str, list[dict]]:
    try:
        cache = json.loads(path.read_text(encoding="utf-8"))
        for items in cache.values():
            for item in items:
                item.setdefault("title", item.get("text", ""))
                item.setdefault("body", "")
        return cache
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cache(path: Path, cache: dict[str, list[dict]]) -> None:
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def style_sheet(ws, company: dict, announcements: list[dict], start: date, end: date) -> None:
    ws.sheet_view.rightToLeft = True
    ws.freeze_panes = "A5"
    ws.merge_cells("A1:D1")
    ws["A1"] = f"{company['name']} ({company['symbol']}) — إعلانات تداول السعودية"
    ws["A1"].font = Font(bold=True, size=14, color="FFFFFF")
    ws["A1"].fill = PatternFill("solid", fgColor="17365D")
    ws["A1"].alignment = Alignment(horizontal="right")
    ws.merge_cells("A2:D2")
    ws["A2"] = f"الفترة: من {start.strftime('%d/%m/%Y')} إلى {end.strftime('%d/%m/%Y')} | المصدر: تداول السعودية"
    ws["A2"].font = Font(italic=True, color="666666")
    ws["A2"].alignment = Alignment(horizontal="right")
    ws.merge_cells("A3:D3")
    ws["A3"] = f"عدد الإعلانات: {len(announcements)}"
    ws["A3"].alignment = Alignment(horizontal="right")
    headers = ["التاريخ الميلادي", "عنوان الإعلان", "فحوى الإعلان الكامل", "الرابط المرجعي في تداول"]
    for col, value in enumerate(headers, 1):
        cell = ws.cell(4, col, value)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="4472C4")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for row, item in enumerate(announcements, 5):
        values = [item["date"], item.get("title", ""), item.get("body", "") or item.get("title", ""), "فتح الإعلان"]
        for col, value in enumerate(values, 1):
            cell = ws.cell(row, col, value)
            cell.alignment = Alignment(horizontal="right", vertical="top", wrap_text=col == 3)
            if col == 4:
                cell.hyperlink = item["url"]
                cell.font = Font(color="0563C1", underline="single")
    thin = Side(style="thin", color="D9E2F3")
    for row in ws.iter_rows(min_row=4, max_row=max(4, 4 + len(announcements)), min_col=1, max_col=4):
        for cell in row:
            cell.border = Border(bottom=thin)
    widths = {"A": 18, "B": 55, "C": 110, "D": 24}
    for col, width in widths.items():
        ws.column_dimensions[col].width = width
    ws.row_dimensions[1].height = 26
    ws.row_dimensions[4].height = 32
    ws.auto_filter.ref = f"A4:D{max(4, 4 + len(announcements))}"


def write_workbook(sector: str, companies: list[dict], cache: dict, output_dir: Path, start: date, end: date) -> Path:
    workbook = Workbook()
    workbook.remove(workbook.active)
    used: set[str] = set()
    for company in companies:
        title = clean_sheet_name(company["name"], company["symbol"], used)
        ws = workbook.create_sheet(title)
        announcements = sorted(cache.get(company["symbol"], []), key=lambda x: x.get("date", ""), reverse=True)
        style_sheet(ws, company, announcements, start, end)
    if not workbook.sheetnames:
        workbook.create_sheet("لا توجد بيانات")
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{clean_filename(sector)} - إعلانات آخر 3 أشهر.xlsx"
    workbook.save(output)
    return output


def run_sector(sector: str, companies: list[dict], args: argparse.Namespace, page, detail_page, endpoint) -> None:
    start, end = date_range(args.months)
    output_dir = Path(args.output_dir)
    cache_file = cache_path(output_dir, sector)
    cache = load_cache(cache_file)
    print(f"\n===== {sector} | {len(companies)} شركة | آخر {args.months} أشهر =====")
    try:
        for index, company in enumerate(companies, 1):
            print(f"[{index}/{len(companies)}] {company['name']} ({company['symbol']}) ...", flush=True)
            try:
                items = fetch_company(page, detail_page, endpoint, company["symbol"], start, end, (args.delay_min, args.delay_max))
                cache[company["symbol"]] = items
                print(f"    ✓ {len(items)} إعلان")
                save_cache(cache_file, cache)
            except TadawulBlocked as exc:
                print(f"    ⚠ توقّف آمن: {exc}")
                break
            except Exception as exc:
                print(f"    ⚠ تعذر الجلب: {exc}")
            time.sleep(random.uniform(args.delay_min, args.delay_max))
    finally:
        output = write_workbook(sector, companies, cache, output_dir, start, end)
        print(f"✔ تم حفظ: {output}")
        print(f"   الاستكمال لاحقاً يعيد استخدام: {cache_file}")


def main() -> None:
    parser = argparse.ArgumentParser(description="تصدير إعلانات تداول لآخر ثلاثة أشهر إلى Excel")
    parser.add_argument("--sector", help="اسم قطاع واحد كما يظهر في --list-sectors")
    parser.add_argument("--all", action="store_true", help="تشغيل جميع القطاعات بالتتابع")
    parser.add_argument("--list-sectors", action="store_true", help="عرض أسماء القطاعات")
    parser.add_argument("--months", type=int, default=3, help="عدد الأشهر السابقة (الافتراضي 3)")
    parser.add_argument("--data-file", default="dist/data.json", help="مسار ملف بيانات الشركات")
    parser.add_argument("--output-dir", default="tadawul_announcements", help="مجلد ملفات Excel")
    parser.add_argument("--delay-min", type=float, default=DEFAULT_DELAY[0])
    parser.add_argument("--delay-max", type=float, default=DEFAULT_DELAY[1])
    args = parser.parse_args()
    sectors = load_sectors(Path(args.data_file))
    if args.list_sectors:
        print("\n".join(sectors))
        return
    if not args.sector and not args.all:
        parser.error("استخدم --sector 'اسم القطاع' أو --all")
    selected = list(sectors.items()) if args.all else [(args.sector, sectors.get(args.sector, []))]
    if not selected[0][1]:
        raise SystemExit(f"القطاع غير موجود أو لا يحتوي شركات. استخدم --list-sectors")
    with sync_playwright() as playwright:
        try:
            context, page, endpoint = create_browser(playwright)
            detail_page = context.new_page()
        except Exception as exc:
            raise SystemExit(f"تعذر تشغيل Chrome أو فتح تداول: {exc}") from exc
        try:
            for sector, companies in selected:
                run_sector(sector, companies, args, page, detail_page, endpoint)
                if args.all:
                    time.sleep(random.uniform(10, 20))
        finally:
            context.close()


if __name__ == "__main__":
    main()
