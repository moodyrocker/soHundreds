import { query } from '../database/connection.js';
import type {
  RunwayPromptTestApproveInput,
  RunwayPromptTestCreateInput,
  RunwayPromptTestGenerationStatus,
  RunwayPromptTestRecord,
  RunwayPromptTestReviewStatus,
} from '../types/runwayPromptTest.js';
import { BrandVisualLibraryService } from './brandVisualLibraryService.js';
import { ContentRecipeKnowledgeService } from './contentRecipeKnowledgeService.js';
import { previewRecipePromptWithRunway } from './runwayAssistVideoService.js';

type TestRow = {
  id: string;
  organization_id: string;
  title: string;
  prompt_text: string;
  rendered_prompt: string | null;
  style_notes: string | null;
  negative_prompt: string | null;
  use_library_reference: boolean;
  library_image_url: string | null;
  library_title: string | null;
  task_id: string | null;
  image_url: string | null;
  generation_status: RunwayPromptTestGenerationStatus;
  generation_error: string | null;
  review_status: RunwayPromptTestReviewStatus;
  review_notes: string | null;
  brand_visual_id: string | null;
  recipe_id: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: TestRow): RunwayPromptTestRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    promptText: row.prompt_text,
    renderedPrompt: row.rendered_prompt,
    styleNotes: row.style_notes,
    negativePrompt: row.negative_prompt,
    useLibraryReference: row.use_library_reference,
    libraryImageUrl: row.library_image_url,
    libraryTitle: row.library_title,
    taskId: row.task_id,
    imageUrl: row.image_url,
    generationStatus: row.generation_status,
    generationError: row.generation_error,
    reviewStatus: row.review_status,
    reviewNotes: row.review_notes,
    brandVisualId: row.brand_visual_id,
    recipeId: row.recipe_id,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function defaultTitle(promptText: string): string {
  const cleaned = promptText.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled test';
  return cleaned.slice(0, 80) + (cleaned.length > 80 ? '…' : '');
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Org-scoped Runway prompt lab: generate stills, approve/reject, promote to library.
 */
export class RunwayPromptTestService {
  private visuals = new BrandVisualLibraryService();
  private recipes = new ContentRecipeKnowledgeService();

  async list(
    organizationId: string,
    filters?: { reviewStatus?: RunwayPromptTestReviewStatus | 'all' }
  ): Promise<RunwayPromptTestRecord[]> {
    const clauses = ['organization_id = $1'];
    const params: unknown[] = [organizationId];

    if (filters?.reviewStatus && filters.reviewStatus !== 'all') {
      clauses.push('review_status = $2');
      params.push(filters.reviewStatus);
    }

    const result = await query<TestRow>(
      `SELECT * FROM runway_prompt_tests
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT 100`,
      params
    );
    return result.rows.map(mapRow);
  }

  async getById(
    organizationId: string,
    testId: string
  ): Promise<RunwayPromptTestRecord | null> {
    const result = await query<TestRow>(
      `SELECT * FROM runway_prompt_tests WHERE id = $1 AND organization_id = $2`,
      [testId, organizationId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async createAndGenerate(
    organizationId: string,
    input: RunwayPromptTestCreateInput
  ): Promise<RunwayPromptTestRecord> {
    const promptText = input.promptText.trim();
    if (!promptText) throw new Error('Prompt is required');

    const title = (input.title?.trim() || defaultTitle(promptText)).slice(0, 200);
    const styleNotes = input.styleNotes?.trim() || null;
    const negativePrompt = input.negativePrompt?.trim() || null;
    const useLibraryReference = input.useLibraryReference !== false;

    let imageUrl: string | null = null;
    let taskId: string | null = null;
    let renderedPrompt: string | null = null;
    let libraryImageUrl: string | null = null;
    let libraryTitle: string | null = null;
    let generationStatus: RunwayPromptTestGenerationStatus = 'succeeded';
    let generationError: string | null = null;

    try {
      const preview = await previewRecipePromptWithRunway({
        organizationId,
        promptTemplate: promptText,
        styleNotes,
        negativePrompt,
        recipeName: title,
        useLibraryReference,
        requireLibraryReference: useLibraryReference,
        libraryAssetId: input.libraryAssetId,
      });
      imageUrl = preview.imageUrl;
      taskId = preview.taskId;
      renderedPrompt = preview.promptText;
      libraryImageUrl = preview.libraryImageUrl;
      libraryTitle = preview.libraryTitle;
    } catch (err) {
      generationStatus = 'failed';
      generationError = err instanceof Error ? err.message : 'Runway generation failed';
    }

    const result = await query<TestRow>(
      `INSERT INTO runway_prompt_tests (
         organization_id, title, prompt_text, rendered_prompt, style_notes, negative_prompt,
         use_library_reference, library_image_url, library_title, task_id, image_url,
         generation_status, generation_error, review_status
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, $13, 'pending'
       )
       RETURNING *`,
      [
        organizationId,
        title,
        promptText.slice(0, 4000),
        renderedPrompt,
        styleNotes,
        negativePrompt,
        useLibraryReference,
        libraryImageUrl,
        libraryTitle,
        taskId,
        imageUrl,
        generationStatus,
        generationError,
      ]
    );
    return mapRow(result.rows[0]);
  }

  async approve(
    organizationId: string,
    testId: string,
    input: RunwayPromptTestApproveInput = {}
  ): Promise<RunwayPromptTestRecord> {
    const current = await this.getById(organizationId, testId);
    if (!current) throw new Error('Test not found');
    if (current.generationStatus !== 'succeeded' || !current.imageUrl) {
      throw new Error('Only successful generations can be approved');
    }
    if (current.reviewStatus === 'approved' && current.brandVisualId) {
      return current;
    }

    const title = (input.title?.trim() || current.title).slice(0, 200);
    const asset = await this.visuals.create(organizationId, {
      title,
      imageUrl: current.imageUrl,
      theme: input.theme?.trim() || current.renderedPrompt?.slice(0, 500) || null,
      notes:
        input.notes?.trim() ||
        `Approved from Runway lab · prompt: ${current.promptText.slice(0, 240)}`,
      tags: [
        'runway-lab',
        ...(input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      ].slice(0, 20),
      useFor: input.useFor ?? 'any',
      isActive: true,
    });

    let recipeId = current.recipeId;
    if (input.saveAsRecipe && !recipeId) {
      const recipeName = (input.recipeName?.trim() || title).slice(0, 200);
      const slugBase = slugify(recipeName) || 'runway-lab';
      const slug = `${slugBase}-${Date.now().toString(36).slice(-4)}`;
      const recipe = await this.recipes.create(organizationId, {
        slug,
        name: recipeName,
        description: 'Saved from Runway lab after approving a still preview',
        medium: 'image',
        provider: 'runway',
        channel: 'instagram',
        promptTemplate: current.promptText,
        styleNotes: current.styleNotes,
        negativePrompt: current.negativePrompt,
        model: 'gen4_image',
        aspectRatio: '1080:1920',
        durationSeconds: null,
        tags: ['runway-lab', 'approved'],
        isDefault: false,
        isActive: true,
        config: {
          runwayPath: '/text_to_image',
          catalogSource: 'user_custom',
          fromPromptTestId: testId,
        },
      });
      recipeId = recipe.id;
    }

    const result = await query<TestRow>(
      `UPDATE runway_prompt_tests SET
         title = $3,
         review_status = 'approved',
         review_notes = $4,
         brand_visual_id = $5,
         recipe_id = $6,
         reviewed_at = NOW(),
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [
        testId,
        organizationId,
        title,
        input.notes?.trim() || null,
        asset.id,
        recipeId,
      ]
    );
    return mapRow(result.rows[0]);
  }

  async reject(
    organizationId: string,
    testId: string,
    reviewNotes?: string | null
  ): Promise<RunwayPromptTestRecord> {
    const current = await this.getById(organizationId, testId);
    if (!current) throw new Error('Test not found');
    if (current.reviewStatus === 'approved') {
      throw new Error('Approved tests cannot be rejected — remove the visual from the library instead');
    }

    const result = await query<TestRow>(
      `UPDATE runway_prompt_tests SET
         review_status = 'rejected',
         review_notes = $3,
         reviewed_at = NOW(),
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [testId, organizationId, reviewNotes?.trim() || null]
    );
    return mapRow(result.rows[0]);
  }

  async delete(organizationId: string, testId: string): Promise<void> {
    await query(`DELETE FROM runway_prompt_tests WHERE id = $1 AND organization_id = $2`, [
      testId,
      organizationId,
    ]);
  }
}
