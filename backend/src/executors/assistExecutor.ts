import type { PlanAction } from '../types/plan.js';
import type { AssistDeliverable } from '../types/execution.js';
import { ClaudeService } from '../services/claudeService.js';

export class AssistExecutor {
  private claude = new ClaudeService();

  async generate(
    action: PlanAction,
    context: { goal: string; businessContext?: string | null }
  ): Promise<AssistDeliverable> {
    return this.claude.generateActionAssist({
      action,
      goal: context.goal,
      businessContext: context.businessContext,
    });
  }
}
