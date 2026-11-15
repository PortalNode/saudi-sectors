// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './healthservices-metrics.mjs?v=healthservices-value-labels-20261106-v12';
import { renderHealthCharts, fitHealthCharts, getChartOptions } from './healthservices-charts.mjs?v=healthservices-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=mcap-order-20261115';
initSectorResultsPage({ slug: 'healthservices', sectorName: 'خدمات الرعاية الصحية', metrics, charts: { render: renderHealthCharts, fit: fitHealthCharts, options: getChartOptions }, version: 'healthservices-quarterly-20261114' });
