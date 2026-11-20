#!/usr/bin/env python3
"""Add newly published Tadawul issuer announcements to dist/announcements/<symbol>.json.

One market-wide query for the last few days (symbol left empty), compared with the ids already stored;
the detail page is fetched only for new ids. Nothing is written when nothing is new, so the workflow
makes no commit. Failures never raise: the old files stay and a ::warning:: is printed.

saudiexchange.sa sits behind Akamai, which rejects non-browser TLS fingerprints, so every request goes
through curl-impersonate (CURL_IMPERSONATE_BIN) with the same request shape the earlier company-news
fetcher used from GitHub Actions: landing page -> <base href> -> POST with the cookie jar.

Usage:
  CURL_IMPERSONATE_BIN=/opt/curl-impersonate/curl_chrome116 python3 scripts/update-announcements.py
  ... --probe        # query only, print what was found, write nothing
  ... --days 7       # look back further (default 3)
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'dist', 'announcements')
BIN = os.environ.get('CURL_IMPERSONATE_BIN') or 'curl_chrome116'
BASE = 'https://www.saudiexchange.sa'
LANDING = BASE + '/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements?locale=ar'
ENDPOINT_PATH = 'p0/IZ7_5A602H80O0HTC060SG6UT81DI1=CZ6_5A602H80O0HTC060SG6UT81D26=NJgetAnnouncementListData=/'
DETAIL = (BASE + '/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements/'
          'issuer-announcements-details/?anId={id}&anCat=1&cs={symbol}&locale=ar')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/116.0.0.0 Safari/537.36'
RIYADH = timezone(timedelta(hours=3))
KEEP_DAYS = 365
MAX_DETAILS = 60  # per run; the rest are picked up by the next run
TIMEOUT = 45


def log(*parts):
    print(*parts, flush=True)


def warn(message):
    log(f'::warning::{message}')


# ---------------------------------------------------------------- curl-impersonate
def curl(args):
    result = subprocess.run([BIN, '-sS', '-L', '--compressed', '--max-time', str(TIMEOUT), '-A', UA, *args],
                            capture_output=True, text=True, timeout=TIMEOUT + 15)
    if result.returncode != 0:
        raise RuntimeError(f'curl exit {result.returncode}: {result.stderr.strip()[:200]}')
    return result.stdout


def open_session():
    jar = os.path.join(tempfile.gettempdir(), f'tadawul-ann-{os.getpid()}.cookies')
    html = curl(['-c', jar, '-b', jar, LANDING])
    base = re.search(r'<base[^>]+href=["\']([^"\']+)["\']', html, re.I)
    if not base:
        raise RuntimeError(f'landing page has no <base href> (got {len(html)} bytes: {html[:120]!r})')
    return jar, urljoin(base.group(1), ENDPOINT_PATH)


def list_page(jar, endpoint, dfrom, dto, page, symbol=''):
    form = (f'locale=ar&annoucmentType=1_-1&symbol={symbol}&sectorDpId=-1&searchType=1&fromDate={dfrom}&toDate={dto}'
            f'&datePeriod=&productType=&advisorsList=-1&textSearch=&pageNumberDb={page}&pageSize=100')
    text = curl(['-c', jar, '-b', jar, '-e', LANDING, '-X', 'POST', endpoint,
                 '-H', 'X-Requested-With: XMLHttpRequest',
                 '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8', '--data', form])
    try:
        return json.loads(text)
    except ValueError:
        raise RuntimeError(f'list answer is not JSON: {text[:160]!r}')


def list_all(jar, endpoint, dfrom, dto):
    rows, page = [], 1
    while page <= 20:
        payload = list_page(jar, endpoint, dfrom, dto, page)
        batch = payload.get('announcementList') or []
        total = int(payload.get('totalCount') or (batch[0].get('totalCount') if batch else 0) or 0)
        rows.extend(batch)
        if not batch or len(rows) >= total:
            break
        page += 1
        time.sleep(0.3)
    return rows


# ---------------------------------------------------------------- detail page
def clean(text):
    text = (text or '').replace('\r', '\n').replace('\xa0', ' ')
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def parse_detail(html):
    """Same extraction as news-fetch/tadawul_announcements.py (the one that produced the workbooks)."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, 'lxml')
    box = soup.select_one('.announcementBoxLft') or soup
    out = {'title': '', 'greg': '', 'time': '', 'body': ''}
    h3 = box.select_one('h3')
    if h3:
        out['title'] = clean(h3.get_text(' ', strip=True))
    dat = box.select_one('.price-date .date')
    if dat:
        match = re.search(r'(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2})', clean(dat.get_text(' ', strip=True)))
        if match:
            out['greg'], out['time'] = match.group(1), match.group(2)
    body = box.select_one('.article_body')
    if body:
        for table in body.find_all('table'):
            lines = []
            for tr in table.find_all('tr'):
                cells = [clean(td.get_text(' ', strip=True)) for td in tr.find_all(['td', 'th'])]
                cells = [c for c in cells if c]
                if cells:
                    lines.append(' : '.join(cells))
            table.replace_with('\n'.join(lines))
        text = clean(body.get_text('\n', strip=True))
        text = re.sub(r'بند\s*توضيح\s*تفاصيل الإعلان', 'تفاصيل الإعلان', text)
        text = re.sub(r'^الملفات الملحقة\s*$', '', text, flags=re.M)
        out['body'] = clean(text)
    return out


