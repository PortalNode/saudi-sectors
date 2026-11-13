// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './retail-metrics.mjs?v=retail-value-labels-20261106-v12';
import { renderRetailCharts, fitRetailCharts, getChartOptions } from './retail-charts.mjs?v=retail-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'retail', sectorName: 'تجارة و تجزئة', metrics, charts: { render: renderRetailCharts, fit: fitRetailCharts, options: getChartOptions }, version: 'retail-quarterly-20261113' });
