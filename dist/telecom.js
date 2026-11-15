// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './telecom-metrics.mjs?v=telecom-value-labels-20261106-v9';
import { renderTelecomCharts, fitTelecomCharts, getChartOptions } from './telecom-charts.mjs?v=telecom-value-labels-20261106-v9';
import { initSectorResultsPage } from './sector-results-page.mjs?v=mcap-order-20261115';
initSectorResultsPage({ slug: 'telecom', sectorName: 'الاتصالات', metrics, charts: { render: renderTelecomCharts, fit: fitTelecomCharts, options: getChartOptions }, version: 'telecom-quarterly-20261114' });