def fetch_detail(jar, url):
    html = curl(['-c', jar, '-b', jar, '-e', LANDING, url])
    if 'announcementBoxLft' not in html:
        raise RuntimeError(f'no announcement box in detail page ({len(html)} bytes)')
    return parse_detail(html)


# ---------------------------------------------------------------- storage
def iso(greg, clock=''):
    match = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', greg or '')
    if not match:
        return None
    day, month, year = match.groups()
    out = f'{year}-{int(month):02d}-{int(day):02d}'
    return f'{out}T{clock}' if clock else out


def newest_first(items):
    return sorted(items, key=lambda item: (item['t'], int(item['id'])), reverse=True)


def load_store():
    store = {}
    for path in glob.glob(os.path.join(OUT, '[0-9][0-9][0-9][0-9].json')):
        with open(path, encoding='utf-8') as handle:
            store[os.path.basename(path)[:-5]] = json.load(handle)['items']
    return store


def write_json(path, payload):
    text = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    if os.path.exists(path):
        with open(path, encoding='utf-8') as handle:
            if handle.read() == text:
                return False
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(text)
    return True


def listed_symbols():
    with open(os.path.join(ROOT, 'dist', 'data.json'), encoding='utf-8') as handle:
        return {str(stock['symbol']) for sector in json.load(handle)['sectors'] for stock in sector['stocks']}


# ---------------------------------------------------------------- main
def run(days, probe):
    now = datetime.now(RIYADH)
    dfrom, dto = (now - timedelta(days=days)).strftime('%m/%d/%Y'), now.strftime('%m/%d/%Y')
    jar, endpoint = open_session()
    rows = list_all(jar, endpoint, dfrom, dto)
    log(f'list {dfrom} -> {dto}: {len(rows)} announcements market-wide')
    if probe:
        for row in rows[:3]:
            log('  sample:', row.get('SYMBOL') or row.get('indexSymbol'), row.get('PRESS_REL_ID'), row.get('newsDateStr'), (row.get('TITLE') or row.get('SHORT_DESC') or '')[:70])
        return

    symbols, store = listed_symbols(), load_store()
    known = {item['id'] for items in store.values() for item in items}
    fresh = []
    for row in rows:
        symbol = str(row.get('SYMBOL') or row.get('indexSymbol') or '').strip()
        ann_id = str(row.get('PRESS_REL_ID') or '').strip()
        if symbol in symbols and ann_id and ann_id not in known:
            fresh.append((symbol, ann_id, row))
            known.add(ann_id)
    log(f'{len(fresh)} new for listed companies')
    if not fresh:
        return

    changed = set()
    for symbol, ann_id, row in fresh[:MAX_DETAILS]:
        url = DETAIL.format(id=ann_id, symbol=symbol)
        title = clean(row.get('TITLE') or row.get('SHORT_DESC') or '')
        body, when = clean(row.get('SHORT_DESC') or ''), iso(row.get('newsDateStr') or '')
        try:
            detail = fetch_detail(jar, url)
            title = detail['title'] or title
            body = detail['body'] or body
            when = iso(detail['greg'], detail['time']) or when
        except Exception as exc:  # noqa: BLE001 - keep the announcement with what the list gave us
            warn(f'detail {symbol}/{ann_id} failed: {exc}')
        if not when or not title:
            warn(f'skipped {symbol}/{ann_id}: missing date or title')
            continue
        store.setdefault(symbol, []).append({'id': ann_id, 't': when, 'title': title, 'body': body, 'url': url})
        changed.add(symbol)
        log(f'  + {symbol} {ann_id} {when} {title[:60]}')
        time.sleep(0.4)
    if len(fresh) > MAX_DETAILS:
        log(f'{len(fresh) - MAX_DETAILS} more will be added by the next run')

    cutoff = (now - timedelta(days=KEEP_DAYS)).strftime('%Y-%m-%d')
    os.makedirs(OUT, exist_ok=True)
    market = []
    for symbol, items in store.items():
        items = newest_first([item for item in items if item['t'][:10] >= cutoff])
        if not items:
            continue
        store[symbol] = items
        if symbol in changed:
            write_json(os.path.join(OUT, f'{symbol}.json'), {'symbol': symbol, 'updated': items[0]['t'][:10], 'items': items})
        market.extend({'symbol': symbol, **{k: v for k, v in item.items() if k != 'body'}} for item in items)
    market = sorted(market, key=lambda item: (item['t'], int(item['id'])), reverse=True)[:100]
    write_json(os.path.join(OUT, 'latest.json'), {'items': market})
    log(f'updated {len(changed)} companies')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--days', type=int, default=3)
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()
    try:
        run(args.days, args.probe)
    except Exception as exc:  # noqa: BLE001 - a source outage must never fail the price update
        warn(f'Announcements were not updated: {exc}')


if __name__ == '__main__':
    sys.exit(main())
