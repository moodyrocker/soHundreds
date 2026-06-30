const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION ?? 'v21.0';

export type InstagramContext = {
  accessToken: string;
  igUserId: string;
  pageId?: string;
  username?: string;
  /** graph.instagram.com for Business Login; graph.facebook.com for Page-linked tokens */
  graphHost: string;
};

type GraphError = { message?: string; error_user_msg?: string; code?: number };

async function graphJson<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
  graphHost = 'https://graph.facebook.com'
): Promise<T> {
  const url = path.startsWith('http')
    ? path
    : `${graphHost}/${META_GRAPH_VERSION}${path.startsWith('/') ? path : `/${path}`}`;

  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...init,
    headers,
  });

  const text = await res.text();
  let data: T & { error?: GraphError };
  try {
    data = JSON.parse(text) as T & { error?: GraphError };
  } catch {
    throw new Error(`Instagram Graph API invalid JSON (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok || data.error) {
    const msg =
      data.error?.error_user_msg ??
      data.error?.message ??
      text.slice(0, 400) ??
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

function withToken(path: string, accessToken: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}access_token=${encodeURIComponent(accessToken)}`;
}

function igGraph<T>(ctx: InstagramContext, path: string, init?: RequestInit): Promise<T> {
  return graphJson<T>(path, ctx.accessToken, init, ctx.graphHost);
}

/** Instagram Business Login tokens are scoped to the user — use /me, not OAuth user_id. */
function igApiUserId(ctx: InstagramContext): string {
  if (ctx.graphHost.includes('graph.instagram.com')) {
    return 'me';
  }
  return ctx.igUserId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveInstagramBusinessAccount(
  pageId: string,
  accessToken: string
): Promise<{ id: string; username?: string } | null> {
  const data = await graphJson<{
    instagram_business_account?: { id?: string; username?: string };
  }>(withToken(`/${pageId}?fields=instagram_business_account{id,username}`, accessToken), accessToken);

  const ig = data.instagram_business_account;
  if (!ig?.id) return null;
  return { id: ig.id, username: ig.username };
}

export async function igGetProfile(ctx: InstagramContext) {
  return igGraph(
    ctx,
    withToken(
      `/${igApiUserId(ctx)}?fields=username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website`,
      ctx.accessToken
    )
  );
}

export async function igListMedia(
  ctx: InstagramContext,
  limit = 12
): Promise<{ data: unknown[] }> {
  return igGraph(
    ctx,
    withToken(
      `/${igApiUserId(ctx)}/media?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count&limit=${limit}`,
      ctx.accessToken
    )
  );
}

export async function igGetPublishLimit(ctx: InstagramContext) {
  return igGraph(ctx, withToken(`/${igApiUserId(ctx)}/content_publishing_limit`, ctx.accessToken));
}

export async function igGetContainerStatus(ctx: InstagramContext, containerId: string) {
  return igGraph<{ id: string; status_code?: string; status?: string }>(
    ctx,
    withToken(`/${containerId}?fields=status_code,status`, ctx.accessToken)
  );
}

async function waitForContainerReady(ctx: InstagramContext, containerId: string, maxMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const status = await igGetContainerStatus(ctx, containerId);
    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR') {
      throw new Error(status.status ?? 'Media container failed processing');
    }
    await sleep(3000);
  }
  throw new Error('Media container not ready in time — try get_container_status and publish later');
}

