#!/usr/bin/env python3
"""
يجلب من موقع تداول (السوق المالية السعودية) لكل شركة في الموقع:
  1) قائمة ملفات XBRL الرسمية (سنوي + أرباع) وينزّل المطلوب منها،
  2) جداول الملخص في صفحة الشركة (إجمالي الموجودات والمطلوبات وحقوق الملكية والتدفقات والنقد)
     لاستخدامها في التحقق من الأرقام.
لا يكتب شيئًا في المستودع: كل شيء في مجلد الذاكرة المؤقتة (CACHE). بعده شغّل build-statements.py.

التشغيل (يحتاج playwright و beautifulsoup4):
    python3 scripts/fetch-statements.py              # كل الشركات
    python3 scripts/fetch-statements.py 3092 2280    # شركات محددة
    python3 scripts/fetch-statements.py --sector cement
"""
import json
import os
import re
import sys
import time
import atexit
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
CACHE = Path(os.environ.get("STATEMENTS_CACHE", Path.home() / ".cache" / "saudi-statements"))
XBRL_DIR = CACHE / "xbrl"
PAGES_DIR = CACHE / "pages"
# ملفات XBRL منزّلة سابقًا (تُقرأ فقط إن وُجدت)
OLD_CACHES = [Path.home() / "Desktop" / "sector_scripts" / "xbrl_cache"]

SITE = "https://www.saudiexchange.sa"
PROFILE_URL = (SITE + "/wps/portal/saudiexchange/hidden/company-profile-main/!ut/p/z1/"
               "04_Sj9CPykssy0xPLMnMz0vMAfIjo8ziTR3NDIw8LAz83d2MXA0C3SydAl1c3Q0NvE30I4EKzBEKDMKcTQzMDPxN3H19LAzdTU31w8syU8v1wwkpK8hOMgUA-oskdg!!/"
               "?companySymbol={sym}")
DELAY = 1.5
QUARTER_ROWS = {"الربع الأول": 1, "الربع الثاني": 2, "الربع الثالث": 3, "الربع الرابع": 4}

# قائمة ملفات XBRL + جداول الملخص، تُقرأ من صفحة الشركة بعد تحميلها
JS_READ_PAGE = r"""async (sym) => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const tables = [...document.querySelectorAll('table')].map(t => [...t.rows].map(r => [...r.cells].map(c => clean(c.innerText))));
  const summary = tables.filter(rows => rows.length > 3 && /^قائمة (المركز المالي|الدخل|التدفقات النقدية)/.test(rows[0]?.[0] || ''));
  const title = clean(document.querySelector('.company-name, .companyName, h1')?.innerText);
  const h = document.documentElement.innerHTML;
  const m = h.match(/url:'(p0\/[^']*NJstatementsTabData=\/)'/);
  if (!m) return { error: 'NO_URL', summary, title };
  const u = new URL(m[1], document.baseURI).href + '?statementType=6&reportType=0&requestLocale=ar&symbol=' + sym;
  let text;
  try { const r = await fetch(u, { credentials: 'include' }); if (r.status !== 200) return { error: 'HTTP_' + r.status, summary, title }; text = await r.text(); }
  catch (e) { return { error: String(e), summary, title }; }
  const box = document.createElement('div');
  box.innerHTML = text;
  const files = [];
  let years = [];
  for (const tr of box.querySelectorAll('tr')) {
    const cells = [...tr.cells];
    const texts = cells.map(c => clean(c.innerText));
    if (texts.slice(1).some(t => /^\d{4}$/.test(t))) { years = texts.slice(1).map(t => /^\d{4}$/.test(t) ? +t : null); continue; }
    cells.slice(1).forEach((cell, i) => {
      for (const a of cell.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href');
        if (/XBRL_DOCS/.test(href) && /\.html$/i.test(href)) files.push({ row: texts[0], year: years[i] ?? null, url: new URL(href, location.origin).href, posted: texts[i + 1] });
      }
    });
  }
  return { files, summary, title };
}"""

JS_FETCH = """async (u) => {
  try { const r = await fetch(u, {credentials: 'include'}); return [r.status, await r.text()]; }
  catch (e) { return [0, String(e)]; }
}"""

_pw = {"p": None, "browser": None, "page": None, "headless": False}
_last = [0.0]


def close_browser():
    try:
        if _pw["browser"]:
            _pw["browser"].close()
        if _pw["p"]:
            _pw["p"].stop()
    except Exception:
        pass
    _pw.update({"p": None, "browser": None, "page": None})


atexit.register(close_browser)


def page():
    if _pw["page"] is None:
        close_browser()
        p = sync_playwright().start()
        browser = p.chromium.launch(headless=_pw["headless"])
        ctx = browser.new_context(locale="ar-SA", viewport={"width": 1280, "height": 900})
        _pw.update({"p": p, "browser": browser, "page": ctx.new_page()})
    return _pw["page"]


def throttle():
    wait = DELAY - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()


def sector_companies():
    """[(slug, sector, symbol, name)] من ملفات الموقع نفسه."""
    out = []
    for path in sorted(DIST.glob("*-financials.json")):
        if "quarterly" in path.name:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        slug = path.name[: -len("-financials.json")]
        companies = data.get("companies") or data.get("banks") or []
        for c in companies:
            out.append((slug, data.get("sector") or "البنوك", c["symbol"], c["name"]))
    return out


