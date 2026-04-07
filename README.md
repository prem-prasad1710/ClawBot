# ClawBot v2.0 — Autonomous AI Developer Agent

ClawBot is a **fully autonomous, self-hosted AI developer agent** that runs locally on your MacBook and is controlled via **Telegram**. It uses **Ollama** for local AI inference — no paid APIs, no cloud, no subscriptions.

Inspired by Devin, ClawBot can plan, execute, debug, and complete real multi-step programming tasks entirely on its own.

---

## Features

| Capability | Description |
|---|---|
| 🧠 Autonomous task loop | Plan → Execute → Observe → Retry → Done |
| 📁 Project context awareness | Reads folder structure, source files, configs |
| 🖥️ Terminal execution | Runs shell commands with error recovery |
| 📝 File system operations | Read, write, and navigate any file/folder |
| 🌐 Browser automation | Playwright-powered open, click, fill, scrape |
| 🔍 Web research | DuckDuckGo scraping, no API key needed |
| 🐙 GitHub integration | Clone, commit, push, create PRs |
| 🧩 Multi-step planning | Structured plan generated before execution |
| 🔁 Error recovery | Catches failures and self-corrects |
| 🗃️ Long-term memory | Tasks, history, and projects persisted locally |
| 🛡️ Repo Guardian mode | Detects failing checks, dependency risk, flaky files + fix plan |
| 🚢 Goal→Shipping mode | Converts business goals into milestones, backlog, PR sequence |
| 🧪 Autonomous QA mode | Bug reproduction plans, root-cause hints, QA checks |
| 🔒 Command safety | Blocks dangerous shell commands |
| 📊 Logging | Timestamped log files per day |

---

## Requirements

- macOS (Apple Silicon or Intel)
- Node.js ≥ 20
- [Ollama](https://ollama.ai) installed and running
- A Telegram bot token (free from [@BotFather](https://t.me/BotFather))

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/yourname/clawbot.git
cd clawbot
npm install
```

### 2. Install Playwright browsers

```bash
npm run install-browsers
```

### 3. Pull an Ollama model

```bash
ollama pull deepseek-coder
# or
ollama pull qwen2.5-coder
# or
ollama pull codellama
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=your_token_here
ALLOWED_USER_IDS=your_telegram_user_id
OLLAMA_MODEL=deepseek-coder
WORKSPACE_DIR=/Users/yourname/clawbot-workspace
```

> **Get your Telegram user ID:** Message [@userinfobot](https://t.me/userinfobot) on Telegram.

### 5. Start Ollama

```bash
ollama serve
```

### 6. Start ClawBot

```bash
npm start
```

---

## Telegram Commands

| Command | Description |
|---|---|
| `/task <description>` | Run an autonomous development task |
| `/stop` | Stop the currently running task |
| `/status` | Show agent status and task statistics |
| `/history` | Show recent task history |
| `/model <name>` | Switch to a different Ollama model |
| `/models` | List all locally available Ollama models |
| `/workspace` | Show the workspace directory path |
| `/clear` | Clear conversation context |
| `/guardian [scan|status|watch|stop <id>|plan] [path]` | Repo Guardian health watchdog |
| `/ship <business goal>` | Goal→Shipping plan generator |
| `/qa <bug report>` | Autonomous QA bug lab |
| `/help` | Show all commands |

You can also just **type your task directly** without a command prefix.

---

## Example Tasks

```
/task build a REST API in Express with CRUD endpoints for a todo app

/task research the best React chart library and install it in my project

/task open localhost:3000 and test the login form, take a screenshot

/task create a Next.js app with Tailwind CSS and a dashboard layout

/task fix the TypeScript errors in my project

/task build a SaaS dashboard with authentication and a dark mode

/guardian scan /Users/you/project

/ship launch landing page + auth + analytics

/qa checkout fails with 500 when promo code is empty
```

---

## Project Structure

```
clawbot/
├── index.js               # Entry point
├── agent/
│   ├── brain.js           # Ollama reasoning engine
│   ├── planner.js         # Multi-step plan generator
│   ├── loop.js            # Autonomous execution loop
│   └── memory.js          # Long-term memory (JSON)
├── tools/
│   ├── terminal.js        # Safe shell execution
│   ├── filesystem.js      # File read/write + project context
│   ├── browser.js         # Playwright browser automation
│   ├── search.js          # DuckDuckGo web search
│   ├── github.js          # Git + GitHub API
│   ├── repoguardian.js    # Repo health watchdog + risk scanner
│   ├── goalshipping.js    # Goal → milestones/backlog/PR/release planning
│   └── autonomousqa.js    # Bug reproduction + QA check workflows
├── telegram/
│   └── bot.js             # Telegram bot interface
├── utils/
│   └── logger.js          # Structured logging
├── config/
│   └── config.js          # Central configuration
├── memory/
│   ├── tasks.json         # Task history
│   ├── history.json       # Summarized history
│   └── projects.json      # Project metadata
├── logs/                  # Daily log files
├── .env.example
└── package.json
```

---

## Agent Execution Flow

```
Telegram Message
       │
       ▼
  Authorization Check
       │
       ▼
  Project Context Scan
       │
       ▼
  Plan Generation (Planner)
       │
       ▼
  ┌──────────────────────┐
  │   Autonomous Loop    │
  │                      │
  │  Brain.think()       │
  │     │                │
  │     ▼                │
  │  Dispatch Action     │
  │  (terminal/fs/       │
  │   browser/search/    │
  │   github)            │
  │     │                │
  │     ▼                │
  │  Observation         │
  │     │                │
  │     ▼                │
  │  Error Recovery?     │
  │     │                │
  │     ▼                │
  │  Done / Next step    │
  └──────────────────────┘
       │
       ▼
  Save to Memory
       │
       ▼
  Telegram Result
```

---

## Recommended Models

| Model | Size | Best For |
|---|---|---|
| `deepseek-coder` | 6.7B | Coding tasks, fast |
| `qwen2.5-coder` | 7B | Excellent code quality |
| `codellama` | 7B | Code generation |
| `deepseek-coder:33b` | 33B | High-quality, needs 20GB+ RAM |
| `llama3` | 8B | General purpose tasks |

---

## Safety

ClawBot blocks the following dangerous command patterns:
- `rm -rf /` and variants
- `mkfs`, `format disk`
- `shutdown`, `reboot`, `halt`
- Writing to raw disk devices
- Mass `chmod`/`chown` on root

To add custom blocks, edit `dangerousCommandPatterns` in `config/config.js`.

---

## License

MIT – free and open source.
