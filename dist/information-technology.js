// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './information-technology-metrics.mjs?v=information-technology-value-labels-20261106-v12';
import { renderInformationTechnologyCharts, fitInformationTechnologyCharts, getChartOptions } from './information-technology-charts.mjs?v=information-technology-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=latest-ytd-20261116';
initSectorResultsPage({ slug: 'information-technology', sectorName: 'تقنية المعلومات', metrics, charts: { render: renderInformationTechnologyCharts, fit: fitInformationTechnologyCharts, options: getChartOptions }, version: 'information-technology-quarterly-20261115' });
