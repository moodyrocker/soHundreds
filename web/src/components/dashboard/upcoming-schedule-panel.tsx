'use client';

import Link from 'next/link';
import type { UpcomingScheduleSummary } from '@/lib/upcoming-schedule';

type Props = {
  schedule: UpcomingScheduleSummary | null;
};

export function UpcomingSchedulePanel({ schedule }: Props) {
  if (!schedule) return null;

  return (
    <div className="card upcoming-schedule-card">
      <div className="upcoming-schedule-header">
        <div>
          <div className="h-eyebrow" style={{ margin: 0 }}>
            Upcoming
          </div>
          <p className="upcoming-schedule-next">{schedule.nextRunLabel}</p>
          <p className="t-mute" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Week {schedule.weekNumber}
            {schedule.remainingCount > 0
              ? ` · ${schedule.remainingCount} action${schedule.remainingCount === 1 ? '' : 's'} left`
              : ' · week queue clear'}
          </p>
        </div>
        <Link href="/plan" className="btn btn-ghost" style={{ fontSize: 12 }}>
          Full plan →
        </Link>
      </div>

      {schedule.items.length > 0 ? (
        <ul className="upcoming-schedule-list">
          {schedule.items.map((item) => (
            <li key={item.actionId} className="upcoming-schedule-item">
              <span className="upcoming-schedule-channel">{item.channel}</span>
              <span className="upcoming-schedule-title">{item.title}</span>
              <span className="upcoming-schedule-when">
                {item.status === 'in_progress' ? 'In progress' : item.whenLabel}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-dim" style={{ margin: '12px 0 0', fontSize: 14 }}>
          Nothing queued right now. Completed posts appear in the log below.
        </p>
      )}
    </div>
  );
}
