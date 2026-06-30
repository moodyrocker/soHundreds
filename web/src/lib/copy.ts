import type { Tone } from '@/lib/channels';

export const GOAL_HEADLINES: Record<Tone, { before: string; em: string; after?: string }> = {
  expert: { before: 'What do you want to ', em: 'achieve', after: '?' },
  coach: { before: "Let's figure out your ", em: 'next big win', after: '.' },
  peer: { before: 'So... ', em: "what's the dream", after: '?' },
  pro: { before: 'Define the ', em: 'objective', after: '.' },
};

export const GOAL_SUBS: Record<Tone, string> = {
  expert: "Tell me the outcome — in your own words. I'll handle the strategy.",
  coach: "Tell me where you want to be. I'll break it down into wins we can hit this week.",
  peer: "Just type it like you'd tell a friend. No marketing jargon required.",
  pro: 'Describe the desired business outcome. Be as specific as you can.',
};

export const PLAN_HEADLINES: Record<Tone, string> = {
  expert: 'Your marketing plan',
  coach: "Your plan — let's go",
  peer: 'Your marketing mission',
  pro: 'Marketing plan',
};

export const THINKING_STATUS: Record<Tone, string[]> = {
  expert: ['Synthesizing strategy', 'Processing', 'Composing plan'],
  coach: ['Building your win plan', 'Researching for you', 'Almost there'],
  peer: ['Doing the thinking', 'Looking stuff up', 'Wrapping it up'],
  pro: ['Generating strategy', 'Analyzing', 'Compiling roadmap'],
};
