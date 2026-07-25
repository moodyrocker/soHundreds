'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionDeliverableCard } from '@/components/dashboard/action-deliverable-card';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import {
  runAgentTask,
  type AgentSentiment,
  type AgentTaskResponse,
} from '@/lib/agent-task';
import {
  extractExecutionReasoning,
  isShopifyBlogArticle,
  type ExecutionRecord,
} from '@/lib/execution';

type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | {
      id: string;
      role: 'assistant';
      text: string;
      sentiment?: AgentSentiment;
      needsClarification?: boolean;
      task?: AgentTaskResponse;
      error?: string;
    };

type Props = {
  strategyId: string;
  accessToken: string;
  organizationId: string;
  disabled?: boolean;
  hideHeader?: boolean;
  onTaskComplete?: (execution: ExecutionRecord | null, actionId?: string) => void;
};

const SUGGESTIONS = [
  'Write a Shopify blog post about men\'s skincare',
  'Post a photo on Instagram about our bestseller',
  'Post an Instagram story about today\'s offer — use Unsplash lifestyle images',
  'Create a Shopify gift guide page',
];

function chatStorageKey(strategyId: string) {
  return `hundres-agent-chat-${strategyId}`;
}

function loadStoredMessages(strategyId: string): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(chatStorageKey(strategyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistMessages(strategyId: string, messages: ChatMessage[]) {
  if (typeof window === 'undefined') return;
  const slim = messages.map((m) =>
    m.role === 'user'
      ? { id: m.id, role: 'user' as const, text: m.text }
      : {
          id: m.id,
          role: 'assistant' as const,
          text: m.text,
          sentiment: m.sentiment,
          needsClarification: m.needsClarification,
        }
  );
  sessionStorage.setItem(chatStorageKey(strategyId), JSON.stringify(slim));
}

function shopifyArticleUrl(execution: ExecutionRecord): string | null {
  const payload = execution.proposedState;
  if (!isShopifyBlogArticle(payload)) return null;
  const domain = payload.shopDomain?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain || !payload.blogHandle || !payload.handle) return null;
  return `https://${domain}/blogs/${payload.blogHandle}/${payload.handle}`;
}

function buildAssistantText(task: AgentTaskResponse): string {
  if (task.needsClarification) {
    return `${task.reply}${task.unsupportedReason ? ` ${task.unsupportedReason}` : ''}`;
  }
  if (!task.supported) {
    return task.unsupportedReason ? `${task.reply} ${task.unsupportedReason}` : task.reply;
  }
  if (task.result?.execution.status === 'executed') {
    const state = task.result.execution.proposedState;
    if (
      state &&
      typeof state === 'object' &&
      'kind' in state &&
      state.kind === 'instagram_publish' &&
      'imageSource' in state &&
      state.imageSource === 'canva'
    ) {
      return `${task.reply} Exported from Canva and published to Instagram — see the Canva + Instagram details below.`;
    }
    return `${task.reply} Done — see the result below.`;
  }
  if (task.needsHumanGate) {
    return `${task.reply} Campaign created paused — review in Ads Manager before enabling spend.`;
  }
  if (task.result) {
    const scope = task.result.scopeWarning ? ` ${task.result.scopeWarning}` : '';
    return `${task.reply} Prepared a draft — see below.${scope}`;
  }
  return task.reply;
}

export function AgentChatPanel({
  strategyId,
  accessToken,
  organizationId,
  disabled,
  hideHeader,
  onTaskComplete,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadStoredMessages(strategyId));
    setHydrated(true);
  }, [strategyId]);

  useEffect(() => {
    if (!hydrated) return;
    persistMessages(strategyId, messages);
  }, [messages, strategyId, hydrated]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || running || disabled) return;

    const priorTurns = messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));

    const userId = `u-${Date.now()}`;
    setMessages((prev) => [...prev, { id: userId, role: 'user', text: trimmed }]);
    setInput('');
    setRunning(true);
    scrollToBottom();

    try {
      const task = await runAgentTask(
        accessToken,
        organizationId,
        strategyId,
        trimmed,
        priorTurns
      );

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: buildAssistantText(task),
          sentiment: task.sentiment,
          needsClarification: task.needsClarification,
          task: task.result ? task : task.supported ? task : undefined,
        },
      ]);

      if (task.supported && task.result) {
        onTaskComplete?.(task.result.execution ?? null, task.action?.id);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Something went wrong';
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', text: error, error },
      ]);
    } finally {
      setRunning(false);
      scrollToBottom();
    }
  };

  const clearChat = () => {
    setMessages([]);
    sessionStorage.removeItem(chatStorageKey(strategyId));
  };

  return (
    <Card style={{ marginBottom: hideHeader ? 0 : 24, padding: '16px 18px' }}>
      {!hideHeader ? (
        <div style={{ marginBottom: 12 }}>
          <div className="h-eyebrow" style={{ marginBottom: 6 }}>
            Ask the agent
          </div>
          <p className="t-dim" style={{ margin: 0, fontSize: 13, lineHeight: 1.5, maxWidth: 560 }}>
            Chat with the agent — it remembers what you said and will ask questions when something
            is unclear before running a task.
          </p>
        </div>
      ) : null}

      {messages.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBottom: 8,
            }}
          >
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={clearChat}
              disabled={running}
            >
              Clear conversation
            </button>
          </div>
          <div
            ref={scrollRef}
            className="agent-chat-thread"
            style={{
              maxHeight: 420,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '4px 0',
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                }}
              >
                {msg.role === 'assistant' && msg.sentiment && msg.sentiment !== 'neutral' ? (
                  <span
                    className="t-mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--text-mute)',
                      display: 'block',
                      marginBottom: 4,
                      textTransform: 'capitalize',
                    }}
                  >
                    {msg.sentiment}
                  </span>
                ) : null}
                <div
                  className={msg.role === 'user' ? 'agent-chat-bubble-user' : 'agent-chat-bubble-agent'}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    fontSize: 14,
                    lineHeight: 1.5,
                    ...(msg.role === 'assistant' && msg.error
                      ? {
                          border: '1px solid rgba(239, 68, 68, 0.45)',
                          background: 'rgba(239, 68, 68, 0.08)',
                          color: 'var(--danger, #ef4444)',
                        }
                      : {}),
                  }}
                >
                  {msg.role === 'assistant' && msg.error ? (
                    <span
                      className="t-mono"
                      style={{ display: 'block', fontSize: 10, marginBottom: 6, opacity: 0.9 }}
                    >
                      Run failed
                    </span>
                  ) : null}
                  {msg.text}
                </div>
                {msg.role === 'assistant' && msg.task?.result ? (
                  <div style={{ marginTop: 10 }}>
                    {msg.task.action ? (
                      <div
                        style={{
                          marginBottom: 8,
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                          alignItems: 'center',
                        }}
                      >
                        <Chip variant="accent">{msg.task.action.channel}</Chip>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                          {msg.task.action.title}
                        </span>
                      </div>
                    ) : null}
                    {msg.task.result.execution.status === 'executed' &&
                    isShopifyBlogArticle(msg.task.result.execution.proposedState) ? (
                      (() => {
                        const url = shopifyArticleUrl(msg.task.result.execution);
                        return url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost"
                            style={{ fontSize: 12, marginBottom: 8, display: 'inline-flex' }}
                          >
                            View on Shopify →
                          </a>
                        ) : null;
                      })()
                    ) : null}
                    <ActionDeliverableCard
                      title={msg.task.action?.title ?? 'Result'}
                      channel={msg.task.action?.channel ?? 'content'}
                      execution={msg.task.result.execution}
                      routingReasoning={msg.task.routing}
                      aiReasoning={extractExecutionReasoning(msg.task.result.execution)}
                      scopeWarning={msg.task.result.scopeWarning}
                      canExecute={msg.task.result.canExecute}
                      embedded
                    />
                  </div>
                ) : null}
              </div>
            ))}
            {running ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <div className="thinking-pulse" style={{ width: 8, height: 8 }} />
                <span className="t-dim" style={{ fontSize: 13 }}>
                  Thinking…
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="agent-chat-suggestions">
          <p className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', margin: '0 0 8px' }}>
            TRY ASKING
          </p>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="agent-chat-suggestion"
              disabled={disabled || running}
              onClick={() => void send(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="agent-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          type="text"
          className="auth-input agent-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Write a Shopify blog post about men's skincare"
          disabled={disabled || running}
        />
        <Button
          variant="primary"
          type="submit"
          className="agent-chat-send"
          disabled={disabled || running || !input.trim()}
        >
          {running ? 'Running…' : 'Send'}
        </Button>
      </form>
    </Card>
  );
}
