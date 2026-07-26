import {
  canvaCreateInstagramDesign,
  canvaExportDesignUrl,
  canvaListDesigns,
  type CanvaDesign,
} from '../lib/canvaClient.js';

export type CanvaMcpContext = {
  accessToken: string;
};

function formatDesign(design: CanvaDesign) {
  return {
    id: design.id,
    title: design.title ?? null,
    editUrl: design.urls?.edit_url ?? null,
    viewUrl: design.urls?.view_url ?? null,
    thumbnailUrl: design.thumbnail?.url ?? null,
    updatedAt: design.updated_at ?? null,
  };
}

export async function mcpCanvaListDesigns(
  ctx: CanvaMcpContext,
  input: { query?: string; limit?: number }
): Promise<string> {
  const designs = await canvaListDesigns(ctx.accessToken, input);
  return JSON.stringify(
    {
      count: designs.length,
      designs: designs.map(formatDesign),
      usageNote:
        'Use export_design with a design id to get a public HTTPS download URL for Instagram publishing.',
    },
    null,
    2
  );
}

export async function mcpCanvaCreateInstagramDesign(
  ctx: CanvaMcpContext,
  input: { title: string }
): Promise<string> {
  const design = await canvaCreateInstagramDesign(ctx.accessToken, input);
  return JSON.stringify(
    {
      design: formatDesign(design),
      usageNote:
        'Open editUrl to add text/images in Canva, then call export_design before publish_photo on Instagram.',
    },
    null,
    2
  );
}

export async function mcpCanvaExportDesign(
  ctx: CanvaMcpContext,
  input: { designId: string; format?: 'png' | 'jpg' | 'mp4' }
): Promise<string> {
  const downloadUrl = await canvaExportDesignUrl(ctx.accessToken, {
    designId: input.designId,
    format: input.format,
  });
  return JSON.stringify(
    {
      designId: input.designId,
      format: input.format ?? 'png',
      downloadUrl,
      usageNote:
        'Pass downloadUrl to Instagram MCP publish_photo (feed) or publish_story. URL expires in ~24h.',
    },
    null,
    2
  );
}

export async function mcpCanvaHealthProbe(ctx: CanvaMcpContext): Promise<string> {
  const designs = await canvaListDesigns(ctx.accessToken, { limit: 1 });
  return JSON.stringify(
    {
      ok: true,
      designCountSample: designs.length,
      sampleDesignId: designs[0]?.id ?? null,
    },
    null,
    2
  );
}

export async function invokeCanvaMcpTool(
  ctx: CanvaMcpContext,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  switch (toolName) {
    case 'list_designs':
      return mcpCanvaListDesigns(ctx, {
        query: args.query ? String(args.query) : undefined,
        limit: args.limit !== undefined ? Number(args.limit) : undefined,
      });
    case 'create_instagram_design':
      return mcpCanvaCreateInstagramDesign(ctx, {
        title: String(args.title ?? 'Instagram post'),
      });
    case 'export_design':
      return mcpCanvaExportDesign(ctx, {
        designId: String(args.designId ?? ''),
        format: args.format as 'png' | 'jpg' | 'mp4' | undefined,
      });
    default:
      throw new Error(`Unknown Canva MCP tool: ${toolName}`);
  }
}
