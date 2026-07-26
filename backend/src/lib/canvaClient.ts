import { logger } from '../lib/logger.js';

const log = logger('canva');
const CANVA_API_BASE = 'https://api.canva.com/rest/v1';

export type CanvaDesign = {
  id: string;
  title?: string;
  thumbnail?: { url?: string; width?: number; height?: number };
  urls?: { edit_url?: string; view_url?: string };
  updated_at?: number;
};

type ExportJob = {
  id: string;
  status: 'in_progress' | 'success' | 'failed';
  /** Canva returns plain HTTPS strings (not `{ url }` objects). */
  urls?: Array<string | { url?: string }>;
  error?: { message?: string };
};

function firstExportDownloadUrl(job: ExportJob): string | null {
  const first = job.urls?.[0];
  if (typeof first === 'string' && /^https?:\/\//i.test(first)) return first;
  if (first && typeof first === 'object' && typeof first.url === 'string') {
    const u = first.url.trim();
    if (/^https?:\/\//i.test(u)) return u;
  }
  return null;
}

async function canvaFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${CANVA_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Canva API ${response.status}: ${text.slice(0, 400)}`);
  }

  return JSON.parse(text) as T;
}

export async function canvaListDesigns(
  accessToken: string,
  input?: { query?: string; limit?: number }
): Promise<CanvaDesign[]> {
  const params = new URLSearchParams();
  if (input?.query) params.set('query', input.query.slice(0, 255));
  if (input?.limit) params.set('limit', String(Math.min(100, Math.max(1, input.limit))));

  const qs = params.toString();
  const data = await canvaFetch<{ items?: CanvaDesign[] }>(
    accessToken,
    `/designs${qs ? `?${qs}` : ''}`
  );
  return data.items ?? [];
}

export async function canvaCreateInstagramDesign(
  accessToken: string,
  input: { title: string }
): Promise<CanvaDesign> {
  const data = await canvaFetch<{ design: CanvaDesign }>(accessToken, '/designs', {
    method: 'POST',
    body: JSON.stringify({
      design_type: {
        type: 'custom',
        width: 1080,
        height: 1080,
      },
      title: input.title.slice(0, 255),
    }),
  });
  return data.design;
}

export async function canvaCreateDesignExportJob(
  accessToken: string,
  input: { designId: string; format?: 'png' | 'jpg' | 'mp4' }
): Promise<string> {
  const format = input.format ?? 'png';
  const exportFormat =
    format === 'jpg'
      ? { type: 'jpg', quality: 90 }
      : format === 'mp4'
        ? { type: 'mp4' }
        : { type: 'png' };

  const data = await canvaFetch<{ job: { id: string } }>(accessToken, '/exports', {
    method: 'POST',
    body: JSON.stringify({
      design_id: input.designId,
      format: exportFormat,
    }),
  });

  if (!data.job?.id) throw new Error('Canva export job missing id');
  return data.job.id;
}

export async function canvaGetDesignExportJob(
  accessToken: string,
  jobId: string
): Promise<ExportJob> {
  const data = await canvaFetch<{ job: ExportJob }>(
    accessToken,
    `/exports/${encodeURIComponent(jobId)}`
  );
  return data.job;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function canvaExportDesignUrl(
  accessToken: string,
  input: { designId: string; format?: 'png' | 'jpg' | 'mp4'; maxAttempts?: number }
): Promise<string> {
  const jobId = await canvaCreateDesignExportJob(accessToken, input);
  const attempts = input.maxAttempts ?? 30;

  for (let i = 0; i < attempts; i++) {
    const job = await canvaGetDesignExportJob(accessToken, jobId);
    if (job.status === 'success') {
      const url = firstExportDownloadUrl(job);
      if (!url) {
        log.warn('export success without usable url:', JSON.stringify(job).slice(0, 500));
        throw new Error('Canva export succeeded but no download URL was returned');
      }
      return url;
    }
    if (job.status === 'failed') {
      throw new Error(job.error?.message ?? 'Canva export job failed');
    }
    await sleep(2000);
  }

  throw new Error('Canva export timed out — try again in a moment');
}
