import { renderChartSvg } from './bank-charts.mjs';

// A current ratio has one observation per bank, never five synthetic annual values.
export function currentPEChartModel(records) {
  return {
    key: 'currentPE', title: 'مكرر الربح الحالي — مقارنة البنوك',
    bankName: 'البنوك السعودية', unit: 'مرة', factor: 1,
    years: records.map(record => record.name),
    series: [{
      key: 'currentPE', title: 'مكرر الربح الحالي', color: '#f59e0b',
      points: records.map(record => ({
        year: record.name, rawValue: record.pe, value: record.pe
      }))
    }]
  };
}

export function renderCurrentPEComparison(records) {
  const model = currentPEChartModel(records);
  const available = records.filter(record => record.pe !== null).length;
  return `<article class="bank-chart-card bank-current-pe-comparison" data-chart-key="currentPE" dir="rtl"><h4>مكرر الربح الحالي — مقارنة جميع البنوك</h4><p class="bank-chart-unit">مرة · ${available} من ${records.length} بنوك تتوفر لها قيمة · سعر آخر لقطة ÷ ربحية السهم؛ تُفضّل الربحية المتكررة المتاحة في المشروع</p><div class="current-pe-chart-scroll" tabindex="0" aria-label="مقارنة المكرر الحالي للبنوك؛ مرر أفقيًا لرؤية جميع البنوك"><div class="bank-chart-canvas" data-current-pe-canvas>${renderChartSvg(model, 1050)}</div></div><p class="bank-charts-footnote">هذه مقارنة حالية بين البنوك، وليست مقارنة السنوات 2021–2025. البيانات الناقصة أو الربحية الصفرية تظهر «—»، ولا يُعرض مكرر عددي للبنك الخاسر. لمعرفة تاريخ السعر ومصدر الربحية، اختر البنك من الأزرار أعلى الصفحة.</p></article>`;
}

export function fitCurrentPEComparison(container, records) {
  const canvas = container?.querySelector('[data-current-pe-canvas]');
  if (!canvas) return;
  const width = Math.max(1050, Math.round(canvas.clientWidth));
  const signature = JSON.stringify(records.map(record => [record.symbol, record.pe, record.name]));
  if (canvas.dataset.plotWidth === String(width) && canvas.dataset.signature === signature) return;
  canvas.innerHTML = renderChartSvg(currentPEChartModel(records), width);
  canvas.dataset.plotWidth = String(width);
  canvas.dataset.signature = signature;
}
