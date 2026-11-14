// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './multi-metrics.mjs?v=multi-value-labels-20261106-v12';
import { renderMultiCharts, fitMultiCharts, getChartOptions } from './multi-charts.mjs?v=multi-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'multi', sectorName: 'متعددة الأنشطة', metrics, charts: { render: renderMultiCharts, fit: fitMultiCharts, options: getChartOptions }, version: 'multi-quarterly-20261114' });
