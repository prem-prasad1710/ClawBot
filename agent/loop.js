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
import { EmailTool } from '../tools/email.js';
import { Reporter } from '../tools/reporter.js';
import { Calculator } from '../tools/calculator.js';
import { CodeRunner } from '../tools/coderunner.js';
import { Reminder } from '../tools/reminder.js';
import { Calendar } from '../tools/calendar.js';
import { DailyBriefing } from '../tools/dailybriefing.js';
import { Clipboard } from '../tools/clipboard.js';
import { SysInfo } from '../tools/sysinfo.js';
import { Notes } from '../tools/notes.js';
import { Screenshot } from '../tools/screenshot.js';
import { Spotify } from '../tools/spotify.js';
import { PDFReader } from '../tools/pdf.js';
import { Translator } from '../tools/translate.js';
import { Contacts } from '../tools/contacts.js';
import { NetworkTools } from '../tools/network.js';
import { Compress } from '../tools/compress.js';
import { WeatherTool } from '../tools/weather.js';
import { Pomodoro } from '../tools/pomodoro.js';
import { HabitTracker } from '../tools/habits.js';
import { CryptoPriceTool } from '../tools/crypto.js';
import { WorldClock } from '../tools/worldclock.js';
import { VoiceNote } from '../tools/voicenote.js';
import { QRCodeTool } from '../tools/qrcode.js';
import { ImageLook } from '../tools/imagelook.js';
import { FileWatcher } from '../tools/filewatcher.js';
import { Automation } from '../tools/automation.js';
import { DevTools } from '../tools/devtools.js';
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
    this.email = new EmailTool();
    this.reporter = new Reporter();
    this.calculator = new Calculator();
    this.codeRunner = new CodeRunner();
    this.reminder = new Reminder();
    this.calendar = new Calendar();
    this.briefing = new DailyBriefing();
    this.clipboard  = new Clipboard();
    this.sysinfo    = new SysInfo();
    this.notes      = new Notes();
    this.screenshot = new Screenshot();
    this.spotify    = new Spotify();
    this.pdf        = new PDFReader();
    this.translator = new Translator();
    this.contacts   = new Contacts();
    this.network    = new NetworkTools();
    this.compress   = new Compress();
    this.weather    = new WeatherTool();
    this.pomodoro   = new Pomodoro();
    this.habits     = new HabitTracker();
    this.crypto     = new CryptoPriceTool();
    this.worldclock = new WorldClock();
    this.voiceNote  = new VoiceNote();
    this.qrcode     = new QRCodeTool();
    this.imageLook  = new ImageLook();
    this.fileWatcher = new FileWatcher();
    this.automation = new Automation();
    this.devtools   = new DevTools();

    /** Callback so the Telegram bot can stream status messages */
    this.onStatusUpdate = onStatusUpdate || (() => {});
    this.running = false;
    this.shouldStop = false;

    // Persisted across loop steps — set by _prepareRepoContext
    this.repoDir  = null;
    this.repoName = null;
    this.fileTree = null;  // file tree for path guidance at every step
  }

  /**
   * Inject user profile + conversation history so the brain feels personal.
   * Call this before run().
   */
  setUserContext(userProfile, conversationHistory = []) {
    this.brain.setUserContext(userProfile, conversationHistory);
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
    this.repoDir  = null;  // reset per-run
    this.repoName = null;
    this.fileTree = null;

    const taskId = `task_${Date.now()}`;
    const startTime = Date.now();
    const stepResults = [];
    let stepCount = 0;

    logger.section(`TASK STARTED`);
    logger.info(`[Loop] Task: "${task}"`);
    logger.info(`[Loop] Work dir: ${workDir}`);
    await this.status(`🤖 *Task received:* ${task}`);

    // ── Last-resort guard: if this slipped through as TASK but is clearly
    //    a greeting/chitchat, handle it as a chat reply without any loop overhead.
    if (this._isObviousChitChat(task)) {
      logger.info(`[Loop] Detected chit-chat in loop – short-circuiting to chat reply.`);
      const reply = await this._quickChatReply(task);
      await this.status(reply);
      await this._saveTask(taskId, task, { goal: task, steps: [task], estimatedComplexity: 'low', requiredTools: [] }, [reply], reply, true, startTime);
      this.running = false;
      return { success: true, summary: reply, steps: 0 };
    }

    // ── Classify task to pick the right execution strategy ──────────────
    const isInfoQuery = this._isInfoQuery(task);
    const isDevTask   = !isInfoQuery && this._isCodingOrActionTask(task);

    // 1. Gather project context only for real dev tasks (saves 2-5s for simple queries)
    let projectContext = '';
    if (isDevTask) {
      await this.status('⏳ Reading project context…');
      projectContext = await this.fs.gatherProjectContext(workDir);
      logger.debug(`[Loop] Project context: ${projectContext.length} chars`);
    }

    // ── Auto repo preparation ────────────────────────────────────────────────
    // When the task is about working on a specific repo, clone + read it
    // automatically so the brain starts with full project context.
    let autoRepoContext = '';
    const repoTask = this._detectRepoTask(task);
    if (repoTask) {
      autoRepoContext = await this._prepareRepoContext(repoTask, workDir);
      if (autoRepoContext) {
        projectContext = autoRepoContext; // override with richer repo context
      }
    }

    // 2. Generate plan for all dev tasks
    let plan = { goal: task, steps: [task], estimatedComplexity: 'low', requiredTools: [] };
    if (isDevTask) {
      await this.status('🧠 Planning…');
      plan = await this.planner.generatePlan(task, projectContext);
      await this.status(this.planner.formatPlan(plan));
    }

    await this.status('🚀 Executing…');

    // 3. Retrieve relevant memory
    const memCtx = this.memory.getRelevantContext(task);

    // 4. Build initial prompt
    const initialPrompt = this.brain.buildInitialPrompt(task, projectContext, memCtx);

    // 5. Execution loop
    let retryCount = 0;
    let lastObservation = '';
    const actionHistory = []; // {action, paramsKey} for repetition detection

    while (stepCount < config.agent.maxSteps && !this.shouldStop) {
      stepCount++;
      logger.info(`[Loop] Step ${stepCount}/${config.agent.maxSteps}`);

      let decision;
      try {
        if (stepCount === 1) {
          decision = await this.brain.think(initialPrompt);
        } else {
          // Full history so brain knows exactly what it has already done
          const histSummary = stepResults
            .map((s, i) => `Step ${i + 1}: ${s}`)
            .join('\n');

          let continuePrompt;
          if (this.repoDir) {
            // ── Coding task: re-surface repo path + file tree ──────────────
            const repoCtx = `\nACTIVE REPO: ${this.repoName}\nPATH: ${this.repoDir}\n`;
            const treeSection = this.fileTree
              ? `\nFILE TREE (use ONLY these exact relative paths under PATH above):\n${this.fileTree.split('\n').slice(0, 60).join('\n')}\n`
              : '';
            continuePrompt =
              `TASK: "${task}"${repoCtx}${treeSection}` +
              `STEPS DONE SO FAR:\n${histSummary}\n\n` +
              `LAST OBSERVATION:\n${lastObservation}\n\n` +
              `NEXT action? Build absolute paths as: PATH + '/' + relative path from FILE TREE.\n` +
              `If ALL changes are implemented and verified → fire "done". Output ONLY the JSON block.`;
          } else {
            // ── Simple task: clean prompt, no repo noise ────────────────────
            continuePrompt =
              `TASK: "${task}"\n\n` +
              `STEPS DONE SO FAR:\n${histSummary}\n\n` +
              `LAST OBSERVATION:\n${lastObservation}\n\n` +
              `Does the LAST OBSERVATION already answer / complete the task?\n` +
              `YES → output action "done" with a clear summary.\n` +
              `NO  → output the NEXT action needed.\n` +
              `Output ONLY the JSON block.`;
          }
          decision = await this.brain.think(continuePrompt);
        }
      } catch (err) {
        await this.status(`❌ Brain error: ${err.message}`);
        break;
      }

      const { thought, action, params } = decision;

      logger.info(`[Loop] ─── Step ${stepCount} ───────────────────────────`);
      logger.info(`[Loop] Thought : ${thought}`);
      logger.info(`[Loop] Action  : ${action}`);
      logger.debug(`[Loop] Params  : ${JSON.stringify(params, null, 2)}`);

      // ── Repetition guard ─────────────────────────────
      // If the brain repeats the same successful action twice, force done
      const paramsKey = JSON.stringify(params);
      const prevSame = actionHistory.filter(
        (h) => h.action === action && h.paramsKey === paramsKey && h.success
      );
      if (prevSame.length >= 1 && action !== 'terminal' && action !== 'search') {
        // Don't exit — correct the model and continue
        logger.warn(`[Loop] Repeated action detected: ${action} — injecting correction`);
        const treeHint = this.fileTree
          ? `\nFILE TREE for reference:\n${this.fileTree.split('\n').slice(0, 40).join('\n')}`
          : '';
        this.brain.observe(
          `⚠️ You repeated the same "${action}" with identical params.\n` +
          `Do NOT repeat it. Move to the NEXT step.\n` +
          `If you already read the file — now WRITE the changes.\n` +
          `If all changes are written — fire "done" with a summary.${treeHint}`
        );
        stepResults.push(`[correction] Duplicate ${action} detected — model nudged to continue`);
        continue;
      }

      if (thought) await this.status(`💭 ${thought}`);

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

      // Track history for repetition detection
      actionHistory.push({ action, paramsKey, success: actionSuccess });

      // ── Auto-done: simple lookup tasks that succeeded in 1 step ──────────
      // If no repo is active, the last action succeeded, and the task is not
      // a coding/multi-step task, fire done immediately with the observation.
      const SINGLE_STEP_ACTIONS = new Set([
        'network','sysinfo','system_info','clipboard_read','spotify',
        'translate','contacts','pdf_read','screenshot',
        'weather','crypto','price','stock','worldclock','timezone',
        'speak','tts','qrcode','qr','devtools','dev','automation','system',
        'disk','files','pomodoro','pomo','focus','habit','habits',
      ]);
      if (
        !this.repoDir &&
        !isDevTask &&
        actionSuccess &&
        SINGLE_STEP_ACTIONS.has(action) &&
        stepCount === 1
      ) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        await this.status(`✅ Done in ${elapsed}s`);
        await this._saveTask(taskId, task, plan, stepResults, observation, true, startTime);
        this.running = false;
        return { success: true, summary: observation, steps: stepCount };
      }

      const obsPreview = observation.slice(0, 200).replace(/\n/g, ' ');
      logger.debug(`[Loop] Observation (${actionSuccess ? 'OK' : 'FAIL'}): ${obsPreview}${observation.length > 200 ? '…' : ''}`);

      // Detect "path not found" — mark as failure and inject file tree so model corrects itself
      if (
        action === 'filesystem_read' &&
        (observation.includes('Path not found') || observation.includes('not found') ||
         observation.includes('ENOENT') || observation.includes('Cannot read'))
      ) {
        actionSuccess = false;
        const rawTree = this.fileTree || '';
        const treeLines = rawTree.split('\n').slice(0, 50).join('\n');
        const treeHint = treeLines
          ? `\n\nFILE TREE (pick paths from here ONLY):\n${treeLines}`
          : '';
        this.brain.observe(
          `⚠️ FILE NOT FOUND: "${params.path}" does not exist.\n` +
          `NEVER repeat this path. Pick the correct path from the FILE TREE.\n` +
          `Build absolute paths as: ${this.repoDir || 'REPO_PATH'} + '/' + relative path from tree.${treeHint}`
        );
      } else {
        // Feed observation back to brain normally
        this.brain.observe(observation);
      }
      lastObservation = observation;
      stepResults.push(`[${action}] ${thought} → ${observation.slice(0, 200)}`);

      // Report result – skip for chat/done (they send their own final message)
      if (action !== 'chat' && action !== 'done' && action !== 'error') {
        const icon = actionSuccess ? '✅' : '⚠️';
        const snippet = observation.length > 800
          ? observation.slice(0, 800) + '\n…(truncated)'
          : observation;
        // Only show code-block wrapper for multi-line output
        const formatted = snippet.includes('\n')
          ? `${icon} \`${action}\`\n\`\`\`\n${snippet}\n\`\`\``
          : `${icon} \`${action}\`: ${snippet}`;
        await this.status(formatted);
      }

      // Error recovery
      if (!actionSuccess && retryCount < config.agent.maxRetries) {
        retryCount++;
        await this.status(`🔁 Retrying (attempt ${retryCount}/${config.agent.maxRetries})…`);
        this.brain.observe(`The previous step failed. Please fix the issue and retry.`);
        continue;
      }
      retryCount = 0;

      // Check if task is done
      if (action === 'chat' || action === 'brainstorm') {
        const reply = params.reply || observation;
        await this.status(reply);
        await this._saveTask(taskId, task, plan, stepResults, reply, true, startTime);
        this.running = false;
        return { success: true, summary: reply, steps: stepCount };
      }

      // Check if task is done
      if (action === 'done') {
        // If the brain gave no real summary, surface the last meaningful observation
        const rawSummary = params.summary || '';
        const isGeneric = !rawSummary || rawSummary.trim() === 'Task completed.';
        const summary = isGeneric && lastObservation && lastObservation.length > 2
          ? lastObservation
          : (rawSummary || 'Task completed.');
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        // Send the result as its own message, then the done confirmation
        if (isGeneric && lastObservation && lastObservation.length > 2) {
          const snippet = lastObservation.length > 3000
            ? lastObservation.slice(0, 3000) + '\n…(truncated)'
            : lastObservation;
          await this.status(snippet.includes('\n') ? `\`\`\`\n${snippet}\n\`\`\`` : snippet);
        }
        await this.status(`✅ Done in ${elapsed}s`);
        await this._saveTask(taskId, task, plan, stepResults, summary, true, startTime);
        this.running = false;
        return { success: true, summary, steps: stepCount };
      }

      if (action === 'error') {
        const msg = params.message || params.summary || lastObservation || 'Task could not be completed.';
        await this.status(`❌ ${msg}`);
        await this._saveTask(taskId, task, plan, stepResults, msg, false, startTime);
        this.running = false;
        return { success: false, summary: msg, steps: stepCount };
      }
    }

    // Exceeded max steps
    const timeoutMsg = this.shouldStop
      ? 'Task was manually stopped.'
      : `Reached maximum step limit (${config.agent.maxSteps}).`;
    await this.status(`⏹️ ${timeoutMsg}`);
    await this._saveTask(taskId, task, plan, stepResults, timeoutMsg, false, startTime);
    this.running = false;
    return { success: false, summary: timeoutMsg, steps: stepCount };
  }

  // ─────────────────────────────────────────────
  // Repo auto-preparation
  // ─────────────────────────────────────────────

  /**
   * Detect if the task is a coding/project task that requires cloning a repo.
   * Returns the repo name hint (e.g. "ritualOS") or 'ANY' (fetch latest) or null (not a repo task).
   */
  _detectRepoTask(task) {
    const lower = task.toLowerCase();

    // Hard-exclude pure info queries
    if (/^(what is|who is|explain|define|tell me about|how does|what does)\b/.test(lower) && lower.length < 80) return null;

    // Any mention of "my project / repo / codebase / app" is a repo task
    const repoRefPatterns = [
      /\bmy\s+(project|repo|codebase|app|application|website|api|backend|frontend|service|code|bot)\b/i,
      /\b(work\s+on|work\s+with|start\s+working|dive\s+into|jump\s+into|look\s+at|check\s+out|look\s+into)\b/i,
      /\b(help\s+me\s+(build|fix|implement|add|update|refactor|create))\b/i,
      /\b(add\s+(a\s+)?(feature|functionality|endpoint|route|page|component|module|test|button|api))\b/i,
      /\b(implement|integrate|wire\s+up|connect|set\s+up|configure)\b.*\b(in|for|to|into)\b.*\b(my|the)\b/i,
      /\b(fix|debug|resolve|patch|update|refactor|optimize|improve|upgrade)\b.*\b(in|the|my)\b.*\b(project|app|code|repo|codebase|file|bug|issue|error)\b/i,
      /\b(clone|pull|push|commit|deploy)\b/i,
    ];

    if (!repoRefPatterns.some(p => p.test(task))) return null;

    // ── Extract explicit project name ───────────────────────────────────────
    // Pattern: "my <Name> project|app|repo" — take <Name>
    const explicitMatch =
      task.match(/\bmy\s+(\w[\w.-]+)\s+(?:project|repo|app|codebase|application|website|api|backend|frontend|service|bot)\b/i) ||
      task.match(/\b(?:work\s+on|work\s+in|add.*to|fix.*in|implement.*in|update.*in|build.*for)\s+(?:my\s+|the\s+)?(\w[\w.-]+)\b/i) ||
      task.match(/\b(\w[\w.-]+)\s+(?:project|repo|app|codebase|application|website)\b/i);

    if (explicitMatch) {
      const name = explicitMatch[1];
      // Filter out generic words
      const GENERIC = /^(my|the|your|our|this|a|an|it|new|old|main|good|full|last|next|some|any|all|small|large|big|simple|basic|quick|fast|build|fix|add|make|run|use|code|app|api|web|site|data|test|dev|prod|stage|cloud|local|node|react|vue|django|flask|rails|express|spring|laravel)$/i;
      if (!GENERIC.test(name) && name.length >= 3) return name;
    }

    // ── Fallback: pick any CamelCase / hyphenated / long word not in stop-list  
    const STOP = new Set([
      'work','working','start','help','build','fix','add','make','run','use','look','check','dive','jump',
      'project','codebase','repo','app','feature','task','code','the','my','your','our','me','implement',
      'create','write','update','refactor','integrate','deploy','push','pull','commit','clone','with',
      'for','and','into','this','that','have','need','want','please','can','could','would','should','will',
    ]);
    const words = task.split(/\s+/);
    for (const word of words) {
      const clean = word.replace(/[^a-zA-Z0-9_-]/g, '');
      if (clean.length >= 4 && !STOP.has(clean.toLowerCase())) {
        // Prefer: CamelCase, hyphenated, or words containing digits (version numbers)
        if (/[A-Z][a-z]/.test(clean) || clean.includes('-') || /[a-zA-Z]\d/.test(clean)) {
          return clean;
        }
      }
    }
    return 'ANY'; // user said "my project" without naming it → fetch most recent
  }

  /**
   * Fetch repos, find best match, clone, and read enough code context
   * so the brain can actually implement changes without guessing.
   */
  async _prepareRepoContext(repoHint, workDir) {
    try {
      await this.status(`🔍 Finding *${repoHint === 'ANY' ? 'your project' : repoHint}* on GitHub…`);

      // 1. List repos
      const listResult = await this.github.listRepos();
      if (!listResult || listResult.startsWith('No repositor')) return '';

      // 2. Find best matching repo
      const lines = listResult.split('\n').filter(l => /^\d+\./.test(l));
      let matched = null;
      if (repoHint !== 'ANY') {
        const hint = repoHint.toLowerCase();
        matched =
          lines.find(l => l.toLowerCase().includes('/' + hint + ' '))   ||
          lines.find(l => l.toLowerCase().includes('/' + hint + '–'))   ||
          lines.find(l => l.toLowerCase().split('/')[1]?.startsWith(hint)) ||
          lines.find(l => l.toLowerCase().includes(hint));
      }
      if (!matched) matched = lines[0];
      if (!matched) return '';

      const repoMatch = matched.match(/\d+\.\s+([\w.-]+\/[\w.-]+)/);
      if (!repoMatch) return '';
      const fullRepo = repoMatch[1];
      const repoName = fullRepo.split('/')[1];
      const cloneDir = `${workDir}/${repoName}`;

      // 3. Clone (skip if already present, try main then master)
      const { existsSync } = await import('fs');
      if (existsSync(cloneDir)) {
        await this.status(`📂 *${fullRepo}* already in workspace — pulling latest changes…`);
        try { await this.terminal.runCommand(`git -C "${cloneDir}" pull --ff-only`, workDir); } catch (_) {}
      } else {
        await this.status(`📦 Cloning *${fullRepo}* into workspace…`);
        try {
          await this.github.clone(fullRepo, workDir, 'main');
        } catch (_) {
          try {
            await this.github.clone(fullRepo, workDir, null);
          } catch (e2) {
            await this.status(`⚠️ Could not clone ${fullRepo}: ${e2.message}`);
            return '';
          }
        }
      }

      // Save repo location for use across all loop steps
      this.repoDir  = cloneDir;
      this.repoName = repoName;
      this.fileTree = fileTree;  // saved so continuePrompt can re-surface it

      // 4. Full directory tree (exclude node_modules / .git / __pycache__ / .next)
      let fileTree = '';
      try {
        const { stdout } = await this.terminal.runCommand(
          `find "${cloneDir}" -type f ` +
          `! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/__pycache__/*" ` +
          `! -path "*/.next/*" ! -path "*/dist/*" ! -path "*/build/*" ` +
          `| sed 's|${cloneDir}/||' | sort | head -80`,
          workDir
        );
        fileTree = stdout || '';
      } catch (_) {
        try { fileTree = await this.fs.read(cloneDir); } catch (_2) {}
      }

      // 5. Read config / manifest files (full content)
      const configFiles = [
        'package.json', 'requirements.txt', 'pyproject.toml',
        'Cargo.toml', 'composer.json', 'go.mod', '.env.example',
      ];
      const configContents = [];
      for (const f of configFiles) {
        try {
          const c = await this.fs.read(`${cloneDir}/${f}`);
          if (c && !c.startsWith('Cannot read') && !c.startsWith('Error')) {
            configContents.push(`=== ${f} ===\n${c.slice(0, 3000)}`);
            break; // one manifest is enough
          }
        } catch (_) {}
      }

      // 6. Read README
      let readme = '';
      for (const rf of ['README.md', 'README.mdx', 'readme.md', 'Readme.md']) {
        try {
          const c = await this.fs.read(`${cloneDir}/${rf}`);
          if (c && !c.startsWith('Cannot read')) { readme = c.slice(0, 2000); break; }
        } catch (_) {}
      }

      // 7. Read primary source entrypoints
      const entryFiles = [
        'index.js', 'app.js', 'server.js', 'main.js', 'index.ts', 'app.ts', 'main.ts',
        'src/index.js', 'src/app.js', 'src/main.js', 'src/index.ts', 'src/app.ts',
        'main.py', 'app.py', 'run.py', 'manage.py', 'src/main.py',
        'lib/index.js', 'lib/main.js',
      ];
      const sourceContents = [];
      for (const ef of entryFiles) {
        if (sourceContents.length >= 3) break;
        try {
          const c = await this.fs.read(`${cloneDir}/${ef}`);
          if (c && !c.startsWith('Cannot read') && !c.startsWith('Error')) {
            sourceContents.push(`=== ${ef} ===\n${c.slice(0, 3000)}`);
          }
        } catch (_) {}
      }

      await this.status(
        `✅ Loaded *${fullRepo}*\n` +
        `📁 Path: \`${cloneDir}\`\n` +
        `📄 ${fileTree.split('\n').filter(Boolean).length} files found — ready to work!`
      );

      return [
        `══════════════════════════════════`,
        `REPO: ${fullRepo}`,
        `PATH: ${cloneDir}  ← USE THIS for ALL file paths`,
        `══════════════════════════════════`,
        ``,
        `FILE TREE (relative paths):`,
        fileTree,
        readme ? `\n=== README.md ===\n${readme}` : '',
        configContents.join('\n\n'),
        sourceContents.join('\n\n'),
      ].filter(Boolean).join('\n');

    } catch (err) {
      logger.warn(`[Loop] _prepareRepoContext failed: ${err.message}`);
      return '';
    }
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  async _saveTask(id, task, plan, steps, summary, success, startTime) {
    try {
      await this.memory.saveTask({
        id, task, plan, steps, summary, success,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn(`[Loop] Failed to save task memory: ${e.message}`);
    }
  }

  /**
   * True when the task is clearly a coding/dev/project action that needs
   * the full loop (not an info query or simple chat).
   */
  _isCodingOrActionTask(task) {
    const lower = task.toLowerCase();
    const DEV_KEYWORDS = [
      'build', 'create', 'code', 'fix', 'debug', 'install', 'deploy',
      'write', 'implement', 'refactor', 'generate', 'develop', 'clone',
      'push', 'pull', 'run', 'execute', 'setup', 'configure', 'update',
      'upgrade', 'delete', 'add feature', 'add a feature', 'add functionality',
      'integrate', 'wire up', 'connect', 'migrate', 'scaffold', 'init',
      'work on', 'work with', 'help me build', 'help me fix', 'help me implement',
      'my project', 'my repo', 'my codebase', 'my app', 'my api', 'my code',
      'my backend', 'my frontend', 'my website', 'my bot', 'my service',
      'launch', 'start', 'compile', 'lint', 'test', 'npm ', 'pip ', 'yarn ',
    ];
    return DEV_KEYWORDS.some(kw => lower.includes(kw));
  }

  /**
   * True when a message that reached the loop is obviously chit-chat.
   * Mirrors the classifier's _isShortChitChat as a safety net.
   */
  _isObviousChitChat(task) {
    const t = task.trim();
    if (t.length > 35) return false;
    const words = t.split(/\s+/);
    if (words.length > 5) return false;
    const ACTION_WORDS = [
      'build','create','fix','run','make','write','install','deploy','check',
      'generate','search','find','show','open','delete','update','start','stop',
      'email','report','code','debug','test','push','pull','clone','fetch',
      // new tools
      'clipboard','sysinfo','notes','screenshot','spotify','pdf','translate',
      'contacts','network','compress','zip','unzip','extract','ping',
      // natural-language triggers for new tools
      'ip','playing','music','song','track','volume','wifi','clipboard',
      'system','cpu','ram','memory','disk','battery','processes',
    ];
    const lower = t.toLowerCase();
    return !ACTION_WORDS.some((w) => lower.includes(w));
  }

  /**
   * Ask the brain for a single chat reply without storing conversation history.
   */
  async _quickChatReply(task) {
    try {
      const result = await this.brain.quickReply(task, {});
      if (result.text) return result.text;
    } catch (err) {
      logger.warn(`[Loop] quickChatReply failed: ${err.message}`);
    }
    return `Hey! How can I help you today?`;
  }

  /**
   * Determines if a task is a simple information/lookup query
   * that doesn't need project context or a full plan.
   */
  _isInfoQuery(task) {
    const lower = task.toLowerCase().trim();
    const infoPatterns = [
      /^(what|who|where|when|why|how).{0,80}\?*$/i,
      /\b(weather|temperature|time|date|price|stock|news|score|definition|meaning|translate)\b/i,
      /^(search for|look up|find out|tell me about|search|google|what is|who is)\b/i,
      /^(explain|describe)\b/i,
      /\?\s*$/,
    ];
    // Dev / action tasks always go to full loop
    const devKeywords = [
      'build', 'create', 'code', 'fix', 'debug', 'install', 'deploy',
      'write', 'implement', 'refactor', 'generate', 'make a', 'develop',
      'clone', 'push', 'run', 'execute', 'setup', 'configure', 'launch',
      'email', 'report', 'document', 'brainstorm', 'ideas for',
      'work on', 'work with', 'look at', 'check out', 'dive into',
      'my project', 'my repo', 'my codebase', 'my app', 'my api',
      'add feature', 'add a feature', 'add functionality', 'integrate',
      'help me build', 'help me fix', 'help me with',
    ];
    if (devKeywords.some((kw) => lower.includes(kw))) return false;
    return infoPatterns.some((p) => p.test(task));
  }

  // ─────────────────────────────────────────────
  // Action dispatcher
  // ─────────────────────────────────────────────

  async _dispatchAction(action, params, workDir, task) {
    // ── Normalise "tool|operation" shorthand that some models emit ───────────
    // e.g. "github|list_repos" → action="github", params.operation="list_repos"
    // Only split on the FIRST pipe — ignore any extra segments (model hallucinations)
    if (action.includes('|')) {
      const pipeIdx = action.indexOf('|');
      const tool = action.slice(0, pipeIdx);
      const operation = action.slice(pipeIdx + 1).split('|')[0]; // take first op only
      return this._dispatchAction(tool, { ...params, operation }, workDir, task);
    }

    switch (action) {
      case 'terminal': {
        const cmd = (params.command || '').trim();
        if (!cmd) {
          return 'ERROR: No command specified. Provide a shell command in params.command';
        }
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
        // Hard guard: reject placeholder/example paths that codellama sometimes hallucinates
        const rawWritePath = (params.path || '').trim();
        const PLACEHOLDERS = [
          '/abs/', '/abs/path', '/path/to', '/your/', '/absolute/',
          '/example/', '/placeholder', 'file.txt', '/tmp/example',
        ];
        const rawContent = (params.content || '').trim();
        const isPlaceholderPath = PLACEHOLDERS.some(p =>
          rawWritePath.startsWith(p) || rawWritePath === p.replace(/\/$/, '')
        );
        const isPlaceholderContent = rawContent === 'complete file content here' ||
          rawContent === 'complete file content' || rawContent === 'content';
        if (!rawWritePath || isPlaceholderPath || isPlaceholderContent) {
          const errMsg = `REJECTED: "${rawWritePath}" is a placeholder path or content, not a real file. ` +
            `You MUST use the actual absolute path from PATH context and write real file content.`;
          logger.warn(`[Loop] Blocked placeholder filesystem_write: ${rawWritePath}`);
          this.brain.observe(`⛔ ${errMsg}`);
          return errMsg;
        }
        await this.status(`📝 Writing: \`${rawWritePath}\``);
        await this.fs.write(rawWritePath, rawContent);
        return `File written: ${rawWritePath}`;
      }

      case 'filesystem_mkdir': {
        const p = params.path || '';
        await this.status(`📁 Creating folder: \`${p}\``);
        return await this.fs.mkdir(p);
      }

      case 'filesystem_delete': {
        const p = params.path || '';
        await this.status(`🗑️ Deleting: \`${p}\``);
        return await this.fs.delete(p);
      }

      case 'browser': {
        await this.status(`🌐 Browser: ${params.operation} ${params.url || ''}`);
        return await this.browser.execute(params);
      }

      case 'calculate': {
        const expr = params.expression || '';
        await this.status(`🔢 Calculating: \`${expr}\``);
        return this.calculator.calculate(params);
      }

      case 'run_code': {
        const lang = params.language || 'python';
        await this.status(`⚙️ Running ${lang} code…`);
        return await this.codeRunner.run(params);
      }

      case 'reminder': {
        const reminderText = params.text || params.message || params.title || task;
        const reminderTime = params.time || params.at || params.when || '';
        await this.status(`⏰ Setting reminder: "${reminderText}"${reminderTime ? ` at ${reminderTime}` : ''}…`);
        return await this.reminder.create({ ...params, text: reminderText, time: reminderTime });
      }

      case 'notify': {
        const notifyMsg = params.message || params.text || params.title || task;
        await this.status(`🔔 Sending notification: "${notifyMsg}"…`);
        return await this.reminder.notify({ message: notifyMsg, title: params.title || 'ClawBot', subtitle: params.subtitle || '' });
      }

      case 'search': {
        await this.status(`🔍 Searching: "${params.query}"`);
        return await this.search.search(params.query);
      }

      case 'chat': {
        // brain chose to reply directly (e.g. after seeing search results)
        return params.reply || '';
      }

      case 'github': {
        await this.status(`🐙 GitHub: ${params.operation}`);
        return await this.github.execute(params, workDir);
      }

      case 'email_check': {
        await this.status(`📬 Checking emails (filter: ${params.filter || 'unread'})…`);
        return await this.email.checkEmail({
          filter:    params.filter    || 'unread',
          limit:     params.limit     || 15,
          sinceDays: params.since_days || 7,
        });
      }

      case 'report': {
        await this.status(`📄 Generating report: *${params.title || 'Report'}*…`);
        return await this.reporter.save({
          title:    params.title    || 'Report',
          content:  params.content  || '',
          filename: params.filename || undefined,
        });
      }

      case 'brainstorm': {
        // Brainstorm is handled the same as chat — return the reply text
        // and the main loop will send + finalize it
        return params.reply || '';
      }

      case 'email_send': {
        await this.status(`📤 Sending email to ${params.to || '?'}…`);
        return await this.email.sendEmail({
          to:      params.to || params.recipient || '',
          subject: params.subject || '',
          body:    params.body || params.message || '',
          cc:      params.cc || '',
          replyTo: params.reply_to || '',
        });
      }

      case 'email_search': {
        await this.status(`🔍 Searching emails…`);
        return await this.email.searchEmail({
          from:      params.from   || '',
          subject:   params.subject || '',
          query:     params.query  || '',
          limit:     params.limit  || 10,
          sinceDays: params.since_days || 14,
        });
      }

      case 'calendar': {
        const op = params.operation || params.action || 'today';
        await this.status(`📅 Calendar: ${op}…`);
        if (op === 'today' || op === 'get_today' || op === 'list') {
          return await this.calendar.getTodayEvents();
        } else if (op === 'week' || op === 'get_week') {
          return await this.calendar.getWeekEvents();
        } else if (op === 'create' || op === 'add' || op === 'new') {
          return await this.calendar.createEvent(params);
        } else if (op === 'find' || op === 'search') {
          return await this.calendar.findEvent(params);
        } else if (op === 'delete' || op === 'remove' || op === 'cancel') {
          return await this.calendar.deleteEvent(params);
        }
        return await this.calendar.getTodayEvents();
      }

      case 'briefing':
      case 'daily_briefing': {
        await this.status(`📋 Generating your daily briefing…`);
        return await this.briefing.generate(params);
      }

      // ── Clipboard ─────────────────────────────────────────
      case 'clipboard_read': {
        await this.status(`📋 Reading clipboard…`);
        return this.clipboard.read();
      }

      case 'clipboard_write': {
        const txt = params.text || params.content || '';
        await this.status(`📋 Writing to clipboard…`);
        return this.clipboard.write(txt);
      }

      // ── System Info ────────────────────────────────────────
      case 'sysinfo':
      case 'system_info': {
        const section = params.section || 'all';
        await this.status(`🖥️ Fetching system info…`);
        return this.sysinfo.get(section);
      }

      // ── Notes ──────────────────────────────────────────────
      case 'notes': {
        const op = params.operation || params.action || 'list';
        const title = params.title || params.query || '';
        const body  = params.body  || params.content || '';
        if (op === 'list') {
          await this.status(`📝 Listing notes…`);
          return this.notes.list(params.limit || 10);
        } else if (op === 'read') {
          await this.status(`📝 Reading note: "${title}"…`);
          return this.notes.read(title);
        } else if (op === 'create') {
          await this.status(`📝 Creating note: "${title}"…`);
          return this.notes.create(title, body);
        } else if (op === 'search') {
          await this.status(`📝 Searching notes for: "${title}"…`);
          return this.notes.search(title);
        } else if (op === 'append') {
          await this.status(`📝 Appending to note: "${title}"…`);
          return this.notes.append(title, body);
        }
        return this.notes.list();
      }

      // ── Screenshot ─────────────────────────────────────────
      case 'screenshot': {
        await this.status(`📸 Taking screenshot…`);
        return this.screenshot.capture({
          filename: params.filename || params.path || undefined,
          open:     params.open    || false,
          window:   params.window  || undefined,
        });
      }

      // ── Spotify ────────────────────────────────────────────
      case 'spotify': {
        const op = params.operation || params.action || 'now';
        await this.status(`🎵 Spotify: ${op}…`);
        if (op === 'now'  || op === 'playing')  return this.spotify.now();
        if (op === 'play')                       return this.spotify.play(params.query || '');
        if (op === 'pause' || op === 'stop')     return this.spotify.pause();
        if (op === 'next'  || op === 'skip')     return this.spotify.next();
        if (op === 'prev'  || op === 'previous') return this.spotify.previous();
        if (op === 'volume')                     return this.spotify.volume(params.level || 50);
        return this.spotify.now();
      }

      // ── PDF Reader ─────────────────────────────────────────
      case 'pdf_read': {
        const path = params.path || params.file || '';
        await this.status(`📄 Reading PDF: \`${path}\`…`);
        return this.pdf.read(path, params.max_chars || 8000);
      }

      // ── Translation ────────────────────────────────────────
      case 'translate': {
        const text   = params.text || params.content || '';
        const to     = params.to   || params.target  || 'en';
        const from   = params.from || params.source  || 'auto';
        await this.status(`🌍 Translating to ${to}…`);
        return await this.translator.translate(text, to, from);
      }

      // ── Contacts ───────────────────────────────────────────
      case 'contacts': {
        const op    = params.operation || 'search';
        const query = params.query || params.name || '';
        if (op === 'detail') {
          await this.status(`👤 Getting contact: "${query}"…`);
          return this.contacts.detail(query);
        }
        await this.status(`👤 Searching contacts: "${query}"…`);
        return this.contacts.search(query);
      }

      // ── Network Tools ──────────────────────────────────────
      case 'network': {
        const op   = params.operation || params.action || 'myip';
        const host = params.host || params.domain || '';
        if (op === 'myip' || op === 'ip') {
          await this.status(`🌐 Getting IP info…`);
          return await this.network.myip();
        }
        if (op === 'ping') {
          await this.status(`🏓 Pinging ${host}…`);
          return this.network.ping(host, params.count || 4);
        }
        if (op === 'dns') {
          await this.status(`🔍 DNS lookup: ${host}…`);
          return this.network.dns(host);
        }
        if (op === 'ports') {
          await this.status(`🔌 Scanning open ports…`);
          return this.network.ports(params.filter || '');
        }
        if (op === 'wifi') {
          await this.status(`📶 WiFi info…`);
          return this.network.wifi();
        }
        if (op === 'http' || op === 'request' || op === 'curl') {
          await this.status(`🌐 HTTP ${params.method || 'GET'} ${host || params.url}…`);
          return await this.network.httpRequest(
            params.url || host,
            params.method || 'GET',
            params.body || null,
            params.headers || {},
          );
        }
        return await this.network.myip();
      }

      // ── Compress / Extract ─────────────────────────────────
      case 'compress': {
        const op     = params.operation || 'zip';
        const source = params.source || params.path || '';
        const output = params.output || params.dest  || '';
        await this.status(`🗜️ Compress: ${op} "${source}"…`);
        if (op === 'zip')    return this.compress.zip(source, output);
        if (op === 'unzip')  return this.compress.unzip(source, output);
        if (op === 'tar')    return this.compress.tar(source, output);
        if (op === 'untar')  return this.compress.untar(source, output);
        if (op === 'list')   return this.compress.list(source);
        return `Unknown compress operation: ${op}`;
      }

      // ── Weather ────────────────────────────────────────────
      case 'weather': {
        const loc = params.location || params.city || params.place || 'auto';
        await this.status(`🌤️ Getting weather for ${loc === 'auto' ? 'your location' : loc}…`);
        return await this.weather.getWeather({ location: loc, units: params.units || 'metric' });
      }

      // ── Pomodoro / Focus Timer ─────────────────────────────
      case 'pomodoro':
      case 'pomo':
      case 'focus': {
        const op = params.operation || params.action || 'status';
        await this.status(`🍅 Pomodoro: ${op}…`);
        if (op === 'start' || op === 'begin') return await this.pomodoro.start(params);
        if (op === 'pause')                   return await this.pomodoro.pause(params);
        if (op === 'resume' || op === 'continue') return await this.pomodoro.resume(params);
        if (op === 'stop'  || op === 'end')   return await this.pomodoro.stop(params);
        if (op === 'stats' || op === 'history') return await this.pomodoro.stats(params);
        return await this.pomodoro.status(params);
      }

      // ── Habit Tracker ──────────────────────────────────────
      case 'habit':
      case 'habits': {
        const op = params.operation || params.action || 'list';
        await this.status(`✅ Habits: ${op}…`);
        if (op === 'add'  || op === 'create' || op === 'new') return await this.habits.add(params);
        if (op === 'done' || op === 'check'  || op === 'complete') return await this.habits.done(params);
        if (op === 'stats' || op === 'progress' || op === 'history') return await this.habits.stats(params);
        if (op === 'remove' || op === 'delete') return await this.habits.remove(params);
        return await this.habits.list(params);
      }

      // ── Crypto & Stock Prices ──────────────────────────────
      case 'crypto':
      case 'price':
      case 'stock': {
        const op = params.operation || params.action || 'price';
        if (op === 'top')   {
          await this.status(`💰 Fetching top crypto…`);
          return await this.crypto.top(params);
        }
        if (op === 'chart') {
          await this.status(`📈 Generating chart for ${params.coin || 'btc'}…`);
          return await this.crypto.chart(params);
        }
        const sym = params.coin || params.symbol || params.ticker || params.query || 'btc';
        await this.status(`💰 Fetching price for ${sym.toUpperCase()}…`);
        return await this.crypto.price({ ...params, coin: sym });
      }

      // ── World Clock & Timezone ─────────────────────────────
      case 'worldclock':
      case 'timezone':
      case 'time_convert': {
        const op = params.operation || params.action || 'now';
        await this.status(`🕐 World clock: ${op}…`);
        if (op === 'convert' || op === 'convert_time') return await this.worldclock.convert(params);
        if (op === 'meeting' || op === 'planner')      return await this.worldclock.meetingPlanner(params);
        return await this.worldclock.now(params);
      }

      // ── Voice & TTS ────────────────────────────────────────
      case 'speak':
      case 'tts':
      case 'voice': {
        const op = params.operation || params.action || 'speak';
        if (op === 'speak' || op === 'say') {
          await this.status(`🔊 Speaking text…`);
          return await this.voiceNote.speak(params);
        }
        if (op === 'list_voices' || op === 'voices') return await this.voiceNote.listVoices(params);
        if (op === 'record')  return await this.voiceNote.record(params);
        if (op === 'play')    return await this.voiceNote.play(params);
        if (op === 'list')    return await this.voiceNote.list(params);
        return await this.voiceNote.speak(params);
      }

      // ── QR Code Generator ─────────────────────────────────
      case 'qrcode':
      case 'qr': {
        const op = params.operation || params.action || 'generate';
        await this.status(`📱 Generating QR code…`);
        if (op === 'contact' || op === 'vcard') return await this.qrcode.contact(params);
        if (op === 'wifi')                       return await this.qrcode.wifi(params);
        const content = params.text || params.url || params.content || params.data || '';
        return await this.qrcode.generate({ ...params, text: content });
      }

      // ── Image Analysis ─────────────────────────────────────
      case 'image':
      case 'image_analyze':
      case 'ocr': {
        const op = params.operation || params.action || 'analyze';
        if (op === 'ocr'     || op === 'text')    {
          await this.status(`🔍 Extracting text from image…`);
          return await this.imageLook.ocr(params);
        }
        if (op === 'convert')  {
          await this.status(`🖼️ Converting image…`);
          return await this.imageLook.convert(params);
        }
        if (op === 'resize')   {
          await this.status(`🖼️ Resizing image…`);
          return await this.imageLook.resize(params);
        }
        await this.status(`🔍 Analyzing image…`);
        return await this.imageLook.analyze(params);
      }

      // ── File Watcher & Disk Utilities ──────────────────────
      case 'disk':
      case 'files':
      case 'filewatcher': {
        const op = params.operation || params.action || 'overview';
        if (op === 'usage'      || op === 'disk_usage')   {
          await this.status(`💾 Analyzing disk usage…`);
          return await this.fileWatcher.diskUsage(params);
        }
        if (op === 'large'      || op === 'find_large')   {
          await this.status(`🔍 Finding large files…`);
          return await this.fileWatcher.findLarge(params);
        }
        if (op === 'duplicates' || op === 'dupe')          {
          await this.status(`🔁 Finding duplicate files…`);
          return await this.fileWatcher.findDuplicates(params);
        }
        if (op === 'watch'      || op === 'changes')       {
          await this.status(`👁️ Watching for changes…`);
          return await this.fileWatcher.watch(params);
        }
        await this.status(`📁 Getting directory overview…`);
        return await this.fileWatcher.overview(params);
      }

      // ── macOS Automation ───────────────────────────────────
      case 'automation':
      case 'system': {
        const op = params.operation || params.action || 'list_apps';
        await this.status(`⚙️ Automation: ${op}…`);
        if (op === 'open_app'    || op === 'launch')    return await this.automation.openApp(params);
        if (op === 'open_url')                          return await this.automation.openUrl(params);
        if (op === 'volume')                            return await this.automation.setVolume(params);
        if (op === 'mute'        || op === 'unmute')    return await this.automation.mute({ muted: op === 'mute' });
        if (op === 'brightness')                        return await this.automation.setBrightness(params);
        if (op === 'dark_mode'   || op === 'darkmode')  return await this.automation.darkMode(params);
        if (op === 'lock'        || op === 'lock_screen') return await this.automation.lockScreen(params);
        if (op === 'empty_trash' || op === 'trash')     return await this.automation.emptyTrash(params);
        if (op === 'quit_app'    || op === 'quit')      return await this.automation.quitApp(params);
        if (op === 'dnd'         || op === 'do_not_disturb') return await this.automation.doNotDisturb(params);
        if (op === 'type'        || op === 'type_text') return await this.automation.typeText(params);
        return await this.automation.listApps(params);
      }

      // ── Developer Tools ────────────────────────────────────
      case 'devtools':
      case 'dev': {
        const op = params.operation || params.action || 'uuid';
        if (op === 'uuid')                              return this.devtools.uuid(params);
        if (op === 'base64'  || op === 'b64')           return this.devtools.base64(params);
        if (op === 'hash')                              return this.devtools.hash(params);
        if (op === 'jwt'     || op === 'decode_jwt')    return this.devtools.decodeJwt(params);
        if (op === 'json'    || op === 'format_json')   return this.devtools.formatJson(params);
        if (op === 'password' || op === 'pwd')          return this.devtools.generatePassword(params);
        if (op === 'regex'   || op === 'test_regex')    return this.devtools.testRegex(params);
        if (op === 'cron'    || op === 'explain_cron')  return this.devtools.explainCron(params);
        if (op === 'http_status' || op === 'status_code') return this.devtools.httpStatus(params);
        if (op === 'url_encode'  || op === 'urlencode') return this.devtools.urlEncode(params);
        if (op === 'lorem'   || op === 'lorem_ipsum')   return this.devtools.lorem(params);
        if (op === 'case'    || op === 'convert_case')  return this.devtools.convertCase(params);
        return this.devtools.uuid(params);
      }

      case 'done':
      case 'error':
        return params.summary || params.message || '';

      default:
        return `Unknown action: ${action}`;
    }
  }

  async status(msg) {
    // Guard: never send raw JSON blobs to the user
    const stripped = msg.replace(/\*|`/g, '');
    if (stripped.trimStart().startsWith('{"') || stripped.trimStart().startsWith('\`\`\`json')) {
      logger.debug(`[Status] Suppressed raw JSON status message`);
      return;
    }
    logger.info(`[Status] ${stripped}`);
    try {
      await this.onStatusUpdate(msg);
    } catch (_) { /* non-fatal */ }
  }
}
