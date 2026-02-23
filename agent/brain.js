/**
 * agent/brain.js
 * The central reasoning engine. Communicates with Ollama to reason,
 * plan, and decide next actions based on context and memory.
 */

import axios from 'axios';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You are ClawBot, a fully autonomous AI developer agent running locally on a MacBook.
You can execute shell commands, read/write files, browse websites, search the web, and interact with GitHub.
You reason step-by-step and use structured JSON responses so your actions can be parsed and executed automatically.

TOOL CALLS:
When you want to perform an action, output a JSON block inside triple backticks tagged as "json" with this structure:
\`\`\`json
{
  "thought": "Why I am taking this step",
  "action": "terminal|filesystem_read|filesystem_write|browser|search|github|done|error",
  "params": { ... action-specific parameters ... }
}
\`\`\`

ACTION SCHEMAS:
- terminal:         { "command": "<shell command>" }
- filesystem_read:  { "path": "<file or dir path>" }
- filesystem_write: { "path": "<file path>", "content": "<file content>" }
- browser:          { "operation": "open|click|fill|scrape|screenshot", "url": "...", "selector": "...", "value": "..." }
- search:           { "query": "<search query>" }
- github:           { "operation": "clone|commit|push|pr", "repo": "...", "branch": "...", "message": "..." }
- done:             { "summary": "<what was accomplished>" }
- error:            { "message": "<describe the unrecoverable situation>" }

RULES:
1. Always think before acting. Put your reasoning in "thought".
2. One action per response.
3. After a terminal command, wait for the result before proceeding.
4. Never issue dangerous commands (rm -rf /, format disk, shutdown).
5. When the task is fully complete, use action "done".
6. If you cannot proceed, use action "error" with a clear message.
7. Keep responses concise – only output the JSON block plus a brief explanation.`;

export class Brain {
  constructor() {
    this.conversationHistory = [];
    this.model = config.ollama.model;
  }

  /**
   * Reset conversation context for a new task
   */
  reset() {
    this.conversationHistory = [];
  }

  /**
   * Send a message to Ollama and get back a structured response.
   * @param {string} userMessage - The message / observation to reason about
   * @returns {Promise<{thought: string, action: string, params: object, raw: string}>}
   */
  async think(userMessage) {
    this.conversationHistory.push({ role: 'user', content: userMessage });

    const payload = {
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...this.conversationHistory,
      ],
      stream: false,
      options: config.ollama.options,
    };

    logger.debug(`[Brain] Sending to Ollama (${this.model}), history length: ${this.conversationHistory.length}`);

    let rawResponse;
    try {
      const response = await axios.post(
        `${config.ollama.baseUrl}/api/chat`,
        payload,
        { timeout: config.ollama.timeout }
      );
      rawResponse = response.data?.message?.content || '';
    } catch (err) {
      const msg = err.code === 'ECONNREFUSED'
        ? 'Cannot reach Ollama. Make sure `ollama serve` is running.'
        : `Ollama request failed: ${err.message}`;
      throw new Error(msg);
    }

    this.conversationHistory.push({ role: 'assistant', content: rawResponse });
    logger.debug(`[Brain] Raw response:\n${rawResponse}`);

    const parsed = this._parseResponse(rawResponse);
    return { ...parsed, raw: rawResponse };
  }

  /**
   * Provide feedback (observation) from a tool execution back to the brain.
   * @param {string} observation - The stdout/result of the last action
   */
  observe(observation) {
    const content = `OBSERVATION:\n${observation}`;
    this.conversationHistory.push({ role: 'user', content });
  }

  /**
   * Build the initial reasoning prompt that includes task + project context
   */
  buildInitialPrompt(task, projectContext, memoryContext) {
    const parts = [
      `TASK:\n${task}`,
    ];

    if (projectContext) {
      parts.push(`PROJECT CONTEXT:\n${projectContext}`);
    }

    if (memoryContext) {
      parts.push(`RELEVANT MEMORY:\n${memoryContext}`);
    }

    parts.push('Begin by creating a high-level plan, then start executing step by step. Output the first action now.');
    return parts.join('\n\n');
  }

  /**
   * Ask the brain to evaluate whether the task is complete based on accumulated observations.
   */
  async evaluateCompletion(task, stepResults) {
    const evalPrompt = `ORIGINAL TASK:\n${task}\n\nSTEPS COMPLETED:\n${stepResults.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nIs the task fully complete? If yes, output action "done". If not, output the next action to take.`;

    return this.think(evalPrompt);
  }

  // ─────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────

  _parseResponse(text) {
    // Try to extract a ```json ... ``` block
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/i);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        return {
          thought: parsed.thought || '',
          action: (parsed.action || 'done').toLowerCase(),
          params: parsed.params || {},
        };
      } catch {
        logger.warn('[Brain] Failed to parse extracted JSON block, attempting fallback.');
      }
    }

    // Fallback: try parsing the whole response as JSON
    try {
      const parsed = JSON.parse(text.trim());
      return {
        thought: parsed.thought || '',
        action: (parsed.action || 'done').toLowerCase(),
        params: parsed.params || {},
      };
    } catch {
      // Last resort: treat raw text as a terminal command if it looks like one
      logger.warn('[Brain] Could not parse structured response; wrapping as observation.');
      return {
        thought: 'Model returned unstructured text.',
        action: 'done',
        params: { summary: text.trim() },
      };
    }
  }
}
