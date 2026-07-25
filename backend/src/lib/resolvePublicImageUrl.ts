import { isUnsplashConfigured, unsplashGetPhoto, unsplashTrackDownload } from './unsplashClient.js';

const IMAGE_EXT = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?|#|$)/i;

const DIRECT_IMAGE_HOSTS = [
  'images.unsplash.com',
  'plus.unsplash.com',
  'cdn.shopify.com',
  'img.shopify.com',
  'i.ibb.co',
  'i.imgur.com',
  'res.cloudinary.com',
  'images.pexels.com',
];

function looksLikeDirectImageUrl(url: URL): boolean {
  if (IMAGE_EXT.test(url.pathname)) return true;
  const host = url.hostname.toLowerCase();
  return DIRECT_IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function extractUnsplashPhotoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host !== 'unsplash.com' && host !== 'www.unsplash.com') return null;
  const match = url.pathname.match(/^\/photos\/([^/?#]+)/i);
  if (!match) return null;
  const slug = decodeURIComponent(match[1]);
  const parts = slug.split('-').filter(Boolean);
  return parts[parts.length - 1] || null;
}

function normalizeDropboxUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host !== 'www.dropbox.com' && host !== 'dropbox.com' && host !== 'dl.dropboxusercontent.com') {
    return null;
  }
  if (host === 'dl.dropboxusercontent.com') return url.toString();
  url.searchParams.set('raw', '1');
  url.searchParams.delete('dl');
  return url.toString();
}

function normalizeGoogleDriveUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host !== 'drive.google.com' && host !== 'www.drive.google.com') return null;
  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  const id = fileMatch?.[1] || url.searchParams.get('id');
  if (!id) return null;
  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`;
}

async function headContentType(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'HundresBrandVisuals/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return res.headers.get('content-type');
  } catch {
    return null;
  }
}

async function resolveUnsplashPage(photoId: string): Promise<string> {
  if (!isUnsplashConfigured()) {
    throw new Error(
      'That looks like an Unsplash photo page, not a direct image link. Paste the image address (images.unsplash.com/…) or configure UNSPLASH_ACCESS_KEY so Hundres can resolve it.'
    );
  }
  const photo = await unsplashGetPhoto(photoId);
  try {
    await unsplashTrackDownload(photo.links.download_location);
  } catch {
    // Tracking is best-effort; still keep the resolved image URL.
  }
  return photo.urls.regular;
}

/**
 * Turn a user-pasted HTTPS link into a URL that browsers / Instagram can load as an image.
 * Accepts direct image CDNs, and resolves Unsplash photo pages + common share links.
 */
export async function resolvePublicImageUrl(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (!/^https:\/\//i.test(trimmed)) {
    throw new Error('Image URL must be a public HTTPS link');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Image URL is not valid');
  }

  const unsplashId = extractUnsplashPhotoId(url);
  if (unsplashId) {
    return (await resolveUnsplashPage(unsplashId)).slice(0, 2000);
  }

  const dropbox = normalizeDropboxUrl(new URL(url.toString()));
  if (dropbox) {
    url = new URL(dropbox);
  }

  const drive = normalizeGoogleDriveUrl(url);
  if (drive) {
    url = new URL(drive);
  }

  const candidate = url.toString().slice(0, 2000);

  if (looksLikeDirectImageUrl(url)) {
    return candidate;
  }

  const contentType = await headContentType(candidate);
  if (contentType?.toLowerCase().startsWith('image/')) {
    return candidate;
  }

  throw new Error(
    'That link is not a direct image URL (browsers need a .jpg/.png/CDN file link, not a webpage). On Unsplash use “Copy image address”, or paste a Shopify CDN / ImgBB / Cloudinary link.'
  );
}
