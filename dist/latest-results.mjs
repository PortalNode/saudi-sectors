// The key figures strip on each results page shows the company's latest reported
// year-to-date period (3, 6, 9 or 12 months of its fiscal year), summed from the quarterly
// file and compared with the same period a year earlier, whatever view the table shows.
// The page leaves that comparison as a table in a <template class="latest-results"> inside
// its panel; layout.js reads it there and falls back to the visible table when there is none.

export const YEAR_TO_DATE_LABELS = ['', '3 أشهر', '6 أشهر', '9 أشهر', '12 شهرًا'];
const hasData = values => !!values && Object.values(values).some(value => typeof value === 'number' && Number.isFinite(value));

/**
 * Two period columns, [same period last year, latest period], for the company's latest quarter
 * (Q2 → 6 months, Q3 → 9 months …). `sum(company, year, count)` adds up the first `count`
 * quarters of a fiscal year and returns null when one is missing. Returns null when the
 * company has no quarters or its latest period cannot be summed.
 */
export function latestYearToDateColumns(company, sum) {
  const latest = Object.keys(company?.quarters ?? {}).filter(key => hasData(company.quarters[key])).sort().at(-1);
  if (!latest) return null;
  const year = Number(latest.slice(0, 4)), count = Number(latest.slice(5));
  const values = sum(company, year, count);
  if (!values) return null;
  const sub = YEAR_TO_DATE_LABELS[count];
  return [
    { id: String(year - 1), label: String(year - 1), sub, values: sum(company, year - 1, count) },
    { id: String(year), label: String(year), sub, values }
  ];
}

/** Store the latest-period table in the panel, or remove it (html empty) to use the visible table. */
export function setLatestResults(panel, html) {
  let template = panel?.querySelector('template.latest-results');
  if (!html) { template?.remove(); return; }
  if (!template) {
    template = document.createElement('template');
    template.className = 'latest-results';
    panel.append(template);
  }
  template.innerHTML = html;
}
