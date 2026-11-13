// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './utilities-metrics.mjs?v=utilities-value-labels-20261106-v11';
import { renderUtilitiesCharts, fitUtilitiesCharts, getChartOptions } from './utilities-charts.mjs?v=utilities-value-labels-20261106-v11';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'utilities', sectorName: 'المرافق والطاقة', metrics, charts: { render: renderUtilitiesCharts, fit: fitUtilitiesCharts, options: getChartOptions }, version: 'utilities-quarterly-20261113' });
