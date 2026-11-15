// Page logic lives in sector-results-page.mjs (shared by all sector pages); finance's own line items come from finance-metrics.mjs.
import * as metrics from './finance-metrics.mjs?v=finance-20261115';
import { renderFinanceCharts, fitFinanceCharts, getChartOptions } from './finance-charts.mjs?v=finance-20261115';
import { initSectorResultsPage } from './sector-results-page.mjs?v=quarterly-20261115';
initSectorResultsPage({ slug: 'finance', sectorName: 'التمويل', metrics, charts: { render: renderFinanceCharts, fit: fitFinanceCharts, options: getChartOptions }, version: 'finance-quarterly-20261115' });