async function createMediaContainer(
  ctx: InstagramContext,
  body: Record<string, string | boolean | number | undefined>
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  params.set('access_token', ctx.accessToken);

  return igGraph<{ id: string }>(ctx, `/${igApiUserId(ctx)}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

async function publishContainer(ctx: InstagramContext, creationId: string) {
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: ctx.accessToken,
  });
  return igGraph<{ id: string }>(ctx, `/${igApiUserId(ctx)}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

export async function igPublishPhoto(
  ctx: InstagramContext,
  input: { imageUrl: string; caption?: string }
) {
  const container = await createMediaContainer(ctx, {
    image_url: input.imageUrl,
    caption: input.caption,
  });
  await waitForContainerReady(ctx, container.id);
  const published = await publishContainer(ctx, container.id);
  return { containerId: container.id, mediaId: published.id };
}

export async function igPublishStory(
  ctx: InstagramContext,
  input: { imageUrl?: string; videoUrl?: string }
) {
  if (!input.imageUrl && !input.videoUrl) {
    throw new Error('Provide imageUrl or videoUrl for a story');
  }
  const container = await createMediaContainer(ctx, {
    media_type: 'STORIES',
    ...(input.imageUrl ? { image_url: input.imageUrl } : { video_url: input.videoUrl }),
  });
  await waitForContainerReady(ctx, container.id);
  const published = await publishContainer(ctx, container.id);
  return { containerId: container.id, mediaId: published.id };
}

export async function igPublishReel(
  ctx: InstagramContext,
  input: { videoUrl: string; caption?: string; shareToFeed?: boolean }
) {
  const container = await createMediaContainer(ctx, {
    media_type: 'REELS',
    video_url: input.videoUrl,
    caption: input.caption,
    share_to_feed: input.shareToFeed === false ? 'false' : 'true',
  });
  await waitForContainerReady(ctx, container.id, 180_000);
  const published = await publishContainer(ctx, container.id);
  return { containerId: container.id, mediaId: published.id };
}

export async function igPublishCarousel(
  ctx: InstagramContext,
  input: { imageUrls: string[]; caption?: string }
) {
  if (input.imageUrls.length < 2 || input.imageUrls.length > 10) {
    throw new Error('Carousel requires 2–10 image URLs');
  }

  const childIds: string[] = [];
  for (const imageUrl of input.imageUrls) {
    const child = await createMediaContainer(ctx, {
      image_url: imageUrl,
      is_carousel_item: true,
    });
    await waitForContainerReady(ctx, child.id);
    childIds.push(child.id);
  }

  const carousel = await createMediaContainer(ctx, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: input.caption,
  });
  await waitForContainerReady(ctx, carousel.id);
  const published = await publishContainer(ctx, carousel.id);
  return { containerId: carousel.id, mediaId: published.id, childContainerIds: childIds };
}

export async function igPublishContainer(ctx: InstagramContext, creationId: string) {
  const published = await publishContainer(ctx, creationId);
  return { mediaId: published.id };
}

export async function igListComments(ctx: InstagramContext, mediaId: string, limit = 25) {
  return igGraph(
    ctx,
    withToken(
      `/${mediaId}/comments?fields=id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp}&limit=${limit}`,
      ctx.accessToken
    )
  );
}

export async function igPostComment(ctx: InstagramContext, mediaId: string, message: string) {
  const params = new URLSearchParams({
    message,
    access_token: ctx.accessToken,
  });
  return igGraph<{ id: string }>(ctx, `/${mediaId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

export async function igReplyToComment(ctx: InstagramContext, commentId: string, message: string) {
  const params = new URLSearchParams({
    message,
    access_token: ctx.accessToken,
  });
  return igGraph<{ id: string }>(ctx, `/${commentId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

export async function igHideComment(ctx: InstagramContext, commentId: string, hide = true) {
  const params = new URLSearchParams({
    hide: hide ? 'true' : 'false',
    access_token: ctx.accessToken,
  });
  return igGraph<{ success?: boolean }>(ctx, `/${commentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

export async function igDeleteComment(ctx: InstagramContext, commentId: string) {
  return igGraph<{ success?: boolean }>(
    ctx,
    withToken(`/${commentId}`, ctx.accessToken),
    { method: 'DELETE' }
  );
}

export async function igLikeMedia(ctx: InstagramContext, mediaId: string) {
  const params = new URLSearchParams({
    media_id: mediaId,
    access_token: ctx.accessToken,
  });
  return igGraph<{ success?: boolean }>(ctx, `/${igApiUserId(ctx)}/likes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

export async function igLikeComment(ctx: InstagramContext, commentId: string) {
  const params = new URLSearchParams({
    comment_id: commentId,
    access_token: ctx.accessToken,
  });
  return igGraph<{ success?: boolean }>(ctx, `/${igApiUserId(ctx)}/likes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

export async function igUnlikeMedia(ctx: InstagramContext, mediaId: string) {
  return igGraph<{ success?: boolean }>(
    ctx,
    withToken(`/${igApiUserId(ctx)}/likes?media_id=${encodeURIComponent(mediaId)}`, ctx.accessToken),
    { method: 'DELETE' }
  );
}

export async function igUnlikeComment(ctx: InstagramContext, commentId: string) {
  return igGraph<{ success?: boolean }>(
    ctx,
    withToken(
      `/${igApiUserId(ctx)}/likes?comment_id=${encodeURIComponent(commentId)}`,
      ctx.accessToken
    ),
    { method: 'DELETE' }
  );
}

export async function igGetMediaInsights(
  ctx: InstagramContext,
  mediaId: string,
  metrics = 'engagement,impressions,reach,saved'
) {
  return igGraph(
    ctx,
    withToken(`/${mediaId}/insights?metric=${encodeURIComponent(metrics)}`, ctx.accessToken)
  );
}
