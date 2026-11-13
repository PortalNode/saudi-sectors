// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './exchange-metrics.mjs?v=exchange-value-labels-20261106-v12';
import { renderExchangeCharts, fitExchangeCharts, getChartOptions } from './exchange-charts.mjs?v=exchange-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'exchange', sectorName: 'أسواق الاوراق المالية', metrics, charts: { render: renderExchangeCharts, fit: fitExchangeCharts, options: getChartOptions }, version: 'exchange-quarterly-20261113' });
