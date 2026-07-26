import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MailchimpContext } from '../lib/mailchimpClient.js';
import {
  mcpMailchimpCreateDraftCampaign,
  mcpMailchimpEnsureAudience,
  mcpMailchimpHealth,
  mcpMailchimpListAudiences,
  mcpMailchimpUpsertMember,
} from './mailchimpMcpTools.js';

export function createMailchimpMcpServer(ctx: MailchimpContext): McpServer {
  const server = new McpServer(
    { name: 'mailchimp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'health',
    {
      description: 'Ping Mailchimp and list audiences for this connected account.',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: await mcpMailchimpHealth(ctx) }],
    })
  );

  server.registerTool(
    'list_audiences',
    {
      description: 'List Mailchimp audiences (lists) for list-building and campaigns.',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: await mcpMailchimpListAudiences(ctx) }],
    })
  );

  server.registerTool(
    'ensure_audience',
    {
      description:
        'Find an audience by name or create it. Use for win-back / list-building sequences.',
      inputSchema: {
        name: z.string().min(1).max(100),
        fromEmail: z.string().email(),
        fromName: z.string().min(1).max(100),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpMailchimpEnsureAudience(ctx, input) }],
    })
  );

  server.registerTool(
    'upsert_member',
    {
      description: 'Add or update a subscriber on an audience (list).',
      inputSchema: {
        listId: z.string().optional(),
        email: z.string().email(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpMailchimpUpsertMember(ctx, input) }],
    })
  );

  server.registerTool(
    'create_draft_campaign',
    {
      description:
        'Create a Mailchimp email campaign as a DRAFT with HTML content. Never sends — user reviews in Mailchimp.',
      inputSchema: {
        listId: z.string().optional(),
        subject: z.string().min(1).max(150),
        bodyPlain: z.string().min(1),
        fromName: z.string().min(1).max(100),
        replyTo: z.string().email(),
        title: z.string().max(100).optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpMailchimpCreateDraftCampaign(ctx, input) }],
    })
  );

  return server;
}
