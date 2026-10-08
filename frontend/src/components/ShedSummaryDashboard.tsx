import React from 'react';
import { ShedDashboard, ShedDashboardProps } from './ShedDashboard';

/**
 * ShedSummaryDashboard: Comprehensive Shed-Wise Aggregated Dashboard
 * Featuring 5 KPI Cards, Pen Comparative Table, Combined Distribution Histogram,
 * and Weeks 1-23 Seasonal Growth Curve.
 */
export const ShedSummaryDashboard: React.FC<ShedDashboardProps> = (props) => {
  return <ShedDashboard {...props} />;
};

export default ShedSummaryDashboard;
