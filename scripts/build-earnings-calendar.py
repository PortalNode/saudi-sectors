#!/usr/bin/env python3
"""«موعد النتائج القادمة» on the company pages.

Keeps every known results-announcement date in scripts/earnings-dates.json and writes one
file per company to dist/earnings-calendar/<symbol>.json (plus index.json) with:
  - the past announcements (date, time, days after the period end, net profit and its
    year-on-year change from the quarterly files, and the first-session price move),
  - the expected date of the next results, its range and a confidence level,
  - how early or late the company announces against the market and its sector.

Each run adds the results announcements found in dist/announcements (the Tadawul feed that
update-announcements.py keeps current), so new dates arrive without manual entry.

  python3 scripts/build-earnings-calendar.py
  python3 scripts/build-earnings-calendar.py --import-ehp DIR   # one-off seed (see below)

--import-ehp reads announcement-history.js, announcement-updates.js and fiscal-calendars.js
from the Expert-House-Predictions site (https://portalnode.github.io/Expert-House-Predictions/
assets/) as JSON data — the files are never executed.
"""
import glob
import json
import os
import re
import statistics
import sys
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
STORE = os.path.join(ROOT, 'scripts', 'earnings-dates.json')
OUT = os.path.join(DIST, 'earnings-calendar')
PRIORITY = {'history': 1, 'verified': 2, 'tadawul': 3}
MAX_LAG = 150


def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf8') as f:
        return json.load(f)


def write_json(path, value, pretty=False):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf8') as f:
        if pretty:
            json.dump(value, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write('\n')
        else:
            json.dump(value, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)


# ---------- fiscal periods ----------
def month_end(y, m):
    return date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)


def period_end(year_end, fy, q):
    """Fiscal year `fy` ends in calendar year fy, in month `year_end`; quarter q ends 3*(4-q) months earlier."""
    m, y = year_end - 3 * (4 - q), fy
    while m <= 0:
        m += 12
        y -= 1
    return month_end(y, m)


def fiscal_of(year_end, pe, months):
    """(fiscal year, quarter) of a period ending `pe` that covers `months` months of the fiscal year."""
    m, y = pe.month + (12 - months), pe.year
    while m > 12:
        m -= 12
        y += 1
    return y, months // 3


# ---------- Tadawul result titles ----------
AR_MONTHS = {'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'أبريل': 4, 'مايو': 5, 'يونيو': 6, 'يوليو': 7,
             'اغسطس': 8, 'أغسطس': 8, 'سبتمبر': 9, 'اكتوبر': 10, 'أكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12}


def normalize(text):
    text = re.sub(r'[ً-ٰٟ]', '', text)
    return text.replace('ی', 'ي').replace('ک', 'ك').replace('اشهر', 'أشهر')


def parse_period_end(text):
    m = re.search(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})', text)
    if m:
        return date(int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r'(\d{1,2})[-/](\d{1,2})[-/](\d{4})', text)
    if m:
        return date(int(m[3]), int(m[2]), int(m[1]))
    m = re.search(r'(\d{1,2})\s+(\S+?)\s+(\d{4})', text)
    if m and m[2] in AR_MONTHS:
        return date(int(m[3]), AR_MONTHS[m[2]], int(m[1]))
    return None


def months_covered(text):
    if 'تسعة' in text:
        return 9
    if 'ستة' in text:
        return 6
    if 'ثلاثة' in text:
        return 3
    if re.search(r'اثنا عشر|إثنا عشر|اثني عشر|السنوية|12 شهر', text):
        return 12
    return None


def result_period(title):
    """(period end, months) when the title is a results announcement, else None."""
    t = normalize(title)
    if not re.search(r'(النتائج|نتائجها) المالية', t) or 'المنتهي' not in t:
        return None
    if re.search(r'عدم تمكن|لقاء|اجتماع|تأخر|تأجيل|تصحيح|تعديل|مؤتمر', t):
        return None
    try:
        pe = parse_period_end(t.split('المنتهي')[-1])
    except ValueError:
        return None
    months = months_covered(t)
    if not pe or not months or pe.day < 28:
        return None
    return pe, months


# ---------- store ----------
class Store:
    def __init__(self, data):
        self.year_end = {k: int(v) for k, v in (data or {}).get('yearEnd', {}).items()}
        self.dates = {s: {(r['fy'], r['q']): r for r in rs} for s, rs in (data or {}).get('dates', {}).items()}

    def ye(self, sym):
        return self.year_end.get(sym, 12)

    def put(self, sym, fy, q, d, tm, src, url=''):
        if q not in (1, 2, 3, 4) or not re.match(r'^\d{4}-\d{2}-\d{2}$', d or ''):
            return False
        lag = (date.fromisoformat(d) - period_end(self.ye(sym), fy, q)).days
        if lag < 0 or lag > MAX_LAG:
            return False
        recs = self.dates.setdefault(sym, {})
        old = recs.get((fy, q))
        if old and PRIORITY[old['src']] > PRIORITY[src]:
            return False
        # the same source twice for one period (a later update or a repeat): keep the first announcement
        if old and old['src'] == src and old['d'] < d:
            return False
        new = {'fy': fy, 'q': q, 'd': d, 'tm': tm or (old or {}).get('tm', ''), 'src': src, 'url': url or ''}
        if old == new:
            return False
        recs[(fy, q)] = new
        return True

    def dump(self):
        return {
            '_comment': 'Results-announcement dates per company. fy/q are fiscal (fy = calendar year the fiscal year '
                        'ends in; yearEnd lists companies whose year does not end in December). src: tadawul (this '
                        'site\'s feed) > verified (Mubasher archive) > history (Expert-House-Predictions import). '
                        'Built by scripts/build-earnings-calendar.py.',
            'yearEnd': dict(sorted(self.year_end.items())),
            'dates': {s: [rs[k] for k in sorted(rs)] for s, rs in sorted(self.dates.items()) if rs},
        }


