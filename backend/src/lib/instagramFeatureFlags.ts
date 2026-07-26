/** Kill switch for Instagram image + caption preview assist (no auto-publish). */
export function isInstagramImagePreviewEnabled(): boolean {
  const raw = process.env.INSTAGRAM_IMAGE_PREVIEW?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}
