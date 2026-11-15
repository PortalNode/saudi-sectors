// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './education-metrics.mjs?v=education-value-labels-20261106-v12';
import { renderEducationCharts, fitEducationCharts, getChartOptions } from './education-charts.mjs?v=education-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=mcap-order-20261115';
initSectorResultsPage({ slug: 'education', sectorName: 'التعليم و التدريب', metrics, charts: { render: renderEducationCharts, fit: fitEducationCharts, options: getChartOptions }, version: 'education-quarterly-20261114' });
