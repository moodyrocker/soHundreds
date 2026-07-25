'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { AutopilotActivityRecord } from '@/lib/autopilot-activity';
import {
  ACTIVITY_LOG_FILTERS,
  activityLogBucket,
  activityMatchesLogFilter,
  activityTags,
  dedupeActivities,
  humanActivityLine,
  linkifyActivityParts,
  logEntryMeta,
  sortActivitiesNewestFirst,
  type ActivityLogFilter,
} from '@/lib/activity-human';
import { formatDateTime } from '@/lib/format-datetime';

type Props = {
  activities: AutopilotActivityRecord[];
  running: boolean;
  limit?: number;
  /** Collapse duplicate action+step rows. Off for full Activity history. */
  dedupe?: boolean;
  /** When false, render nothing if there are no log lines. */
  showWhenEmpty?: boolean;
  /** Hide the "Full history →" link (e.g. already on /activity). */
  hideHistoryLink?: boolean;
  /** Show status filter chips above the table. */
  showFilters?: boolean;
  /** Initial filter — Activity page defaults to results so planning noise is hidden. */
  defaultFilter?: ActivityLogFilter;
};

export function AgentLogsPanel({
  activities,
  running,
  limit = 12,
  dedupe = true,
  showWhenEmpty = false,
  hideHistoryLink = false,
  showFilters = false,
  defaultFilter = 'all',
}: Props) {
  const [filter, setFilter] = useState<ActivityLogFilter>(defaultFilter);

  const counts = useMemo(() => {
    const prepared = dedupe ? dedupeActivities(activities) : activities;
    const next: Record<ActivityLogFilter, number> = {
      all: prepared.length,
      results: 0,
      published: 0,
      done: 0,
      planning: 0,
      working: 0,
      errors: 0,
    };
    for (const item of prepared) {
      const bucket = activityLogBucket(item);
      if (bucket === 'published' || bucket === 'done') next.results += 1;
      if (
        bucket === 'published' ||
        bucket === 'done' ||
        bucket === 'planning' ||
        bucket === 'working' ||
        bucket === 'errors'
      ) {
        next[bucket] += 1;
      }
    }
    return next;
  }, [activities, dedupe]);

  const { lines, total, filteredTotal } = useMemo(() => {
    const prepared = dedupe ? dedupeActivities(activities) : [...activities];
    const filtered = prepared.filter((item) => activityMatchesLogFilter(item, filter));
    const sorted = sortActivitiesNewestFirst(filtered);
    return {
      lines: sorted.slice(0, limit),
      total: prepared.length,
      filteredTotal: sorted.length,
    };
  }, [activities, dedupe, filter, limit]);

  if (!activities.length && !running) {
    if (!showWhenEmpty) return null;
    return (
      <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
        <p className="t-dim" style={{ margin: 0, fontSize: 13 }}>
          No agent activity yet. Start the agent from the dashboard to see logs here.
        </p>
      </div>
    );
  }

  return (
    <div className="card activity-log-card">
      <div className="activity-log-header">
        <div className="h-eyebrow" style={{ margin: 0 }}>
          Agent logs
          {filteredTotal > 0 ? (
            <span className="t-mute" style={{ marginLeft: 8, fontWeight: 400, letterSpacing: 0 }}>
              {lines.length < filteredTotal
                ? `${lines.length} of ${filteredTotal}`
                : `${filteredTotal}`}
              {filter !== 'all' && total !== filteredTotal ? ` · ${total} total` : ''}
            </span>
          ) : null}
        </div>
        {!hideHistoryLink ? (
          <Link href="/activity" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }}>
            Full history →
          </Link>
        ) : null}
      </div>

      {showFilters ? (
        <div className="activity-log-filters" role="group" aria-label="Filter logs">
          {ACTIVITY_LOG_FILTERS.map((item) => {
            const count = counts[item.id];
            const empty = item.id !== 'all' && count === 0;
            return (
              <button
                key={item.id}
                type="button"
                className={`visual-filter${filter === item.id ? ' active' : ''}`}
                disabled={empty && filter !== item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <span className="activity-log-filter-count">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        className={`activity-log-scroll${hideHistoryLink ? ' activity-log-scroll--tall' : ''}`}
      >
        {lines.length === 0 && running ? (
          <p className="t-dim" style={{ margin: 0, padding: '12px 14px', fontSize: 13 }}>
            Starting…
          </p>
        ) : lines.length === 0 ? (
          <p className="t-dim" style={{ margin: 0, padding: '12px 14px', fontSize: 13 }}>
            {filter === 'all'
              ? 'No agent activity yet.'
              : `No ${ACTIVITY_LOG_FILTERS.find((f) => f.id === filter)?.label.toLowerCase() ?? 'matching'} logs yet.`}{' '}
            {filter !== 'all' ? (
              <button
                type="button"
                className="activity-log-filter-reset"
                onClick={() => setFilter('all')}
              >
                Show all
              </button>
            ) : null}
          </p>
        ) : (
          <table className="activity-log-table">
            <thead>
              <tr>
                <th className="activity-log-th activity-log-th--tags">Channel</th>
                <th className="activity-log-th activity-log-th--status">Status</th>
                <th className="activity-log-th activity-log-th--msg">What happened</th>
                <th className="activity-log-th activity-log-th--time">When</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((item, index) => {
                const meta = logEntryMeta(item);
                const tags = activityTags(item);
                return (
                  <tr
                    key={item.id}
                    className={
                      index % 2 === 0 ? 'activity-log-row activity-log-row--odd' : 'activity-log-row activity-log-row--even'
                    }
                  >
                    <td className="activity-log-td activity-log-td--tags">
                      <div className="activity-tag-stack">
                        {tags.map((tag) => (
                          <span key={tag.id} className={`activity-tag ${tag.className}`}>
                            {tag.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="activity-log-td activity-log-td--status">
                      <span
                        className="activity-status"
                        style={{
                          borderLeftColor: meta.borderColor,
                          color: meta.textColor,
                        }}
                      >
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td className="activity-log-td activity-log-td--msg">
                      <p className="activity-log-msg">
                        {linkifyActivityParts(humanActivityLine(item)).map((part, i) =>
                          part.type === 'link' ? (
                            <a
                              key={`${item.id}-l-${i}`}
                              href={part.value}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="activity-log-link"
                            >
                              {part.value}
                            </a>
                          ) : (
                            <span key={`${item.id}-t-${i}`}>{part.value}</span>
                          )
                        )}
                      </p>
                    </td>
                    <td className="activity-log-td activity-log-td--time">
                      <time className="activity-log-time" dateTime={item.createdAt}>
                        {formatDateTime(item.createdAt)}
                      </time>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
