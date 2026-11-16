// Page logic lives in sector-results-page.mjs (shared by all sector pages); Derayah's own line items come from PERIOD_SPEC.
import * as metrics from './financial-services-metrics.mjs?v=financial-services-20261115b';
import { renderFinancialServicesCharts, fitFinancialServicesCharts, getChartOptions } from './financial-services-charts.mjs?v=financial-services-20261115b';
import { initSectorResultsPage } from './sector-results-page.mjs?v=no-notes-20261116';
initSectorResultsPage({ slug: 'financial-services', sectorName: 'الخدمات المالية', metrics, charts: { render: renderFinancialServicesCharts, fit: fitFinancialServicesCharts, options: getChartOptions }, version: 'financial-services-20261115b' });
