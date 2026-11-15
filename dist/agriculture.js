// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './agriculture-metrics.mjs?v=agriculture-value-labels-20261106-v12';
import { renderAgricultureCharts, fitAgricultureCharts, getChartOptions } from './agriculture-charts.mjs?v=agriculture-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=mcap-order-20261115';
initSectorResultsPage({ slug: 'agriculture', sectorName: 'الزراعة', metrics, charts: { render: renderAgricultureCharts, fit: fitAgricultureCharts, options: getChartOptions }, version: 'agriculture-quarterly-20261114' });
