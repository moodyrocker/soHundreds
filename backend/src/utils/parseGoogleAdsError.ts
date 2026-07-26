type ParsedAdsError = {
  code: string | null;
  message: string;
  userMessage: string;
};

const USER_MESSAGES: Record<string, string> = {
  DEVELOPER_TOKEN_NOT_APPROVED:
    'Google has not approved your developer token for production accounts yet. Plans will use your other connected sources until approval.',
  DEVELOPER_TOKEN_PROHIBITED:
    'This Google Ads developer token cannot access this account. Check token status in Google Ads API Center.',
  CUSTOMER_NOT_ENABLED:
    'This Google Ads customer account is not enabled. Enable it in Google Ads or pick a different account.',
  USER_PERMISSION_DENIED:
    'Your Google account does not have permission to read this Ads customer. Check account access in Google Ads.',
  OAUTH_TOKEN_INVALID:
    'Google Ads authorization expired or was revoked. Disconnect and reconnect Google Ads on Integrations.',
  OAUTH_TOKEN_EXPIRED:
    'Google Ads authorization expired. Disconnect and reconnect Google Ads on Integrations.',
  UNSUPPORTED_VERSION:
    'Google Ads API version is outdated. Set GOOGLE_ADS_API_VERSION=v21 or newer in .env and rebuild the API.',
};

export function parseGoogleAdsError(body: string, status?: number): ParsedAdsError {
  let code: string | null = null;
  let apiMessage = body.slice(0, 400);

  try {
    const json = JSON.parse(body) as {
      error?: {
        message?: string;
        details?: Array<{
          errors?: Array<{
            message?: string;
            errorCode?: Record<string, string>;
          }>;
        }>;
      };
    };

    if (json.error?.message) {
      apiMessage = json.error.message;
    }

    for (const detail of json.error?.details ?? []) {
      for (const err of detail.errors ?? []) {
        const errorCode = err.errorCode ?? {};
        const found = Object.values(errorCode).find(Boolean);
        if (found) {
          code = found;
          if (err.message) apiMessage = err.message;
          break;
        }
      }
      if (code) break;
    }
  } catch {
    // keep raw body snippet
  }

  if (!code && status === 403 && body.includes('DEVELOPER_TOKEN_NOT_APPROVED')) {
    code = 'DEVELOPER_TOKEN_NOT_APPROVED';
  }

  const userMessage =
    (code && USER_MESSAGES[code]) ||
    (status === 401
      ? 'Google Ads authorization failed. Disconnect and reconnect on Integrations.'
      : status === 403
        ? 'Google Ads denied access to campaign data. Check developer token and account permissions.'
        : 'Google Ads campaign data could not be loaded. Try reconnecting on Integrations.');

  return { code, message: apiMessage, userMessage };
}
