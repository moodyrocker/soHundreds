import {
  isUnsplashConfigured,
  unsplashGetPhoto,
  unsplashGetRandomPhotos,
  unsplashSearchPhotos,
  unsplashTrackDownload,
  type UnsplashPhoto,
} from '../lib/unsplashClient.js';

export type UnsplashPhotoResult = {
  id: string;
  width: number;
  height: number;
  alt: string;
  description: string | null;
  urls: {
    regular: string;
    small: string;
    thumb: string;
  };
  unsplashPageUrl: string;
  downloadLocation: string;
  attributionText: string;
  attributionHtml: string;
  photographer: { name: string; username: string; profileUrl: string };
};

function formatPhoto(photo: UnsplashPhoto, width?: number): UnsplashPhotoResult {
  const photographerUrl = photo.user.links.html;
  const attributionText = `Photo by ${photo.user.name} on Unsplash`;
  const attributionHtml = `<span>Photo by <a href="${photographerUrl}?utm_source=hundres&utm_medium=referral">${photo.user.name}</a> on <a href="https://unsplash.com/?utm_source=hundres&utm_medium=referral">Unsplash</a></span>`;

  const sizedUrl =
    width && photo.urls.regular
      ? `${photo.urls.regular.split('&')[0]}&w=${width}&fit=max`
      : photo.urls.regular;

  return {
    id: photo.id,
    width: photo.width,
    height: photo.height,
    alt: photo.alt_description ?? photo.description ?? 'Unsplash photo',
    description: photo.description ?? photo.alt_description,
    urls: {
      regular: sizedUrl,
      small: photo.urls.small,
      thumb: photo.urls.thumb,
    },
    unsplashPageUrl: photo.links.html,
    downloadLocation: photo.links.download_location,
    attributionText,
    attributionHtml,
    photographer: {
      name: photo.user.name,
      username: photo.user.username,
      profileUrl: photographerUrl,
    },
  };
}

export async function mcpSearchPhotos(input: {
  query: string;
  page?: number;
  perPage?: number;
  orientation?: 'landscape' | 'portrait' | 'squarish';
  color?: string;
  width?: number;
}): Promise<string> {
  const { total, results } = await unsplashSearchPhotos({
    query: input.query,
    page: input.page,
    perPage: input.perPage,
    orientation: input.orientation,
    color: input.color as Parameters<typeof unsplashSearchPhotos>[0]['color'],
  });

  return JSON.stringify(
    {
      total,
      page: input.page ?? 1,
      query: input.query,
      photos: results.map((p) => formatPhoto(p, input.width)),
      usageNote:
        'Use urls.regular for hotlinking. Include attributionHtml in published content. Call track_download before saving to Shopify.',
    },
    null,
    2
  );
}

export async function mcpGetRandomPhoto(input: {
  query?: string;
  count?: number;
  orientation?: 'landscape' | 'portrait' | 'squarish';
  width?: number;
}): Promise<string> {
  const photos = await unsplashGetRandomPhotos(input);
  return JSON.stringify(
    {
      photos: photos.map((p) => formatPhoto(p, input.width)),
      usageNote:
        'Use urls.regular for hotlinking. Include attributionHtml in published content. Call track_download before saving to Shopify.',
    },
    null,
    2
  );
}

export async function mcpGetPhoto(input: { photoId: string; width?: number }): Promise<string> {
  const photo = await unsplashGetPhoto(input.photoId);
  return JSON.stringify(formatPhoto(photo, input.width), null, 2);
}

export async function mcpTrackDownload(input: {
  photoId?: string;
  downloadLocation?: string;
}): Promise<string> {
  let location = input.downloadLocation?.trim();
  if (!location && input.photoId) {
    const photo = await unsplashGetPhoto(input.photoId);
    location = photo.links.download_location;
  }
  if (!location) throw new Error('photoId or downloadLocation is required');
  const url = await unsplashTrackDownload(location);
  return JSON.stringify({ tracked: true, downloadUrl: url }, null, 2);
}

export async function mcpUnsplashHealthProbe(): Promise<string> {
  const { total, results } = await unsplashSearchPhotos({ query: 'skincare', perPage: 1 });
  const sample = results[0] ? formatPhoto(results[0]) : null;
  return JSON.stringify(
    {
      ok: true,
      totalResultsForSkincare: total,
      samplePhoto: sample?.id ?? null,
    },
    null,
    2
  );
}

export async function invokeUnsplashMcpTool(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  if (!isUnsplashConfigured()) {
    throw new Error('UNSPLASH_ACCESS_KEY is not configured');
  }

  switch (toolName) {
    case 'search_photos':
      return mcpSearchPhotos({
        query: String(args.query ?? ''),
        page: args.page !== undefined ? Number(args.page) : undefined,
        perPage: args.perPage !== undefined ? Number(args.perPage) : undefined,
        orientation: args.orientation as 'landscape' | 'portrait' | 'squarish' | undefined,
        color: args.color ? String(args.color) : undefined,
        width: args.width !== undefined ? Number(args.width) : undefined,
      });
    case 'get_random_photo':
      return mcpGetRandomPhoto({
        query: args.query ? String(args.query) : undefined,
        count: args.count !== undefined ? Number(args.count) : undefined,
        orientation: args.orientation as 'landscape' | 'portrait' | 'squarish' | undefined,
        width: args.width !== undefined ? Number(args.width) : undefined,
      });
    case 'get_photo':
      return mcpGetPhoto({
        photoId: String(args.photoId ?? ''),
        width: args.width !== undefined ? Number(args.width) : undefined,
      });
    case 'track_download':
      return mcpTrackDownload({
        photoId: args.photoId ? String(args.photoId) : undefined,
        downloadLocation: args.downloadLocation ? String(args.downloadLocation) : undefined,
      });
    default:
      throw new Error(`Unknown Unsplash MCP tool: ${toolName}`);
  }
}
