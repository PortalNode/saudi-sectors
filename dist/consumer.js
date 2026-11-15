// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './consumer-metrics.mjs?v=consumer-value-labels-20261106-v12';
import { renderConsumerCharts, fitConsumerCharts, getChartOptions } from './consumer-charts.mjs?v=consumer-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=mcap-order-20261115';
initSectorResultsPage({ slug: 'consumer', sectorName: 'السلع الاستهلاكية', metrics, charts: { render: renderConsumerCharts, fit: fitConsumerCharts, options: getChartOptions }, version: 'consumer-quarterly-20261114' });
