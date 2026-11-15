// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './transport-metrics.mjs?v=transport-value-labels-20261106-v12';
import { renderTransportCharts, fitTransportCharts, getChartOptions } from './transport-charts.mjs?v=transport-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=sector-switch-20261115';
initSectorResultsPage({ slug: 'transport', sectorName: 'النقل', metrics, charts: { render: renderTransportCharts, fit: fitTransportCharts, options: getChartOptions }, version: 'transport-quarterly-20261114' });