def read_company_page(sym):
    """يفتح صفحة الشركة ويرجع {files, summary, title}؛ يعيد المحاولة حتى 3 مرات."""
    last_error, last = None, {}
    for attempt in range(1, 4):
        throttle()
        try:
            pg = page()
            pg.goto(PROFILE_URL.format(sym=sym), wait_until="domcontentloaded", timeout=90000)
            pg.wait_for_timeout(2500 + 1500 * (attempt - 1))
            res = pg.evaluate(JS_READ_PAGE, sym)
        except Exception as e:
            res = {"error": str(e)}
            _pw["page"] = None
        files = [f for f in res.get("files", []) if f"_{sym}_" in f["url"].rsplit("/", 1)[-1]]
        if res.get("summary"):
            last = res
        if files:
            res["files"] = files
            return res
        last_error = res.get("error") or f"no XBRL files for {sym} (got {len(res.get('files', []))} other)"
        print(f"    محاولة {attempt}: {last_error}", flush=True)
        if "403" in str(last_error) and _pw["headless"]:
            print("    أفتح نافذة متصفح ظاهرة …", flush=True)
            _pw["headless"] = False
            _pw["page"] = None
        time.sleep(3 * attempt)
    # بلا ملفات XBRL: نحتفظ بجداول الملخص إن ظهرت (تكفي للإجماليات)
    return {"error": last_error, "files": [], "summary": last.get("summary", []), "title": last.get("title")}


def cached_xbrl(name):
    for d in [XBRL_DIR, *OLD_CACHES]:
        p = d / name
        if p.exists() and p.stat().st_size > 1000:
            return p
    return None


def download_xbrl(url):
    name = url.rsplit("/", 1)[-1]
    hit = cached_xbrl(name)
    if hit:
        return hit
    for attempt in range(1, 4):
        throttle()
        try:
            status, text = page().evaluate(JS_FETCH, url)
        except Exception as e:
            status, text = 0, str(e)
            _pw["page"] = None
        if status == 200 and len(text) > 1000:
            XBRL_DIR.mkdir(parents=True, exist_ok=True)
            path = XBRL_DIR / name
            path.write_text(text, encoding="utf-8")
            return path
        print(f"    تنزيل {name}: الرد {status} (محاولة {attempt})", flush=True)
        if status == 403 and _pw["headless"]:
            _pw["headless"] = False
            _pw["page"] = None
        time.sleep(3 * attempt)
    return None


def needed(files):
    """كل الملفات السنوية، وملفات الأرباع لآخر سنتين ماليتين (لحساب الربع المنفرد)."""
    years = sorted({f["year"] for f in files if f["year"]})
    recent = set(years[-2:])
    return [f for f in files if f["row"] == "سنوي" or (f["row"] in QUARTER_ROWS and f["year"] in recent)]


def fetch_company(slug, sector, sym, name, force=False):
    out_path = PAGES_DIR / f"{sym}.json"
    if out_path.exists() and not force:
        prev = json.loads(out_path.read_text(encoding="utf-8"))
        if prev.get("files") and all(cached_xbrl(f["file"]) for f in prev["files"] if f.get("file")):
            return prev
    res = read_company_page(sym)
    record = {"symbol": sym, "name": name, "slug": slug, "sector": sector, "pageTitle": res.get("title"),
              "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "error": res.get("error") if not res.get("files") else None,
              "summary": res.get("summary", []), "files": []}
    for f in needed(res.get("files", [])):
        path = download_xbrl(f["url"])
        record["files"].append({**f, "file": path.name if path else None})
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
    return record


def main(argv):
    force = "--force" in argv
    args = [a for a in argv if a != "--force"]
    companies = sector_companies()
    if args and args[0] == "--sector":
        companies = [c for c in companies if c[0] in args[1:]]
    elif args:
        companies = [c for c in companies if c[2] in args]
    print(f"{len(companies)} شركة | الذاكرة المؤقتة: {CACHE}", flush=True)
    failed = []
    for i, (slug, sector, sym, name) in enumerate(companies, 1):
        print(f"[{i}/{len(companies)}] {slug} {sym} {name}", flush=True)
        try:
            rec = fetch_company(slug, sector, sym, name, force)
        except Exception as e:  # شركة واحدة لا توقف الباقي
            print(f"    خطأ: {e}", flush=True)
            failed.append((sym, name, str(e)))
            continue
        missing = [f["url"] for f in rec["files"] if not f.get("file")]
        if rec.get("error") or missing:
            failed.append((sym, name, rec.get("error") or f"{len(missing)} ملفات لم تُنزّل"))
        print(f"    ملفات {len(rec['files'])} | جداول ملخص {len(rec['summary'])}", flush=True)
    print("\nانتهى." + (f" تعذر {len(failed)}:" if failed else " كل الشركات اكتملت."))
    for sym, name, err in failed:
        print(f"  {sym} {name}: {err}")


if __name__ == "__main__":
    main(sys.argv[1:])