def load_js_data(path):
    """Parse `globalThis.NAME = {...};` as JSON without running it."""
    text = open(path, encoding='utf8').read()
    start = text.index('=', text.index('globalThis.')) + 1
    return json.loads(text[start:].strip().rstrip(';').strip())


def import_ehp(store, folder, listed):
    cal = load_js_data(os.path.join(folder, 'fiscal-calendars.js'))
    for sym, v in cal.items():
        ye = (v or {}).get('yearEnd')
        if ye and sym in listed and int(ye[:2]) != 12:
            store.year_end.setdefault(sym, int(ye[:2]))
    hist = load_js_data(os.path.join(folder, 'announcement-history.js'))
    upd = load_js_data(os.path.join(folder, 'announcement-updates.js'))
    added = 0
    for f in hist['forecasts']:
        for h in f['history']:
            if f['symbol'] in listed:
                added += store.put(f['symbol'], h['year'], int(h['quarter'][1]), h['date'], h.get('time'), 'history')
    for r in upd['records']:
        if r['symbol'] in listed:
            added += store.put(r['symbol'], r['year'], int(r['quarter'][1]), r['date'], None, 'verified', r.get('sourceUrl', ''))
    return added


def import_feed(store, listed):
    added = 0
    for path in glob.glob(os.path.join(DIST, 'announcements', '*.json')):
        doc = read_json(path, {})
        sym = doc.get('symbol')
        if sym not in listed:
            continue
        for item in doc.get('items', []):
            found = result_period(item.get('title', ''))
            if not found:
                continue
            fy, q = fiscal_of(store.ye(sym), *found)
            t = item['t']
            added += store.put(sym, fy, q, t[:10], t[11:16] if len(t) > 10 else '', 'tadawul', item.get('url', ''))
    return added


# ---------- derived figures ----------
def price_move(ohlc, d, tm):
    """First-session close vs the previous close; announcements after 15:00 count from the next session."""
    if not ohlc or not ohlc.get('d') or d < ohlc['d'][0]:
        return None
    ds, cs = ohlc['d'], ohlc['c']
    after_close = bool(tm) and tm >= '15:00'
    i = next((k for k, x in enumerate(ds) if (x > d if after_close else x >= d)), None)
    if i is None or i == 0 or cs[i] is None or not cs[i - 1]:
        return None
    return round((cs[i] / cs[i - 1] - 1) * 100, 2)


def trading_day(d):
    if d.weekday() == 4:   # Friday -> Thursday
        return d - timedelta(days=1)
    if d.weekday() == 5:   # Saturday -> Sunday
        return d + timedelta(days=1)
    return d


def median(values):
    return statistics.median(values) if values else None


