import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MCPPlatform } from '../types/index.js';

export type McpBridgePlatform = MCPPlatform;

type BridgePayload = {
  organizationId: string;
  platform: McpBridgePlatform;
  exp: number;
};

function signingKey(): string {
  const key =
    process.env.MCP_BRIDGE_SECRET?.trim() ||
    process.env.SHOPIFY_MCP_BRIDGE_SECRET?.trim() ||
    process.env.ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error('MCP_BRIDGE_SECRET or ENCRYPTION_KEY is required for MCP bridge tokens');
  }
  return key;
}

export function createMcpBridgeToken(
  organizationId: string,
  platform: McpBridgePlatform,
  ttlMs = 15 * 60 * 1000
): string {
  const payload: BridgePayload = {
    organizationId,
    platform,
    exp: Date.now() + ttlMs,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', signingKey()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyMcpBridgeToken(
  token: string,
  expectedPlatform?: McpBridgePlatform
): { organizationId: string; platform: McpBridgePlatform } | null {
  const trimmed = token.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0) return null;

  const payloadB64 = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  const expected = createHmac('sha256', signingKey()).update(payloadB64).digest('base64url');

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  let payload: BridgePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as BridgePayload;
  } catch {
    return null;
  }

  if (!payload.organizationId || typeof payload.exp !== 'number' || !payload.platform) {
    return null;
  }
  if (Date.now() > payload.exp) return null;
  if (expectedPlatform && payload.platform !== expectedPlatform) return null;
  return { organizationId: payload.organizationId, platform: payload.platform };
}

export function deploymentOrigin(): string {
  const origin = process.env.WEB_ORIGIN?.trim();
  if (origin) return origin.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT ?? 3001}`;
}

export function mcpBridgePublicUrl(platform: McpBridgePlatform): string {
  const external =
    platform === 'shopify' ? process.env.SHOPIFY_EXTERNAL_MCP_URL?.trim() : undefined;
  if (external) return external.replace(/\/$/, '');

  const envOverrides: Partial<Record<McpBridgePlatform, string | undefined>> = {
    google_analytics: process.env.ANALYTICS_MCP_PUBLIC_URL,
    google_ads: process.env.GOOGLE_ADS_MCP_PUBLIC_URL,
    meta_ads: process.env.META_ADS_MCP_PUBLIC_URL,
    shopify: process.env.SHOPIFY_MCP_PUBLIC_URL,
    unsplash: process.env.UNSPLASH_MCP_PUBLIC_URL,
    canva: process.env.CANVA_MCP_PUBLIC_URL,
    runway: process.env.RUNWAY_MCP_PUBLIC_URL,
    instagram: process.env.INSTAGRAM_MCP_PUBLIC_URL,
    mailchimp: process.env.MAILCHIMP_MCP_PUBLIC_URL,
  };
  const explicit = envOverrides[platform]?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const pathByPlatform: Record<McpBridgePlatform, string> = {
    google_analytics: '/mcp/analytics',
    google_ads: '/mcp/google-ads',
    meta_ads: '/mcp/meta-ads',
    shopify: '/mcp/shopify',
    unsplash: '/mcp/unsplash',
    canva: '/mcp/canva',
    runway: '/mcp/runway',
    instagram: '/mcp/instagram',
    mailchimp: '/mcp/mailchimp',
  };
  return `${deploymentOrigin()}${pathByPlatform[platform]}`;
}

/** @deprecated use createMcpBridgeToken(orgId, 'shopify') */
export function createShopifyBridgeToken(organizationId: string, ttlMs?: number): string {
  return createMcpBridgeToken(organizationId, 'shopify', ttlMs);
}

/** @deprecated use verifyMcpBridgeToken(token, 'shopify') */
export function verifyShopifyBridgeToken(token: string): { organizationId: string } | null {
  const v = verifyMcpBridgeToken(token, 'shopify');
  return v ? { organizationId: v.organizationId } : null;
}

/** @deprecated use mcpBridgePublicUrl('shopify') */
export function shopifyMcpPublicUrl(): string {
  return mcpBridgePublicUrl('shopify');
}
