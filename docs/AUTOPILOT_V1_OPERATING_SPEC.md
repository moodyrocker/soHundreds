# Autopilot V1 Operating Spec

**Version:** v1  
**Status:** Active  
**Principle:** `Autopilot = product`, `Control room = optional depth`

## Goal

Run a continuous, mostly hands-off operating loop:

1. Decide this week's highest-leverage actions
2. Execute safely (agent + human spend gates)
3. Measure against a real goal metric
4. Adapt next cycle using outcomes

The agent should only generate artifacts (reports, logs, stored data) that directly improve decisions.

## Core Decision Gate (applies before report generation or data storage)

### Gate 1 — Action value now

Question: **Does this report unlock a decision or action today?**

- **Yes:** generate it and attach the action it changes.
- **No:** skip report generation.

### Gate 2 — Reasoning value later

Question: **Will storing this data improve future decisions?**

- **Yes:** store with metadata:
  - why it matters
  - how to use it in future cycles
  - metric context (goal, channel, execution type)
- **No:** skip storage.

### Gate 3 — Reflection value now

Question: **Is this a meaningful pause point?**

- **Yes:** pause, summarize learnings, propose the next adjustment.
- **No:** continue the cycle.

## Decision Thresholds (v1)

### Continue automatically

Continue hands-off when all are true:

- Goal status is `on_track` or `met`
- At least one trusted data source is available for the goal metric
- No failed actions waiting for human correction
- No ad-spend unlock pending

### Pause for review (human-in-the-loop)

Pause when any are true:

- Goal status is `unknown`
- Goal status is `behind`
- Goal metric has no connected data source
- A paid campaign requires spend enablement
- Sequential run has a failed action

### Paid Meta create throttle (critical)

Multiple Meta campaigns are allowed. What is **not** allowed: stacking new campaigns while earlier ones still have **$0 spend** (no performance signal).

Do **not** create another Meta campaign while:

- Prior Meta campaigns are paused / pushed with **$0 spend** in the last 30 days, **or**
- Meta campaigns are parked awaiting spend enablement and the account still shows no spend

When spend exists, **feed campaign performance into planning** (spend, clicks, impressions, purchases) and prefer doubling down on what worked before adding a new test.

Continue Instagram / Shopify / content meanwhile. New Meta experiments resume once there is data to learn from.

### Stop cycle

Stop when:

- Goal status is `met`, or
- User explicitly pauses/cancels

## Confidence Gates (v1)

Autopilot confidence is block-level, used to decide continue vs pause.

- **High confidence**
  - Goal progress is `met` or `on_track`
  - Goal metric has live source(s)
  - At least one scored action outcome in the block
- **Medium confidence**
  - Goal progress is `on_track`
  - Source is present but outcomes are sparse
- **Low confidence**
  - Goal progress is `unknown` or `behind`, or
  - Goal metric source is missing

Policy:

- High/Medium -> continue hands-off
- Low -> schedule review pause and require explicit continuation

## Pause Triggers (v1)

Autopilot pauses only at meaningful control points:

1. End-of-block checkpoint with low confidence
2. End-of-block checkpoint with `behind`/`unknown` progress
3. Paid-campaign human spend gate
4. Execution failure requiring operator fix

No fixed daily pause cadence.

## Storage Rules (v1)

### Must store

- Decision + outcome trails (`action_outcomes`, `goal_week_outcomes`, audit)
- Conversion/ROI/attribution signals tied to goal metrics
- Learned channel/execution patterns with confidence and sample size

### Do not store by default

- Vanity metrics without conversion or goal context
- Long reports that are not referenced by later decisions
- Duplicate snapshots with no action delta

## Surface Model

- **Autopilot Home (`/`)**: primary operating surface (critical path)
- **Control room (`/plan`)**: optional history/refinement/debug surface

Control room must not be required to complete the happy path.

