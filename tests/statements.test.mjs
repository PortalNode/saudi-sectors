import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { renderStatement, formatAmount, formatChange, columnLabel, validateStatements, chartModel, shortLabel } from '../dist/statements.mjs';
import { renderChartSvg } from '../dist/cement-charts.mjs';
import { statementsSection, buildPack } from '../scripts/build-ai-packs.mjs';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');
const sectorPages = readdirSync(dist).filter(name => name.endsWith('.html') && read(name).includes('class="bank-panel"') && !name.startsWith('preview'));

const sample = {
  schemaVersion: 1, sector: 'الاسمنت', unit: 'مليون ريال',
  items: {
    bs: [
      { key: 'cash', label: 'النقد وما في حكمه', group: 'الموجودات' },
      { key: 'inventory', label: 'المخزون', group: 'الموجودات' },
      { key: 'totalAssets', label: 'إجمالي الموجودات', group: 'الموجودات', total: true },
      { key: 'netDebt', label: 'صافي الدين', group: 'مؤشرات محسوبة', computed: true },
      { key: 'loansToDeposits', label: 'نسبة القروض إلى الودائع', group: 'مؤشرات محسوبة', unit: 'ratio', computed: true },
    ],
    cf: [{ key: 'cfo', label: 'صافي النقد من الأنشطة التشغيلية', total: true }, { key: 'fcf', label: 'التدفق النقدي الحر', computed: true }],
  },
  companies: [
    { symbol: '3092', name: 'أسمنت الرياض', status: 'ok', years: [2024, 2025], quarters: ['2026Q2', '2026Q3'],
      bs: { cash: { 2024: 148.7, 2025: 62, '2026Q3': 17.5 }, totalAssets: { 2024: 1970.47, 2025: 1896.89, '2026Q2': 1933.43, '2026Q3': 1891.21 }, netDebt: { 2025: -62 }, loansToDeposits: { 2025: 0.8123 } },
      cf: { cfo: { 2024: 434.19, 2025: 243.1, '2026Q2': 38.95, '2026Q3': 48.45 }, fcf: { 2025: 111.67 } } },
    { symbol: '3004', name: 'أسمنت الشمالية', status: 'missing' },
  ],
};

test('validates the statements file shape', () => {
  assert.equal(validateStatements(sample), sample);
  assert.throws(() => validateStatements({ schemaVersion: 2 }));
  assert.throws(() => validateStatements({ ...sample, companies: [{ symbol: 'x' }] }));
});

test('renders the balance sheet with groups, totals, computed rows and no empty items', () => {
  const html = renderStatement(sample, sample.companies[0], 'bs', 'fy');
  assert.match(html, /<caption>أسمنت الرياض · المركز المالي السنوي 2024–2025 — مليون ريال<\/caption>/);
  assert.match(html, /<tr class="annual-group"><th scope="colgroup" colspan="4">الموجودات<\/th><\/tr>/);
  assert.match(html, /<tr data-item="totalAssets" class="statement-total">/);
  assert.match(html, /<tr data-item="netDebt" class="statement-computed">/);
  assert.doesNotMatch(html, /data-item="inventory"/, 'an item with no value in any column is left out');
  assert.match(html, /<span class="num down">-62\.0<\/span>/);
  assert.match(html, /81\.2%/);
  assert.match(html, /<th scope="col" class="annual-change-heading">نسبة التغير<\/th>/);
  assert.match(html, /<tr data-item="totalAssets" class="statement-total"><th[^>]*>إجمالي الموجودات<\/th><td><span class="num">1,970\.5<\/span><\/td><td class="annual-change"><span class="num down">-3\.7%<\/span><\/td>/);
});

test('renders the latest quarters for cash flows, each quarter on its own', () => {
  const html = renderStatement(sample, sample.companies[0], 'cf', 'q');
  assert.match(html, /آخر الأرباع \(كل ربع منفرد\)/);
  assert.match(html, /<th scope="col">الربع الثاني 2026<\/th><th scope="col" class="annual-change-heading">التغير عن الربع السابق<\/th><th scope="col" class="period-latest">الربع الثالث 2026<\/th>/);
  assert.match(html, /<td class="annual-change"><span class="num up">\+24\.4%<\/span><\/td><td><span class="num">48\.5<\/span><\/td>/);
  assert.doesNotMatch(html, /data-item="fcf"/);
});

test('a company without data gets a clear message, not an empty table', () => {
  assert.match(renderStatement(sample, sample.companies[1], 'bs', 'fy'), /statements-empty.*غير متوفرة حاليًا/);
  assert.match(renderStatement(sample, undefined, 'cf', 'fy'), /غير متوفرة حاليًا/);
});

