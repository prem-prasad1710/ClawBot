import dotenv from 'dotenv';
dotenv.config();

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUsers: (process.env.ALLOWED_USER_IDS || '')
      .split(',')
      .map((id) => parseInt(id.trim()))
      .filter(Boolean),
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'deepseek-coder',
    timeout: parseInt(process.env.OLLAMA_TIMEOUT || '120000'),
    options: {
      temperature: parseFloat(process.env.OLLAMA_TEMPERATURE || '0.3'),
      num_ctx: parseInt(process.env.OLLAMA_CTX || '8192'),
    },
  },
  agent: {
    workspaceDir: process.env.WORKSPACE_DIR || `${process.env.HOME}/clawbot-workspace`,
    maxSteps: parseInt(process.env.MAX_STEPS || '30'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    stepTimeoutMs: parseInt(process.env.STEP_TIMEOUT_MS || '60000'),
  },
  search: {
    // Uses DuckDuckGo HTML scraping – no API key required
    engine: 'duckduckgo',
    maxResults: parseInt(process.env.SEARCH_MAX_RESULTS || '5'),
  },
  github: {
    token: process.env.GITHUB_TOKEN || '',
    defaultBranch: process.env.GITHUB_DEFAULT_BRANCH || 'main',
  },
  logging: {
    dir: process.env.LOG_DIR || './logs',
    level: process.env.LOG_LEVEL || 'info',
  },
  dangerousCommandPatterns: [
    /rm\s+-rf\s+\/(?!\w)/,
    /mkfs/,
    /format\s+[a-z]:/i,
    /shutdown/,
    /reboot/,
    /halt/,
    /dd\s+if=.*of=\/dev\/(sd|hd|nvme)/,
    /:w!?\s*!.*rm/,
    />\s*\/dev\/(sd|hd|nvme)/,
    /chmod\s+-R\s+777\s+\//,
    /chown\s+-R.*\//,
  ],
};
