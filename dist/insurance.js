// Page logic lives in sector-results-page.mjs (shared by all sector pages); insurance's own line items come from insurance-metrics.mjs.
import * as metrics from './insurance-metrics.mjs?v=insurance-20261115';
import { renderInsuranceCharts, fitInsuranceCharts, getChartOptions } from './insurance-charts.mjs?v=insurance-20261115';
import { initSectorResultsPage } from './sector-results-page.mjs?v=no-notes-20261116';
initSectorResultsPage({ slug: 'insurance', sectorName: 'التأمين', metrics, charts: { render: renderInsuranceCharts, fit: fitInsuranceCharts, options: getChartOptions }, version: 'insurance-quarterly-20261115' });
