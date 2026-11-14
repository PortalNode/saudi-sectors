// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './business-services-metrics.mjs?v=business-services-value-labels-20261106-v12';
import { renderBusinessServicesCharts, fitBusinessServicesCharts, getChartOptions } from './business-services-charts.mjs?v=business-services-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261113';
initSectorResultsPage({ slug: 'business-services', sectorName: 'خدمات الاعمال', metrics, charts: { render: renderBusinessServicesCharts, fit: fitBusinessServicesCharts, options: getChartOptions }, version: 'business-services-quarterly-20261114' });
