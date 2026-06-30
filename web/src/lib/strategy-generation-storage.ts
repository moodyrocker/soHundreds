const STORAGE_KEY = 'hundres:strategy-generation';

export type PendingStrategyGeneration = {
  organizationId: string;
  strategyId: string;
  goal: string;
  startedAt: string;
};

export function readPendingGeneration(): PendingStrategyGeneration | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingStrategyGeneration;
    if (!parsed.organizationId || !parsed.strategyId || !parsed.goal) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePendingGeneration(pending: PendingStrategyGeneration): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
}

export function clearPendingGeneration(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function pendingForOrganization(organizationId: string): PendingStrategyGeneration | null {
  const pending = readPendingGeneration();
  if (!pending || pending.organizationId !== organizationId) return null;
  return pending;
}
