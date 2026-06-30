/** Supabase auth errors that mean cookies should be cleared — not transient network failures. */
export function shouldClearAuthSession(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  return (
    code === 'refresh_token_not_found' ||
    code === 'invalid_refresh_token' ||
    code === 'session_not_found' ||
    code === 'user_not_found'
  );
}
