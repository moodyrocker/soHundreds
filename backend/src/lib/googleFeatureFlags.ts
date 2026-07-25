/** Kill switch for Google Ads (OAuth, MCP, campaign creation). GA4 stays available. */
export function isGoogleAdsEnabled(): boolean {
  const raw = process.env.GOOGLE_ADS_ENABLED?.trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }
  return false;
}
