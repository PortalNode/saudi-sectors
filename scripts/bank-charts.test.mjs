import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { METRIC_GROUPS } from '../dist/bank-metrics.mjs';
import { renderBankCharts, fitBankCharts, getChartModels, getChartOptions, renderChartSvg } from '../dist/bank-charts.mjs';

const data = JSON.parse(await readFile(new URL('../dist/banks-financials.json', import.meta.url), 'utf8'));
const metricKeys = METRIC_GROUPS.flatMap(group => group.metrics.map(metric => metric.key));
const keys = [...metricKeys, 'financingMix'];
const attrs = element => Object.fromEntries([...element.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const barsIn = svg => [...svg.matchAll(/<rect\b[^>]*class="chart-bar"[^>]*>[\s\S]*?<\/rect>/g)].map(match => ({ ...attrs(match[0].split('>')[0]), html: match[0] }));
const labelsIn = svg => [...svg.matchAll(/<text\b[^>]*class="chart-value(?: chart-missing)?"[^>]*>[\s\S]*?<\/text>/g)].map(match => ({ ...attrs(match[0].split('>')[0]), html: match[0] }));
const near = (a,b) => assert.ok(Math.abs(a-b)<0.001,`${a} ≈ ${b}`);

for (const bank of data.banks) {
  test(`${bank.symbol}: every table item selectable, one chart, exact source values and correct units`, () => {
    const original = JSON.stringify(bank);
    const options = getChartOptions(bank, data.years);
    assert.deepEqual(options.map(option=>option.key),keys);
    assert.ok(options.every(option=>option.group && option.label));
    assert.ok(!options.some(option=>['provisions','averageShares','recurringEps'].includes(option.key)));
    assert.deepEqual(getChartModels(bank).map(model=>model.key),keys);
    for (const model of getChartModels(bank)) {
      const html=renderBankCharts(bank,data.years,model.key);
      assert.equal((html.match(/<article\b/g)||[]).length,1);
      assert.match(html,new RegExp(`data-chart-key="${model.key}"`));
      assert.ok(html.includes(model.unit));
      const svg=renderChartSvg(model,600),root=attrs(svg.split('>')[0]);
      const bars=barsIn(svg),labels=labelsIn(svg);
      const min=Number(root['data-axis-min']),max=Number(root['data-axis-max']),zero=Number(root['data-zero-y']);
      assert.ok(min<=0&&max>0);
      assert.equal(labels.length,model.series.length*data.years.length);
      assert.equal((svg.match(/class="chart-year"/g)||[]).length,data.years.length);
      let present=0;
      for (const series of model.series) for (const point of series.points) {
        const source=bank.years.find(record=>record.year===point.year).values[series.key];
        assert.equal(point.rawValue,source);
        const expected=source===null?null:model.factor===1/1000?source/1000:source*model.factor;
        assert.equal(point.value,expected);
        const bar=bars.find(bar=>bar['data-series']===series.key&&bar['data-year']===String(point.year));
        const label=labels.find(label=>label['data-series']===series.key&&label['data-year']===String(point.year));
        assert.ok(label);
        if (source===null) {assert.ok(!bar);assert.match(label.html,/>—<title>/);continue;}
        present++;
        assert.equal(Number(bar['data-value']),source);
        assert.equal(Number(bar['data-chart-value']),expected);
        const top=model.key==='financingMix'?54:36;
        near(Number(bar.height),Math.abs(expected)*(236-top)/(max-min));
        near(Number(bar.y)+Number(bar.height),zero);
        if (model.percentage) assert.ok(label.html.includes('%<title>'));
      }
      assert.equal(bars.length,present);
      assert.equal(options.find(option=>option.key===model.key).available,present>0);
      if (model.key==='financingMix') {
        assert.equal(min,0);assert.equal(max,100);assert.equal(bars.length,10);
        for (const year of data.years) {
          const pair=bars.filter(bar=>bar['data-year']===String(year));
          assert.ok(Number(pair[0].x)+Number(pair[0].width)<Number(pair[1].x));
          assert.notEqual(pair[0].fill,pair[1].fill);
        }
      }
      assert.doesNotMatch(svg,/NaN|Infinity|undefined/);
    }
    assert.equal(JSON.stringify(bank),original);
    assert.equal(barsIn(renderBankCharts(bank)).length,5);
    assert.match(renderBankCharts(bank,data.years,'invalid'),/data-chart-key="netProfit"/);
  });
}

test('percentage ratios above 100 are not clipped; PE and EPS are not money-converted',()=>{
  const bank=data.banks.find(bank=>bank.symbol==='1120');
  const models=getChartModels(bank);
  const loans=models.find(model=>model.key==='loansToDeposits');
  const svg=renderChartSvg(loans,340);
  assert.ok(Number(attrs(svg.split('>')[0])['data-axis-max'])>loans.series[0].points.at(-1).value);
  assert.match(svg,/112\.81%/);
  for (const key of ['eps','dilutedEps','pe']) assert.equal(models.find(model=>model.key===key).factor,1);
  assert.equal(models.find(model=>model.key==='pe').unit,'مرة');
  assert.equal(models.find(model=>model.key==='assets').unit,'مليار ريال');
});

test('optional international financing remains selectable, with missing years not zero',()=>{
  const rajhi=data.banks.find(bank=>bank.symbol==='1120');
  assert.equal(getChartOptions(rajhi).find(option=>option.key==='internationalFinancingShare').available,false);
  const missing=renderBankCharts(rajhi,data.years,'internationalFinancingShare');
  assert.equal(barsIn(missing).length,0);assert.equal(labelsIn(missing).length,5);
  const ahli=data.banks.find(bank=>bank.symbol==='1180');
  const actual=renderBankCharts(ahli,data.years,'internationalFinancingShare');
  assert.equal(barsIn(actual).length,1);assert.match(actual,/3\.28%/);
});

test('responsive plots, zero baseline, negative and null values stay safe',()=>{
  const bank=structuredClone(data.banks[0]);
  bank.years[0].values.eps=-2;bank.years[1].values.eps=0;bank.years[2].values.eps=null;
  const model=getChartModels(bank).find(model=>model.key==='eps');
  for (const width of [300,340,600,1280]) {
    const svg=renderChartSvg(model,width),root=attrs(svg.split('>')[0]),bars=barsIn(svg);
    assert.equal(root.viewBox,`0 0 ${width} 280`);
    assert.equal(bars.length,4);
    assert.ok(Number(root['data-axis-min'])<-2);
    near(Number(bars[0].y),Number(root['data-zero-y']));near(Number(bars[1].height),0);
    assert.ok(bars.every(bar=>Number(bar.x)>=0&&Number(bar.x)+Number(bar.width)<=width));
    assert.doesNotMatch(svg,/NaN|Infinity/);
  }
});

test('fit resizes only the selected canvas and skips unchanged width',()=>{
  const bank=data.banks[0],model=getChartModels(bank).find(model=>model.key==='pe');
  const canvas={dataset:{chartCanvas:model.key,plotWidth:'600',bankSymbol:bank.symbol,plotSignature:JSON.stringify(model)},clientWidth:340,writes:0,content:'',querySelector(){return this.svg;}};
  canvas.svg={set outerHTML(html){canvas.content=html;canvas.writes++;}};
  const container={querySelectorAll(){return[canvas];}};
  fitBankCharts(container,bank);assert.equal(canvas.writes,1);assert.match(canvas.content,/viewBox="0 0 340 280"/);
  fitBankCharts(container,bank);assert.equal(canvas.writes,1);
  fitBankCharts(container,data.banks[1]);assert.equal(canvas.writes,2);
  fitBankCharts(null,bank);
});

test('selector, source isolation and escaped names remain correct',async()=>{
  const bank=structuredClone(data.banks[0]);bank.name='<script>"&';
  assert.doesNotMatch(renderBankCharts(bank),/<script>/);
  assert.match(renderBankCharts(bank),/&lt;script&gt;/);
  const page=await readFile(new URL('../dist/banks.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../dist/banks.js',import.meta.url),'utf8');
  assert.match(page,/<select id="bank-chart-metric"/);
  assert.match(script,/getChartOptions/);
  assert.match(script,/selectedChartKey/);
  assert.doesNotMatch(script,/argaam\.com|setInterval|OPENAI|invokeLLM/);
});
