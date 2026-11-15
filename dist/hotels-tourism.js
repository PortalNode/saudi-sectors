// Page logic lives in sector-results-page.mjs (shared by all sector pages).
import * as metrics from './hotels-tourism-metrics.mjs?v=hotels-tourism-value-labels-20261106-v12';
import { renderHotelsTourismCharts, fitHotelsTourismCharts, getChartOptions } from './hotels-tourism-charts.mjs?v=hotels-tourism-value-labels-20261106-v12';
import { initSectorResultsPage } from './sector-results-page.mjs?v=sector-switch-20261115';
initSectorResultsPage({ slug: 'hotels-tourism', sectorName: 'الفنادق و السياحة', metrics, charts: { render: renderHotelsTourismCharts, fit: fitHotelsTourismCharts, options: getChartOptions }, version: 'hotels-tourism-quarterly-20261114' });
