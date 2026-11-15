// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './realestate-metrics.mjs?v=realestate-value-labels-20261106-v12';
import { renderRealEstateCharts, fitRealEstateCharts, getChartOptions } from './realestate-charts.mjs?v=realestate-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=sector-switch-20261115';
initSectorResultsPage({ slug: 'realestate', sectorName: 'العقارات', metrics, charts: { render: renderRealEstateCharts, fit: fitRealEstateCharts, options: getChartOptions }, version: 'realestate-quarterly-20261114' });
