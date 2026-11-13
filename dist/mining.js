// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './mining-metrics.mjs?v=mining-value-labels-20261106-v5';
import { renderMiningCharts, fitMiningCharts, getChartOptions } from './mining-charts.mjs?v=mining-value-labels-20261106-v5';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'mining', sectorName: 'التعدين والمعادن', metrics, charts: { render: renderMiningCharts, fit: fitMiningCharts, options: getChartOptions }, version: 'mining-quarterly-20261113' });
