// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './health-metrics.mjs?v=health-value-labels-20261106-v12';
import { renderHealthCharts, fitHealthCharts, getChartOptions } from './health-charts.mjs?v=health-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=latest-ytd-20261116';
initSectorResultsPage({ slug: 'health', sectorName: 'الرعاية الصحية', metrics, charts: { render: renderHealthCharts, fit: fitHealthCharts, options: getChartOptions }, version: 'health-quarterly-20261114' });
