import type { GoalTarget, PlanDocument } from '../types/plan.js';
import {
  parseGaSnapshotText,
  parseNumeric,
  parseShopifySnapshotText,
  pickMetricValue,
  resolveMetricKey,
  resolveTargetValue,
  type MetricKey,
} from '../utils/metricParsing.js';
import { GoogleAnalyticsSnapshotService } from './googleAnalyticsSnapshotService.js';
import { ShopifySnapshotService } from './shopifySnapshotService.js';

export type GoalProgressStatus = 'met' | 'on_track' | 'behind' | 'unknown';

export type GoalProgressResult = {
  status: GoalProgressStatus;
  goalMet: boolean;
  metricKey: MetricKey;
  currentValue: number | null;
  baselineValue: number | null;
  targetValue: number | null;
  progressPct: number | null;
  summary: string;
  dataSources: string[];
};

export class GoalProgressService {
  private ga = new GoogleAnalyticsSnapshotService();
  private shopify = new ShopifySnapshotService();

  async checkProgress(
    organizationId: string,
    plan: PlanDocument,
    goalLine: string,
    priorBaseline?: number | null
  ): Promise<GoalProgressResult> {
    const goalTarget = plan.summary.goalTarget;
    if (!goalTarget) {
      return {
        status: 'unknown',
        goalMet: false,
        metricKey: 'revenue',
        currentValue: null,
        baselineValue: null,
        targetValue: null,
        progressPct: null,
        summary: 'No measurable target defined on this plan yet.',
        dataSources: [],
      };
    }

    const metricKey = resolveMetricKey(goalTarget.metric, goalTarget.unit);
    const [gaSnap, shopSnap] = await Promise.all([
      this.ga.fetchSnapshot(organizationId),
      this.shopify.fetchSnapshot(organizationId),
    ]);

    const gaMetrics = gaSnap?.text ? parseGaSnapshotText(gaSnap.text) : {};
    const shopMetrics = shopSnap?.text ? parseShopifySnapshotText(shopSnap.text) : {};
    const { value: currentValue, source } = pickMetricValue(metricKey, shopMetrics, gaMetrics);

    const dataSources = [source, gaSnap ? 'google_analytics' : null, shopSnap ? 'shopify' : null].filter(
      (s, i, arr): s is string => Boolean(s) && arr.indexOf(s) === i
    );

    let baselineValue = parseNumeric(goalTarget.baseline) ?? priorBaseline ?? null;
    if (baselineValue === null && currentValue !== null && plan.summary.weekCount <= 1) {
      baselineValue = currentValue;
    }

    let targetValue = baselineValue !== null ? resolveTargetValue(baselineValue, goalTarget.target, goalLine) : parseNumeric(goalTarget.target);

    if (targetValue === null && baselineValue !== null) {
      const pct = parseNumeric(goalTarget.target);
      if (pct !== null && pct <= 200) {
        targetValue = baselineValue * (1 + pct / 100);
      }
    }

    if (currentValue === null || baselineValue === null || targetValue === null) {
      return {
        status: 'unknown',
        goalMet: false,
        metricKey,
        currentValue,
        baselineValue,
        targetValue,
        progressPct: null,
        summary: this.buildUnknownSummary(goalTarget, metricKey, dataSources),
        dataSources,
      };
    }

    const range = targetValue - baselineValue;
    const progressPct =
      Math.abs(range) < 0.0001
        ? currentValue >= targetValue
          ? 100
          : 0
        : Math.round(((currentValue - baselineValue) / range) * 1000) / 10;

    const goalMet = currentValue >= targetValue;
    let status: GoalProgressStatus = 'unknown';
    if (goalMet) {
      status = 'met';
    } else if (progressPct >= 50) {
      status = 'on_track';
    } else {
      status = 'behind';
    }

    const unit = goalTarget.unit ? ` ${goalTarget.unit}` : '';
    const summary = goalMet
      ? `${goalTarget.metric} reached ${this.formatValue(currentValue, metricKey)} (target ${this.formatValue(targetValue, metricKey)}${unit}). Goal met.`
      : `${goalTarget.metric} at ${this.formatValue(currentValue, metricKey)} — ${progressPct}% toward target ${this.formatValue(targetValue, metricKey)}${unit}.`;

    return {
      status,
      goalMet,
      metricKey,
      currentValue,
      baselineValue,
      targetValue,
      progressPct,
      summary,
      dataSources,
    };
  }

  private formatValue(value: number, key: MetricKey): string {
    if (key === 'revenue') return `$${value.toFixed(2)}`;
    if (key === 'engagementRate') return `${value.toFixed(1)}%`;
    return String(Math.round(value));
  }

  private buildUnknownSummary(
    goalTarget: GoalTarget,
    metricKey: MetricKey,
    dataSources: string[]
  ): string {
    if (!dataSources.length) {
      return `Connect Google Analytics or Shopify to measure ${goalTarget.metric}.`;
    }
    return `Could not read ${metricKey} from connected sources yet — keep running this week's actions.`;
  }
}
