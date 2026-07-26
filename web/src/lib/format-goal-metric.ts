/** Mirrors backend GoalProgressService.formatValue — single display format for goal metrics. */
export function formatGoalMetricValue(
  value: number | null | undefined,
  metricKey: string
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (metricKey === 'revenue') return `$${value.toFixed(2)}`;
  if (metricKey === 'engagementRate') return `${value.toFixed(1)}%`;
  return String(Math.round(value));
}

export function formatGoalUnit(unit: string | null | undefined): string {
  return unit?.trim() ? ` ${unit.trim()}` : '';
}
