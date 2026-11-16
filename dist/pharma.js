// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './pharma-metrics.mjs?v=pharma-value-labels-20261106-v12';
import { renderPharmaCharts, fitPharmaCharts, getChartOptions } from './pharma-charts.mjs?v=pharma-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=latest-ytd-20261116';
initSectorResultsPage({ slug: 'pharma', sectorName: 'موردي الادوية', metrics, charts: { render: renderPharmaCharts, fit: fitPharmaCharts, options: getChartOptions }, version: 'pharma-quarterly-20261114' });
