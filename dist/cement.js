// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './cement-metrics.mjs?v=cement-value-labels-20261106-v12';
import { renderCementCharts, fitCementCharts, getChartOptions } from './cement-charts.mjs?v=cement-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'cement', sectorName: 'الاسمنت', metrics, charts: { render: renderCementCharts, fit: fitCementCharts, options: getChartOptions }, version: 'cement-quarterly-20261113' });
