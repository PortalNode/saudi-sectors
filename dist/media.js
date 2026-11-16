// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './media-metrics.mjs?v=media-value-labels-20261106-v12';
import { renderMediaCharts, fitMediaCharts, getChartOptions } from './media-charts.mjs?v=media-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=no-notes-20261116';
initSectorResultsPage({ slug: 'media', sectorName: 'وسائل الاعلام', metrics, charts: { render: renderMediaCharts, fit: fitMediaCharts, options: getChartOptions }, version: 'media-quarterly-20261115' });
