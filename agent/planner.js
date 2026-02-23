/**
 * agent/planner.js
 * Generates a structured multi-step plan from a raw task description.
 * The plan is used by the loop to track high-level progress.
 */

import axios from 'axios';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

const PLANNER_SYSTEM = `You are a senior software architect and project planner.
Given a development task, produce a clear numbered plan of discrete, actionable steps.
Your output must be valid JSON only – no prose outside the JSON block.

Output format:
{
  "goal": "One sentence describing the overall goal",
  "steps": [
    "Step 1 description",
    "Step 2 description",
    ...
  ],
  "estimatedComplexity": "low|medium|high",
  "requiredTools": ["terminal", "filesystem", "browser", "search", "github"]
}`;

export class Planner {
  /**
   * Generate a plan for the given task and project context.
   * @param {string} task
   * @param {string} projectContext
   * @returns {Promise<{goal: string, steps: string[], estimatedComplexity: string, requiredTools: string[]}>}
   */
  async generatePlan(task, projectContext = '') {
    const userMessage = [
      `TASK: ${task}`,
      projectContext ? `PROJECT CONTEXT:\n${projectContext}` : '',
      'Generate the step-by-step plan now.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const payload = {
      model: config.ollama.model,
      messages: [
        { role: 'system', content: PLANNER_SYSTEM },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      options: { temperature: 0.2, num_ctx: config.ollama.options.num_ctx },
      format: 'json',
    };

    try {
      const response = await axios.post(
        `${config.ollama.baseUrl}/api/chat`,
        payload,
        { timeout: config.ollama.timeout }
      );

      const raw = response.data?.message?.content || '{}';
      logger.debug(`[Planner] Raw plan response: ${raw}`);
      const plan = JSON.parse(raw);

      return {
        goal: plan.goal || task,
        steps: Array.isArray(plan.steps) ? plan.steps : [task],
        estimatedComplexity: plan.estimatedComplexity || 'medium',
        requiredTools: Array.isArray(plan.requiredTools) ? plan.requiredTools : ['terminal', 'filesystem'],
      };
    } catch (err) {
      logger.warn(`[Planner] Plan generation failed: ${err.message}. Using single-step plan.`);
      return {
        goal: task,
        steps: [task],
        estimatedComplexity: 'medium',
        requiredTools: ['terminal', 'filesystem'],
      };
    }
  }

  /**
   * Format a plan into a human-readable string for status messages.
   */
  formatPlan(plan) {
    const lines = [
      `📋 *Goal:* ${plan.goal}`,
      `📊 Complexity: ${plan.estimatedComplexity}`,
      `🔧 Tools: ${plan.requiredTools.join(', ')}`,
      '',
      '*Steps:*',
      ...plan.steps.map((s, i) => `  ${i + 1}. ${s}`),
    ];
    return lines.join('\n');
  }
}