test('formats amounts and period labels', () => {
  assert.equal(columnLabel('2026Q1'), 'الربع الأول 2026');
  assert.equal(columnLabel('2025'), '2025');
  assert.match(formatAmount(1043268.3), />1,043,268</);
  assert.match(formatAmount(1896.89), />1,896\.9</);
  assert.match(formatAmount(null), /missing/);
  assert.match(formatChange(-50, -100), /num up">\+50\.0%/);
  assert.match(formatChange(5, 0), /missing/);
  assert.match(formatChange(0.8, 0.7, 'ratio'), /missing/);
});

test('every sector page loads the statements module and stylesheet', () => {
  assert.ok(sectorPages.length >= 31);
  for (const page of sectorPages) {
    const html = read(page);
    assert.match(html, /<script type="module" src="statements\.mjs\?v=statements-[\w-]+"><\/script>/, page);
    assert.match(html, /<link rel="stylesheet" href="statements\.css\?v=statements-[\w-]+">/, page);
    assert.match(html, /<span>البيانات المالية<\/span><span aria-hidden="true"> \/ <\/span>/, page);
  }
});

test('every built statements file matches a sector page and the site companies', () => {
  for (const page of sectorPages) {
    const slug = page.replace(/\.html$/, '');
    if (!existsSync(new URL(`${slug}-statements.json`, dist))) continue;
    const data = validateStatements(JSON.parse(read(`${slug}-statements.json`)));
    const site = JSON.parse(read(`${slug}-financials.json`));
    const symbols = (site.companies || site.banks).map(c => c.symbol).sort();
    assert.deepEqual(data.companies.map(c => c.symbol).sort(), symbols, slug);
    for (const c of data.companies.filter(c => c.status === 'ok')) {
      for (const stmt of ['bs', 'cf']) for (const [key, series] of Object.entries(c[stmt])) {
        assert.ok(data.items[stmt].some(i => i.key === key), `${slug} ${c.symbol} ${key}`);
        for (const [period, v] of Object.entries(series)) {
          assert.ok(Number.isFinite(v), `${slug} ${c.symbol} ${key} ${period}`);
          assert.ok(/^\d{4}(Q[1-4])?$/.test(period) && (c.years.map(String).includes(period) || c.quarters.includes(period)), `${slug} ${c.symbol} ${key} ${period}`);
        }
      }
    }
  }
});

test('the AI analyst company pack carries the balance sheet and cash flows', () => {
  const section = statementsSection({ doc: sample, company: sample.companies[0] });
  assert.ok(section.lines.some(line => line.startsWith('المركز المالي (مليون ريال')));
  assert.ok(section.lines.some(line => line.startsWith('التدفقات النقدية (مليون ريال، الأعمدة الربعية لكل ربع منفرد')));
  assert.ok(section.lines.includes('إجمالي الموجودات | 1,970 | 1,897 | 1,891'));
  assert.deepEqual([section.facts.netDebt, section.facts.fcf], [-62, 111.67]);
  assert.equal(statementsSection({ doc: sample, company: sample.companies[1] }), null);
  const pack = buildPack({ stock: { symbol: '3092', name: 'أسمنت الرياض' }, sector: { name: 'الاسمنت', stocks: [] }, statements: { doc: sample, company: sample.companies[0] } });
  assert.match(pack.text, /المركز المالي \(مليون ريال\):/);
  assert.ok(pack.sources.some(([name]) => name === 'المركز المالي والتدفقات النقدية'));
});

test('the bar chart compares a statement item across the shown periods', () => {
  const company = sample.companies[0];
  const assets = chartModel(sample, company, 'bs', 'fy');
  assert.equal(assets.key, 'totalAssets', 'total assets is the default balance-sheet chart');
  assert.equal(assets.unit, 'مليار ريال');
  assert.deepEqual(assets.years, ['2024', '2025']);
  assert.deepEqual(assets.series[0].points.map(p => p.rawValue), [1970.47, 1896.89]);
  assert.equal(chartModel(sample, company, 'cf', 'q').key, 'cfo', 'operating cash flow is the default cash-flow chart');
  assert.deepEqual(chartModel(sample, company, 'cf', 'q').years, ['Q2 2026', 'Q3 2026']);
  const ratio = chartModel(sample, company, 'bs', 'fy', 'loansToDeposits');
  assert.equal(ratio.unit, '%');
  assert.equal(ratio.series[0].points.at(-1).value, 81.23);
  assert.equal(chartModel(sample, sample.companies[1], 'bs', 'fy'), null);
  assert.equal(shortLabel('2026Q1'), 'Q1 2026');
  const svg = renderChartSvg(assets, 600);
  assert.match(svg, /class="bank-chart-svg"/);
  assert.equal((svg.match(/<rect class="chart-bar"/g) || []).length, 2);
});
