// Page logic lives in sector-results-page.mjs (shared by all sector pages); the REITs' own line items come from reits-metrics.mjs.
import * as metrics from './reits-metrics.mjs?v=reits-20261115b';
import { renderReitsCharts, fitReitsCharts, getChartOptions } from './reits-charts.mjs?v=reits-20261115b';
import { initSectorResultsPage } from './sector-results-page.mjs?v=latest-ytd-20261116';
// Annual results only for now: no quarterly file, so the period selector stays hidden.
initSectorResultsPage({ slug: 'reits', sectorName: 'الصناديق العقارية المتداولة', metrics, charts: { render: renderReitsCharts, fit: fitReitsCharts, options: getChartOptions }, version: 'reits-20261115b', quarterly: false });
