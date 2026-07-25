/** Minimum completed actions before a pattern is injected into planning prompts. */
export function learningMinSampleSize(): number {
  const raw = process.env.LEARNING_MIN_SAMPLE_SIZE?.trim();
  const n = raw ? Number(raw) : 3;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

/** Outcomes older than this many days are excluded from pattern aggregation (decay). */
export function learningDecayDays(): number {
  const raw = process.env.LEARNING_DECAY_DAYS?.trim();
  const n = raw ? Number(raw) : 90;
  return Number.isFinite(n) && n >= 7 ? Math.floor(n) : 90;
}

/** Max patterns injected into a single planning prompt. */
export function learningTopPatterns(): number {
  const raw = process.env.LEARNING_TOP_PATTERNS?.trim();
  const n = raw ? Number(raw) : 5;
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 12) : 5;
}
