// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './industrial-metrics.mjs?v=industrial-value-labels-20261106-v12';
import { renderIndustrialCharts, fitIndustrialCharts, getChartOptions } from './industrial-charts.mjs?v=industrial-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'industrial', sectorName: 'الصناعات التحويلية', metrics, charts: { render: renderIndustrialCharts, fit: fitIndustrialCharts, options: getChartOptions }, version: 'industrial-quarterly-20261114' });
