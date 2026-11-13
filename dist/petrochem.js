// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './petrochem-metrics.mjs?v=petrochem-value-labels-20261106-v12';
import { renderPetrochemCharts, fitPetrochemCharts, getChartOptions } from './petrochem-charts.mjs?v=petrochem-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'petrochem', sectorName: 'البتروكيماويات', metrics, charts: { render: renderPetrochemCharts, fit: fitPetrochemCharts, options: getChartOptions }, version: 'petrochem-quarterly-20261113' });
