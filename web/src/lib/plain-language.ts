/** Remove week/batch framing from user-visible agent copy. */
export function sanitizeAgentCopy(text: string): string {
  return text
    .replace(/\bweek\s+(\d+)\b/gi, 'step $1')
    .replace(/\bthis week('s)?\b/gi, 'upcoming')
    .replace(/\bnext week('s)?\b/gi, 'next')
    .replace(/\bweek-by-week\b/gi, 'continuously')
    .replace(/\b8-week\b/gi, 'ongoing')
    .replace(/\bweekly\b/gi, 'ongoing')
    .replace(/\bweek block\b/gi, 'round of tasks')
    .replace(/\bbatch\s+(\d+)\b/gi, 'round $1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
