// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './food-metrics.mjs?v=food-value-labels-20261106-v12';
import { renderFoodCharts, fitFoodCharts, getChartOptions } from './food-charts.mjs?v=food-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=latest-ytd-20261116';
initSectorResultsPage({ slug: 'food', sectorName: 'الأغذية والمشروبات', metrics, charts: { render: renderFoodCharts, fit: fitFoodCharts, options: getChartOptions }, version: 'food-quarterly-20261114' });
