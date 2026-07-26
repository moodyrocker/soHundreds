const BASE = 'https://api.unsplash.com';

export type UnsplashPhoto = {
  id: string;
  width: number;
  height: number;
  description: string | null;
  alt_description: string | null;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  links: {
    html: string;
    download: string;
    download_location: string;
  };
  user: {
    name: string;
    username: string;
    links: { html: string };
  };
};

export function isUnsplashConfigured(): boolean {
  return Boolean(process.env.UNSPLASH_ACCESS_KEY?.trim());
}

function accessKey(): string {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY is not configured');
  return key;
}

async function unsplashFetch<T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${accessKey()}`,
      'Accept-Version': 'v1',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Unsplash API ${response.status}: ${body.slice(0, 400)}`);
  }

  return response.json() as Promise<T>;
}

export async function unsplashSearchPhotos(input: {
  query: string;
  page?: number;
  perPage?: number;
  orientation?: 'landscape' | 'portrait' | 'squarish';
  color?:
    | 'black_and_white'
    | 'black'
    | 'white'
    | 'yellow'
    | 'orange'
    | 'red'
    | 'purple'
    | 'magenta'
    | 'green'
    | 'teal'
    | 'blue';
  orderBy?: 'relevant' | 'latest';
}): Promise<{ total: number; results: UnsplashPhoto[] }> {
  const data = await unsplashFetch<{
    total: number;
    results: UnsplashPhoto[];
  }>('/search/photos', {
    query: input.query,
    page: input.page ?? 1,
    per_page: Math.min(Math.max(input.perPage ?? 10, 1), 30),
    orientation: input.orientation,
    color: input.color,
    order_by: input.orderBy ?? 'relevant',
  });
  return { total: data.total, results: data.results };
}

export async function unsplashGetRandomPhotos(input: {
  query?: string;
  count?: number;
  orientation?: 'landscape' | 'portrait' | 'squarish';
}): Promise<UnsplashPhoto[]> {
  const count = Math.min(Math.max(input.count ?? 1, 1), 30);
  const data = await unsplashFetch<UnsplashPhoto | UnsplashPhoto[]>('/photos/random', {
    query: input.query,
    count: count > 1 ? count : undefined,
    orientation: input.orientation,
  });
  return Array.isArray(data) ? data : [data];
}

export async function unsplashGetPhoto(id: string): Promise<UnsplashPhoto> {
  return unsplashFetch<UnsplashPhoto>(`/photos/${encodeURIComponent(id)}`);
}

/** Required by Unsplash API guidelines when a user downloads or saves an image. */
export async function unsplashTrackDownload(downloadLocation: string): Promise<string> {
  const response = await fetch(downloadLocation, {
    headers: {
      Authorization: `Client-ID ${accessKey()}`,
      'Accept-Version': 'v1',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Unsplash download tracking ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.url;
}
