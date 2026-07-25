import type { AgentExecutionBrief } from '../types/agentTask.js';
import type { PlanAction } from '../types/plan.js';
import type { BusinessProfile } from './businessProfileService.js';
import {
  canvaCreateInstagramDesign,
  canvaExportDesignUrl,
  canvaListDesigns,
  type CanvaDesign,
} from '../lib/canvaClient.js';
import { MCPConnectionService } from './mcpConnectionService.js';
import type { BrandImagePick } from './instagramAssistImageService.js';

function buildTitle(
  profile: BusinessProfile,
  action: PlanAction,
  brief?: AgentExecutionBrief | null
): string {
  const fromBrief = brief?.fullRequest?.trim();
  if (fromBrief) return fromBrief.slice(0, 80);
  return `${profile.offer || action.title}`.slice(0, 80) || 'Instagram post';
}

/** Designs with a thumbnail usually have real content (Create API blanks often lack one). */
function isLikelyFinishedDesign(design: CanvaDesign): boolean {
  return Boolean(design.thumbnail?.url?.startsWith('https://'));
}

function pickBestDesign(designs: CanvaDesign[], query: string): CanvaDesign | null {
  const finished = designs.filter(isLikelyFinishedDesign);
  if (!finished.length) return null;
  const q = query.toLowerCase().slice(0, 24);
  return finished.find((d) => d.title?.toLowerCase().includes(q)) ?? finished[0] ?? null;
}

/**
 * Export a finished Canva design for Instagram.
 * Never exports a freshly created blank canvas (Create API designs are empty).
 */
export async function pickCanvaImageForInstagram(input: {
  organizationId: string;
  profile: BusinessProfile;
  action: PlanAction;
  brief?: AgentExecutionBrief | null;
}): Promise<BrandImagePick | null> {
  const mcp = new MCPConnectionService();
  const ctx = await mcp.getCanvaContext(input.organizationId);
  if (!ctx) return null;

  const query =
    input.brief?.imageSearchQuery?.trim() ||
    input.action.title.trim() ||
    input.profile.offer?.trim() ||
    'instagram';

  let existing = await canvaListDesigns(ctx.accessToken, { query, limit: 25 });
  let match = pickBestDesign(existing, query);

  if (!match) {
    existing = await canvaListDesigns(ctx.accessToken, { limit: 25 });
    match = pickBestDesign(existing, query);
  }

  if (!match) {
    // Create a blank canvas only as a place for the user to design — do not export/post it.
    const created = await canvaCreateInstagramDesign(ctx.accessToken, {
      title: buildTitle(input.profile, input.action, input.brief),
    });
    const editUrl = created.urls?.edit_url;
    throw new Error(
      editUrl
        ? `Canva has no finished designs to post yet (blank canvases are skipped). Open this design, add your creative, save in Canva, then ask again: ${editUrl}`
        : 'Canva has no finished designs to post yet. Create a design with content in Canva, then ask again. Blank Create API canvases are not posted.'
    );
  }

  const designId = match.id;
  const editUrl = match.urls?.edit_url ?? null;

  const downloadUrl = await canvaExportDesignUrl(ctx.accessToken, {
    designId,
    format: 'png',
  });

  return {
    proposedImageUrl: downloadUrl,
    imageSource: 'canva',
    imageAlt: match.title || input.action.title || 'Canva design',
    imageRationale: editUrl
      ? `Exported Canva design “${match.title ?? designId}” (id ${designId}). Edit in Canva: ${editUrl}`
      : `Exported Canva design “${match.title ?? designId}” (id ${designId}) for Instagram.`,
    canvaDesignId: designId,
    canvaEditUrl: editUrl ?? undefined,
  };
}
