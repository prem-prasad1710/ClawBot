/**
 * agent/loop.js
 * The autonomous execution loop:
 * plan → execute → observe → retry/recover → done
 */

import { Brain } from './brain.js';
import { Planner } from './planner.js';
import { AgentMemory } from './memory.js';
import { Terminal } from '../tools/terminal.js';
import { FileSystem } from '../tools/filesystem.js';
import { Browser } from '../tools/browser.js';
import { WebSearch } from '../tools/search.js';
import { GitHub } from '../tools/github.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';

export class AgentLoop {
  constructor({ onStatusUpdate } = {}) {
    this.brain = new Brain();
    this.planner = new Planner();
    this.memory = new AgentMemory();
    this.terminal = new Terminal();
    this.fs = new FileSystem();
    this.browser = new Browser();
    this.search = new WebSearch();
    this.github = new GitHub();

    /** Callback so the Telegram bot can stream status messages */
    this.onStatusUpdate = onStatusUpdate || (() => {});
    this.running = false;
    this.shouldStop = false;
  }

  /** Stop a running task gracefully */
  stop() {
    this.shouldStop = true;
  }

  /**
   * Main entry point. Run a task to completion.
   * @param {string} task - The user's task description
   * @param {string} workDir - The working directory for this task
   * @returns {Promise<{success: boolean, summary: string, steps: number}>}
   */
  async run(task, workDir = config.agent.workspaceDir) {
    this.running = true;
    this.shouldStop = false;
    this.brain.reset();

    const taskId = `task_${Date.now()}`;
    const startTime = Date.now();
    const stepResults = [];
    let stepCount = 0;

    logger.info(`[Loop] Starting task: ${task}`);
    await this.status(`🤖 *Task received:* ${task}\n\n⏳ Analyzing project context…`);

    // 1. Gather project context
    const projectContext = await this.fs.gatherProjectContext(workDir);
    logger.debug(`[Loop] Project context gathered (${projectContext.length} chars)`);

    // 2. Generate plan
    await this.status('🧠 Generating plan…');
    const plan = await this.planner.generatePlan(task, projectContext);
    await this.status(`${this.planner.formatPlan(plan)}\n\n🚀 Starting execution…`);

    // 3. Retrieve relevant memory
    const memCtx = this.memory.getRelevantContext(task);

    // 4. Build initial prompt
    const initialPrompt = this.brain.buildInitialPrompt(task, projectContext, memCtx);

    // 5. Execution loop
    let retryCount = 0;
    let lastAction = null;

    while (stepCount < config.agent.maxSteps && !this.shouldStop) {
      stepCount++;
      logger.info(`[Loop] Step ${stepCount}/${config.agent.maxSteps}`);

      let decision;
      try {
        decision = stepCount === 1
          ? await this.brain.think(initialPrompt)
          : await this.brain.think(`Continue. Previous action: ${lastAction?.action}. Decide next step.`);
      } catch (err) {
        await this.status(`❌ Brain error: ${err.message}`);
        break;
      }

      const { thought, action, params } = decision;
      lastAction = decision;

      logger.info(`[Loop] Thought: ${thought}`);
      logger.info(`[Loop] Action: ${action} | Params: ${JSON.stringify(params)}`);

      if (thought) {
        await this.status(`💭 *Thinking:* ${thought}`);
      }

      // ── Dispatch action ──────────────────────────────
      let observation = '';
      let actionSuccess = true;

      try {
        observation = await this._dispatchAction(action, params, workDir, task);
      } catch (err) {
        actionSuccess = false;
        observation = `ERROR: ${err.message}`;
        logger.error(`[Loop] Action failed: ${err.message}`);
      }

      // Feed observation back to brain
      this.brain.observe(observation);
      stepResults.push(`[${action}] ${thought} → ${observation.slice(0, 200)}`);

      // Report result
      const icon = actionSuccess ? '✅' : '⚠️';
      const snippet = observation.length > 600
        ? observation.slice(0, 600) + '\n…(truncated)'
        : observation;
      await this.status(`${icon} *Step ${stepCount}:* \`${action}\`\n\`\`\`\n${snippet}\n\`\`\``);

      // Error recovery
      if (!actionSuccess && retryCount < config.agent.maxRetries) {
        retryCount++;
        await this.status(`🔁 Retrying (attempt ${retryCount}/${config.agent.maxRetries})…`);
        this.brain.observe(`The previous step failed. Please fix the issue and retry.`);
        continue;
      }
      retryCount = 0;

      // Check if task is done
      if (action === 'done') {
        const summary = params.summary || 'Task completed.';
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        await this.status(`🎉 *Task complete in ${elapsed}s!*\n\n${summary}`);

        await this.memory.saveTask({
          id: taskId,
          task,
          plan,
          steps: stepResults,
          summary,
          success: true,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        this.running = false;
        return { success: true, summary, steps: stepCount };
      }

      if (action === 'error') {
        const msg = params.message || 'Unknown error';
        await this.status(`❌ *Agent error:* ${msg}`);
        await this.memory.saveTask({
          id: taskId,
          task,
          plan,
          steps: stepResults,
          summary: msg,
          success: false,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
        this.running = false;
        return { success: false, summary: msg, steps: stepCount };
      }
    }

    // Exceeded max steps
    const timeoutMsg = this.shouldStop
      ? 'Task was manually stopped.'
      : `Reached maximum step limit (${config.agent.maxSteps}).`;
    await this.status(`⏹️ ${timeoutMsg}`);
    await this.memory.saveTask({
      id: taskId,
      task,
      plan,
      steps: stepResults,
      summary: timeoutMsg,
      success: false,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    this.running = false;
    return { success: false, summary: timeoutMsg, steps: stepCount };
  }

  // ─────────────────────────────────────────────
  // Action dispatcher
  // ─────────────────────────────────────────────

  async _dispatchAction(action, params, workDir, task) {
    switch (action) {
      case 'terminal': {
        const cmd = params.command || '';
        await this.status(`🖥️ Running: \`${cmd}\``);
        const result = await this.terminal.runCommand(cmd, workDir);
        return `EXIT ${result.exitCode}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`;
      }

      case 'filesystem_read': {
        const p = params.path || workDir;
        await this.status(`📂 Reading: \`${p}\``);
        return await this.fs.read(p);
      }

      case 'filesystem_write': {
        await this.status(`📝 Writing: \`${params.path}\``);
        await this.fs.write(params.path, params.content || '');
        return `File written: ${params.path}`;
      }

      case 'browser': {
        await this.status(`🌐 Browser: ${params.operation} ${params.url || ''}`);
        return await this.browser.execute(params);
      }

      case 'search': {
        await this.status(`🔍 Searching: "${params.query}"`);
        return await this.search.search(params.query);
      }

      case 'github': {
        await this.status(`🐙 GitHub: ${params.operation}`);
        return await this.github.execute(params, workDir);
      }

      case 'done':
      case 'error':
        return params.summary || params.message || '';

      default:
        return `Unknown action: ${action}`;
    }
  }

  async status(msg) {
    logger.info(`[Status] ${msg.replace(/\*/g, '').replace(/`/g, '')}`);
    try {
      await this.onStatusUpdate(msg);
    } catch (_) { /* non-fatal */ }
  }
}
