// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './oilgas-metrics.mjs?v=oilgas-value-labels-20261106-v12';
import { renderOilgasCharts, fitOilgasCharts, getChartOptions } from './oilgas-charts.mjs?v=oilgas-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'oilgas', sectorName: 'النفط و الغاز', metrics, charts: { render: renderOilgasCharts, fit: fitOilgasCharts, options: getChartOptions }, version: 'oilgas-quarterly-20261113' });
