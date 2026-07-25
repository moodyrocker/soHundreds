import { query } from '../database/connection.js';
import {
  parseAutopilotPace,
  type AutopilotPace,
} from '../lib/autopilotPaceConfig.js';

export type AutopilotMode = 'assist' | 'hands_off';
export type { AutopilotPace };

export async function getAutopilotMode(organizationId: string): Promise<AutopilotMode> {
  const result = await query<{ autopilot_mode: string }>(
    `SELECT autopilot_mode FROM organizations WHERE id = $1`,
    [organizationId]
  );
  const mode = result.rows[0]?.autopilot_mode;
  return mode === 'hands_off' ? 'hands_off' : 'assist';
}

export async function setAutopilotMode(
  organizationId: string,
  mode: AutopilotMode
): Promise<AutopilotMode> {
  const result = await query<{ autopilot_mode: AutopilotMode }>(
    `UPDATE organizations SET autopilot_mode = $2 WHERE id = $1 RETURNING autopilot_mode`,
    [organizationId, mode]
  );
  if (!result.rows[0]) {
    throw new Error('Organization not found');
  }
  return result.rows[0].autopilot_mode;
}

export async function getAutopilotPace(organizationId: string): Promise<AutopilotPace> {
  const result = await query<{ autopilot_pace: string | null }>(
    `SELECT autopilot_pace FROM organizations WHERE id = $1`,
    [organizationId]
  );
  return parseAutopilotPace(result.rows[0]?.autopilot_pace);
}

export async function setAutopilotPace(
  organizationId: string,
  pace: AutopilotPace
): Promise<AutopilotPace> {
  const normalized = parseAutopilotPace(pace);
  const result = await query<{ autopilot_pace: string }>(
    `UPDATE organizations SET autopilot_pace = $2 WHERE id = $1 RETURNING autopilot_pace`,
    [organizationId, normalized]
  );
  if (!result.rows[0]) {
    throw new Error('Organization not found');
  }
  return parseAutopilotPace(result.rows[0].autopilot_pace);
}
