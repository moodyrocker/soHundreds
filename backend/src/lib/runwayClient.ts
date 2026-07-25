/**
 * Runway Developer API client (api.dev.runwayml.com).
 * Workspace-level API key — separate from app.runwayml.com credits.
 * Docs: https://docs.dev.runwayml.com/
 */

const BASE = 'https://api.dev.runwayml.com/v1';
const RUNWAY_VERSION = process.env.RUNWAY_API_VERSION?.trim() || '2024-11-06';

export type RunwayTaskStatus = 'PENDING' | 'THROTTLED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export type RunwayTask = {
  id: string;
  status: RunwayTaskStatus;
  createdAt?: string;
  progress?: number;
  output?: string[];
  failure?: string;
  failureCode?: string;
};

export function isRunwayConfigured(): boolean {
  return Boolean(process.env.RUNWAY_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.RUNWAY_API_KEY?.trim();
  if (!key) throw new Error('RUNWAY_API_KEY is not configured — get one at https://dev.runwayml.com/');
  return key;
}

async function runwayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'X-Runway-Version': RUNWAY_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Runway API ${response.status}: ${text.slice(0, 400)}`);
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export type TextToVideoInput = {
  promptText: string;
  /** Default gen4.5 — Instagram reels use 9:16 */
  model?: string;
  ratio?: '720:1280' | '1280:720' | '1104:832' | '832:1104' | '960:960' | '1584:672';
  duration?: 5 | 10;
  seed?: number;
};

export async function runwayTextToVideo(input: TextToVideoInput): Promise<RunwayTask> {
  return runwayFetch<RunwayTask>('/text_to_video', {
    method: 'POST',
    body: JSON.stringify({
      model: input.model ?? 'gen4.5',
      promptText: input.promptText.slice(0, 1000),
      ratio: input.ratio ?? '720:1280',
      duration: input.duration ?? 5,
      ...(input.seed != null ? { seed: input.seed } : {}),
    }),
  });
}

export type ImageToVideoInput = {
  promptImage: string;
  promptText?: string;
  model?: string;
  ratio?: TextToVideoInput['ratio'];
  duration?: 5 | 10;
};

export async function runwayImageToVideo(input: ImageToVideoInput): Promise<RunwayTask> {
  return runwayFetch<RunwayTask>('/image_to_video', {
    method: 'POST',
    body: JSON.stringify({
      model: input.model ?? 'gen4_turbo',
      promptImage: input.promptImage,
      ...(input.promptText ? { promptText: input.promptText.slice(0, 1000) } : {}),
      ratio: input.ratio ?? '720:1280',
      duration: input.duration ?? 5,
    }),
  });
}

export type TextToImageRatio =
  | '1080:1920'
  | '1920:1080'
  | '1024:1024'
  | '1080:1080'
  | '1360:768'
  | '1168:880'
  | '1440:1080'
  | '1080:1440'
  | '1808:768'
  | '2112:912'
  | '720:1280'
  | '1280:720'
  | '960:960';

export type TextToImageInput = {
  promptText: string;
  /** Default gen4_image — cheap vs video; turbo is cheapest */
  model?: 'gen4_image' | 'gen4_image_turbo' | 'gemini_2.5_flash' | string;
  ratio?: TextToImageRatio;
  seed?: number;
  referenceImages?: Array<{ uri: string; tag?: string }>;
};

/** Official endpoint: https://dev.runwayml.com/endpoints/text_to_image */
export async function runwayTextToImage(input: TextToImageInput): Promise<RunwayTask> {
  const refs = (input.referenceImages ?? [])
    .filter((r) => r.uri?.startsWith('https://') || r.uri?.startsWith('runway://'))
    .slice(0, 3)
    .map((r) => ({
      uri: r.uri,
      ...(r.tag ? { tag: r.tag } : {}),
    }));

  return runwayFetch<RunwayTask>('/text_to_image', {
    method: 'POST',
    body: JSON.stringify({
      model: input.model ?? 'gen4_image',
      promptText: input.promptText.slice(0, 1000),
      ratio: input.ratio ?? '1080:1920',
      ...(input.seed != null ? { seed: input.seed } : {}),
      ...(refs.length ? { referenceImages: refs } : {}),
    }),
  });
}

export async function runwayGetTask(taskId: string): Promise<RunwayTask> {
  return runwayFetch<RunwayTask>(`/tasks/${encodeURIComponent(taskId)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatRunwayFailure(task: RunwayTask): string {
  const msg = task.failure ?? `Runway task ${task.status}`;
  const id = task.id ? ` (task ${task.id})` : '';
  if (/moderation/i.test(msg)) {
    return `${msg}${id}. Runway may still charge credits. Try a simpler product/lifestyle brief — avoid people close-ups, medical claims, or sensitive topics.`;
  }
  return `${msg}${id}`;
}

function formatRunwayTimeout(taskId: string, last?: RunwayTask): string {
  const status = last?.status ?? 'unknown';
  const progress =
    last?.progress != null ? `, ${Math.round(last.progress * 100)}% complete` : '';
  const outputs = (last?.output ?? []).filter((u) => u.startsWith('https://'));
  if (outputs.length) {
    return `Runway task ${taskId} timed out while polling but returned output URL(s). Last status: ${status}${progress}. Video may be ready — retry or paste the URL in Ask.`;
  }
  return `Runway generation timed out after polling task ${taskId} (last status: ${status}${progress}). Credits may already be used. If Hundres logged this task ID, we can retry publish — otherwise check dev.runwayml.com → Usage for spend.`;
}

export async function runwayWaitForOutputs(
  taskId: string,
  options?: { maxAttempts?: number; intervalMs?: number; minCount?: number }
): Promise<{ taskId: string; outputs: string[] }> {
  const maxAttempts = options?.maxAttempts ?? 180;
  const intervalMs = options?.intervalMs ?? 5000;
  const minCount = options?.minCount ?? 1;
  let lastTask: RunwayTask | undefined;

  for (let i = 0; i < maxAttempts; i++) {
    const task = await runwayGetTask(taskId);
    lastTask = task;
    if (task.status === 'SUCCEEDED') {
      const outputs = (task.output ?? []).filter((u) => u.startsWith('https://'));
      if (outputs.length < minCount) {
        throw new Error(
          `Runway task ${taskId} succeeded but returned ${outputs.length} output URL(s); expected ≥${minCount}`
        );
      }
      return { taskId, outputs };
    }
    if (task.status === 'FAILED' || task.status === 'CANCELLED') {
      throw new Error(formatRunwayFailure(task));
    }
    await sleep(intervalMs);
  }

  throw new Error(formatRunwayTimeout(taskId, lastTask));
}

/** Poll until SUCCEEDED and return first HTTPS output URL. */
export async function runwayWaitForVideoUrl(
  taskId: string,
  options?: { maxAttempts?: number; intervalMs?: number }
): Promise<string> {
  const { outputs } = await runwayWaitForOutputs(taskId, options);
  return outputs[0];
}

export type RunwayRecipeUri = { uri: string };

export async function runwayRecipeProductUgc(input: {
  characterImageUri: string;
  productImageUri: string;
  productInfo?: string;
  userConcept?: string;
  duration?: number;
  ratio?: '720:1280' | '1080:1920';
  audio?: boolean;
  version?: string;
}): Promise<RunwayTask> {
  return runwayFetch<RunwayTask>('/recipes/product_ugc', {
    method: 'POST',
    body: JSON.stringify({
      characterImage: { uri: input.characterImageUri },
      productImage: { uri: input.productImageUri },
      version: input.version ?? '2026-06',
      ...(input.productInfo ? { productInfo: input.productInfo.slice(0, 2000) } : {}),
      ...(input.userConcept ? { userConcept: input.userConcept.slice(0, 2000) } : {}),
      ...(input.duration != null ? { duration: Math.min(15, Math.max(4, input.duration)) } : {}),
      ratio: input.ratio ?? '720:1280',
      ...(input.audio != null ? { audio: input.audio } : {}),
    }),
  });
}

export async function runwayRecipeProductAd(input: {
  productImageUris: string[];
  productInfo?: string;
  userConcept?: string;
  styleImageUris?: string[];
  duration?: number;
  ratio?: string;
  audio?: boolean;
  version?: string;
}): Promise<RunwayTask> {
  const productImages = input.productImageUris
    .filter((u) => u.startsWith('https://'))
    .slice(0, 10)
    .map((uri) => ({ uri }));
  if (!productImages.length) {
    throw new Error('product_ad requires at least one HTTPS product image');
  }
  return runwayFetch<RunwayTask>('/recipes/product_ad', {
    method: 'POST',
    body: JSON.stringify({
      productImages,
      version: input.version ?? '2026-06',
      ...(input.productInfo ? { productInfo: input.productInfo.slice(0, 2000) } : {}),
      ...(input.userConcept ? { userConcept: input.userConcept.slice(0, 2000) } : {}),
      ...(input.duration != null ? { duration: Math.min(15, Math.max(4, input.duration)) } : {}),
      ratio: input.ratio ?? '720:1280',
      ...(input.audio != null ? { audio: input.audio } : {}),
      ...(input.styleImageUris?.length
        ? {
            styleImages: input.styleImageUris
              .filter((u) => u.startsWith('https://'))
              .slice(0, 4)
              .map((uri) => ({ uri })),
          }
        : {}),
    }),
  });
}

export async function runwayRecipeProductCampaignImage(input: {
  productImageUri: string;
  prompt: string;
  version?: string;
}): Promise<RunwayTask> {
  return runwayFetch<RunwayTask>('/recipes/product_campaign_image', {
    method: 'POST',
    body: JSON.stringify({
      image: { uri: input.productImageUri },
      prompt: input.prompt.slice(0, 2000),
      version: input.version ?? '2026-06',
    }),
  });
}

export async function runwayGenerateInstagramReelVideo(input: {
  promptText: string;
  promptImage?: string;
  duration?: 5 | 10;
}): Promise<{ taskId: string; videoUrl: string }> {
  const task = input.promptImage?.startsWith('https://')
    ? await runwayImageToVideo({
        promptImage: input.promptImage,
        promptText: input.promptText,
        ratio: '720:1280',
        duration: input.duration ?? 5,
      })
    : await runwayTextToVideo({
        promptText: input.promptText,
        ratio: '720:1280',
        duration: input.duration ?? 5,
      });

  const videoUrl = await runwayWaitForVideoUrl(task.id);
  return { taskId: task.id, videoUrl };
}
