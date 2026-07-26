const PENDING_SIGNUP_KEY = 'hundres:pending_signup';

export interface PendingSignup {
  email: string;
  organizationName: string;
  fullName?: string;
}

export function savePendingSignup(data: PendingSignup): void {
  localStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(data));
}

export function readPendingSignup(): PendingSignup | null {
  try {
    const raw = localStorage.getItem(PENDING_SIGNUP_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingSignup;
  } catch {
    return null;
  }
}

export function clearPendingSignup(): void {
  localStorage.removeItem(PENDING_SIGNUP_KEY);
}
