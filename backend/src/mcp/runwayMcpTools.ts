import {
  isRunwayConfigured,
  runwayGenerateInstagramReelVideo,
  runwayGetTask,
  runwayImageToVideo,
  runwayTextToImage,
  runwayTextToVideo,
  runwayWaitForOutputs,
  runwayWaitForVideoUrl,
} from '../lib/runwayClient.js';

export async function mcpRunwayTextToVideo(input: {
  promptText: string;
  duration?: 5 | 10;
  wait?: boolean;
}): Promise<string> {
  const task = await runwayTextToVideo({
    promptText: input.promptText,
    ratio: '720:1280',
    duration: input.duration ?? 5,
  });

  if (input.wait === false) {
    return JSON.stringify(
      {
        taskId: task.id,
        status: task.status,
        usageNote: 'Poll with get_task, or call again with wait:true. Pass video URL to Instagram publish_reel.',
      },
      null,
      2
    );
  }

  const videoUrl = await runwayWaitForVideoUrl(task.id);
  return JSON.stringify(
    {
      taskId: task.id,
      status: 'SUCCEEDED',
      videoUrl,
      usageNote: 'Pass videoUrl to Instagram MCP publish_reel (public HTTPS required).',
    },
    null,
    2
  );
}

export async function mcpRunwayTextToImage(input: {
  promptText: string;
  model?: string;
  ratio?: string;
  wait?: boolean;
}): Promise<string> {
  const task = await runwayTextToImage({
    promptText: input.promptText,
    model: input.model ?? 'gen4_image',
    ratio: (input.ratio as '1080:1920') ?? '1080:1920',
  });

  if (input.wait === false) {
    return JSON.stringify(
      {
        taskId: task.id,
        status: task.status,
        usageNote: 'Poll with get_task until SUCCEEDED, then use output[0] as imageUrl for Instagram.',
      },
      null,
      2
    );
  }

  const { outputs } = await runwayWaitForOutputs(task.id, { minCount: 1 });
  return JSON.stringify(
    {
      taskId: task.id,
      status: 'SUCCEEDED',
      imageUrl: outputs[0],
      imageUrls: outputs,
      usageNote: 'Pass imageUrl to Instagram MCP publish_photo (public HTTPS required). ~5 credits/image.',
    },
    null,
    2
  );
}

export async function mcpRunwayImageToVideo(input: {
  promptImage: string;
  promptText?: string;
  duration?: 5 | 10;
  wait?: boolean;
}): Promise<string> {
  const task = await runwayImageToVideo({
    promptImage: input.promptImage,
    promptText: input.promptText,
    ratio: '720:1280',
    duration: input.duration ?? 5,
  });

  if (input.wait === false) {
    return JSON.stringify(
      {
        taskId: task.id,
        status: task.status,
        usageNote: 'Poll with get_task until SUCCEEDED, then use output[0] as videoUrl for Instagram.',
      },
      null,
      2
    );
  }

  const videoUrl = await runwayWaitForVideoUrl(task.id);
  return JSON.stringify(
    {
      taskId: task.id,
      status: 'SUCCEEDED',
      videoUrl,
      usageNote: 'Pass videoUrl to Instagram MCP publish_reel.',
    },
    null,
    2
  );
}

export async function mcpRunwayGetTask(input: { taskId: string }): Promise<string> {
  const task = await runwayGetTask(input.taskId);
  return JSON.stringify(task, null, 2);
}

export async function mcpRunwayGenerateReel(input: {
  promptText: string;
  promptImage?: string;
  duration?: 5 | 10;
}): Promise<string> {
  const result = await runwayGenerateInstagramReelVideo(input);
  return JSON.stringify(
    {
      ...result,
      ratio: '720:1280',
      usageNote:
        'Instagram Reel ready. Call Instagram MCP publish_reel with this videoUrl and a caption.',
    },
    null,
    2
  );
}

export async function mcpRunwayHealthProbe(): Promise<string> {
  if (!isRunwayConfigured()) {
    throw new Error('RUNWAY_API_KEY not configured');
  }
  // Lightweight: confirm key format / auth by fetching a fake task id — expect 404 not 401
  try {
    await runwayGetTask('00000000-0000-0000-0000-000000000000');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/401|403|Invalid API key|Unauthorized/i.test(message)) {
      throw new Error(`Runway API key rejected: ${message.slice(0, 200)}`);
    }
    // 404 / task not found means auth worked
  }
  return JSON.stringify({ ok: true, configured: true, apiHost: 'api.dev.runwayml.com' }, null, 2);
}

export async function invokeRunwayMcpTool(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  if (!isRunwayConfigured()) {
    throw new Error('RUNWAY_API_KEY is not configured');
  }

  switch (toolName) {
    case 'text_to_video':
      return mcpRunwayTextToVideo({
        promptText: String(args.promptText ?? ''),
        duration: args.duration === 10 ? 10 : 5,
        wait: args.wait === false ? false : true,
      });
    case 'text_to_image':
      return mcpRunwayTextToImage({
        promptText: String(args.promptText ?? ''),
        model: args.model ? String(args.model) : undefined,
        ratio: args.ratio ? String(args.ratio) : undefined,
        wait: args.wait === false ? false : true,
      });
    case 'image_to_video':
      return mcpRunwayImageToVideo({
        promptImage: String(args.promptImage ?? ''),
        promptText: args.promptText ? String(args.promptText) : undefined,
        duration: args.duration === 10 ? 10 : 5,
        wait: args.wait === false ? false : true,
      });
    case 'get_task':
      return mcpRunwayGetTask({ taskId: String(args.taskId ?? '') });
    case 'generate_instagram_reel':
      return mcpRunwayGenerateReel({
        promptText: String(args.promptText ?? ''),
        promptImage: args.promptImage ? String(args.promptImage) : undefined,
        duration: args.duration === 10 ? 10 : 5,
      });
    default:
      throw new Error(`Unknown Runway MCP tool: ${toolName}`);
  }
}
