// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './sports-metrics.mjs?v=sports-value-labels-20261106-v12';
import { renderSportsCharts, fitSportsCharts, getChartOptions } from './sports-charts.mjs?v=sports-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=no-notes-20261116';
initSectorResultsPage({ slug: 'sports', sectorName: 'المراكز الرياضية', metrics, charts: { render: renderSportsCharts, fit: fitSportsCharts, options: getChartOptions }, version: 'sports-quarterly-20261114' });
