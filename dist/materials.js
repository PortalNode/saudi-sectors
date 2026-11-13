// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './materials-metrics.mjs?v=materials-value-labels-20261106-v12';
import { renderHealthCharts, fitHealthCharts, getChartOptions } from './materials-charts.mjs?v=materials-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'materials', sectorName: 'المواد الاساسية', metrics, charts: { render: renderHealthCharts, fit: fitHealthCharts, options: getChartOptions }, version: 'materials-quarterly-20261113' });