def build(store, companies):
    profit = {}
    for path in glob.glob(os.path.join(DIST, '*-quarterly-financials.json')):
        for c in (read_json(path, {}) or {}).get('companies', []):
            for k, v in (c.get('quarters') or {}).items():
                if isinstance(v, dict) and isinstance(v.get('netProfit'), (int, float)):
                    profit[(c['symbol'], k)] = v['netProfit']

    rows = {}
    for sym, c in companies.items():
        ye = store.ye(sym)
        ohlc = read_json(os.path.join(DIST, 'ohlc', sym + '.json'))
        recs = []
        for (fy, q), r in sorted(store.dates.get(sym, {}).items()):
            pe = period_end(ye, fy, q)
            rec = {'fy': fy, 'q': q, 'pe': pe.isoformat(), 'd': r['d'], 'tm': r['tm'], 'src': r['src'],
                   'lag': (date.fromisoformat(r['d']) - pe).days, 'rx': price_move(ohlc, r['d'], r['tm'])}
            if r['url']:
                rec['url'] = r['url']
            if ye == 12:  # quarter keys in the quarterly files follow the calendar year only for December years
                now, before = profit.get((sym, f'{fy}Q{q}')), profit.get((sym, f'{fy - 1}Q{q}'))
                rec['np'] = now
                rec['yoy'] = round((now - before) / abs(before) * 100, 1) if now is not None and before else None
            recs.append(rec)
        rows[sym] = recs

    # market median of days-after-period-end per quarter, last two fiscal years
    newest = max((r['fy'] for rs in rows.values() for r in rs), default=date.today().year)
    mkt = {q: median([r['lag'] for rs in rows.values() for r in rs if r['q'] == q and r['fy'] >= newest - 2]) for q in (1, 2, 3, 4)}
    sector_lags = {}
    for sym, rs in rows.items():
        for r in rs[-8:]:
            sector_lags.setdefault((companies[sym]['sec'], r['q']), []).append(r['lag'])

    out, errors = {}, []
    for sym, rs in rows.items():
        if not rs:
            continue
        c, ye = companies[sym], store.ye(sym)
        for r in rs:
            diff = r['lag'] - mkt[r['q']]
            r['sp'] = 'fast' if diff <= -7 else 'slow' if diff >= 7 else ''
        # back-test: predict each period from up to three earlier same-quarter lags
        errs = []
        for r in rs:
            prior = [x['lag'] for x in rs if x['q'] == r['q'] and x['fy'] < r['fy']][-3:]
            if len(prior) >= 2:
                guess = trading_day(date.fromisoformat(r['pe']) + timedelta(days=round(median(prior))))
                errs.append(abs((date.fromisoformat(r['d']) - guess).days))
        errors += errs
        last = rs[-1]
        fy, q = (last['fy'], last['q'] + 1) if last['q'] < 4 else (last['fy'] + 1, 1)
        pe = period_end(ye, fy, q)
        own = [x['lag'] for x in rs if x['q'] == q][-3:]
        lags = own or sector_lags.get((c['sec'], q)) or [mkt[q] or 40]
        expected = trading_day(pe + timedelta(days=round(median(lags))))
        if own:
            lo, hi = trading_day(pe + timedelta(days=min(own))), trading_day(pe + timedelta(days=max(own)))
        else:
            lo, hi = expected - timedelta(days=7), expected + timedelta(days=7)
        spread = (hi - lo).days
        conf = 'عالية' if len(own) >= 3 and spread <= 7 else 'متوسطة' if len(own) >= 2 and spread <= 14 else 'أولية'
        recent = rs[-4:]
        out[sym] = {
            's': sym, 'n': c['n'], 'sec': c['sec'], 'fye': ye,
            'rel': round(sum(r['lag'] - mkt[r['q']] for r in recent) / len(recent), 1),
            'next': {'fy': fy, 'q': q, 'pe': pe.isoformat(), 'd': expected.isoformat(), 'lo': lo.isoformat(),
                     'hi': hi.isoformat(), 'conf': conf, 'n': len(own), 'm': 'company' if own else 'sector'},
            'bt': {'n': len(errs), 'w7': round(sum(e <= 7 for e in errs) / len(errs) * 100) if errs else None,
                   'med': median(errs)},
            'recs': rs,
        }
    # speed rank inside the sector (1 = earliest)
    for doc in out.values():
        peers = sorted((o for o in out.values() if o['sec'] == doc['sec']), key=lambda o: o['rel'])
        doc['rank'], doc['peers'] = peers.index(doc) + 1, len(peers)
    return out, mkt, errors


def main(argv):
    data = read_json(os.path.join(DIST, 'data.json'))
    companies = {st['symbol']: {'n': st['name'], 'sec': sec['name']} for sec in data['sectors'] for st in sec['stocks']}
    store = Store(read_json(STORE, {}))
    for sym, v in (read_json(os.path.join(ROOT, 'scripts', 'fiscal-years.json'), {}) or {}).items():
        if sym.isdigit() and isinstance(v, dict) and v.get('endMonth'):
            store.year_end[sym] = int(v['endMonth'])
    if '--import-ehp' in argv:
        print('imported', import_ehp(store, argv[argv.index('--import-ehp') + 1], set(companies)), 'dates from Expert-House-Predictions')
    print('feed added', import_feed(store, set(companies)), 'dates')
    write_json(STORE, store.dump(), pretty=True)

    out, mkt, errors = build(store, companies)
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name.endswith('.json') and name != 'index.json' and name[:-5] not in out:
            os.remove(os.path.join(OUT, name))
    for sym, doc in out.items():
        write_json(os.path.join(OUT, sym + '.json'), doc)
    write_json(os.path.join(OUT, 'index.json'), {
        'built': date.today().isoformat(),
        'marketLag': {str(q): v for q, v in mkt.items()},
        'backtest': {'n': len(errors), 'within7': round(sum(e <= 7 for e in errors) / len(errors) * 100, 1) if errors else None},
        'companies': [{'s': d['s'], 'n': d['n'], 'sec': d['sec'], 'last': d['recs'][-1]['d'], **{k: d['next'][k] for k in ('fy', 'q', 'd', 'lo', 'hi', 'conf')}}
                      for d in sorted(out.values(), key=lambda d: d['next']['d'])],
    })
    print('companies', len(out), 'dates', sum(len(d['recs']) for d in out.values()),
          'backtest within 7 days', f"{sum(e <= 7 for e in errors) / max(1, len(errors)) * 100:.1f}%")


if __name__ == '__main__':
    main(sys.argv[1:])
