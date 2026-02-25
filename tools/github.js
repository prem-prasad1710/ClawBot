/**
 * tools/github.js
 * Git and GitHub operations using simple-git.
 * GitHub API calls use the optional token from .env.
 */

import simpleGit from 'simple-git';
import path from 'path';
import fetch from 'node-fetch';
import https from 'https';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

// Bypass Zscaler / corporate TLS interception for GitHub API calls
const tlsAgent = new https.Agent({ rejectUnauthorized: false });

export class GitHub {
  /**
   * Dispatch a GitHub operation.
   * @param {object} params
   * @param {string} workDir
   */
  async execute(params, workDir = '.') {
    const { operation } = params;

    switch (operation) {
      case 'clone':
        return this.clone(params.repo, workDir, params.branch);
      case 'init':
        return this.init(workDir);
      case 'commit':
        return this.commit(workDir, params.message || 'chore: auto-commit by ClawBot');
      case 'push':
        return this.push(workDir, params.branch);
      case 'status':
        return this.status(workDir);
      case 'create_repo':
        return this.createRepo(params.name, params.private ?? true, params.description);
      case 'pr':
        return this.createPR(params);
      case 'list_repos': {
        // Accept username directly, or derive it from "owner/repo" in params.repo
        const username = params.username || (params.repo && params.repo.split('/')[0]) || undefined;
        return this.listRepos(username);
      }
      case 'list_repo_contents':
        return this.listRepoContents(params.repo, params.path || '');
      default:
        throw new Error(`Unknown GitHub operation: ${operation}. Valid ops: clone, commit, push, status, create_repo, pr, list_repos, list_repo_contents`);
    }
  }

  async clone(repoUrl, destDir, branch) {
    // Accept "owner/repo" shorthand and expand to full HTTPS URL
    if (repoUrl && !repoUrl.startsWith('http') && !repoUrl.startsWith('git@')) {
      repoUrl = `https://github.com/${repoUrl}.git`;
    }
    const repoName = repoUrl.split('/').pop().replace('.git', '');
    const cloneDir = path.join(destDir, repoName);
    logger.info(`[GitHub] Cloning ${repoUrl} → ${cloneDir}`);

    // Inject token into HTTPS URL so private repos clone without SSH keys
    let cloneUrl = repoUrl;
    if (config.github.token && cloneUrl.startsWith('https://')) {
      cloneUrl = cloneUrl.replace('https://', `https://${config.github.token}@`);
    }

    const options = branch ? ['--branch', branch] : [];
    await simpleGit().clone(cloneUrl, cloneDir, options);
    return `Cloned ${repoUrl} to ${cloneDir} — now use filesystem_read on "${cloneDir}" to explore it`;
  }

  async init(dir) {
    logger.info(`[GitHub] Init repo in: ${dir}`);
    const git = simpleGit(dir);
    await git.init();
    return `Initialized git repo in ${dir}`;
  }

  async commit(dir, message) {
    logger.info(`[GitHub] Committing in: ${dir}`);
    const git = simpleGit(dir);
    await git.add('.');
    const result = await git.commit(message);
    return `Committed: ${result.commit || 'ok'} – "${message}"`;
  }

  async push(dir, branch = config.github.defaultBranch) {
    logger.info(`[GitHub] Pushing in: ${dir}`);
    const git = simpleGit(dir);
    await git.push('origin', branch);
    return `Pushed to origin/${branch}`;
  }

  async status(dir) {
    const git = simpleGit(dir);
    const status = await git.status();
    const lines = [
      `Branch: ${status.current}`,
      `Modified: ${status.modified.join(', ') || 'none'}`,
      `Untracked: ${status.not_added.join(', ') || 'none'}`,
      `Staged: ${status.staged.join(', ') || 'none'}`,
    ];
    return lines.join('\n');
  }

  async createRepo(name, isPrivate = true, description = '') {
    if (!config.github.token) {
      throw new Error('GITHUB_TOKEN not set. Cannot create remote repo.');
    }

    const resp = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `token ${config.github.token}`,
        'Content-Type': 'application/json',
      },
      agent: tlsAgent,
      body: JSON.stringify({ name, private: isPrivate, description }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(`GitHub API error: ${err.message}`);
    }

    const data = await resp.json();
    return `Repository created: ${data.html_url}`;
  }

  async createPR({ repo, title, body, head, base = 'main' }) {
    if (!config.github.token) {
      throw new Error('GITHUB_TOKEN not set. Cannot create PR.');
    }

    const resp = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `token ${config.github.token}`,
        'Content-Type': 'application/json',
      },
      agent: tlsAgent,
      body: JSON.stringify({ title, body, head, base }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(`GitHub API error: ${err.message}`);
    }

    const data = await resp.json();
    return `PR created: ${data.html_url}`;
  }

  /**
   * List all public repos for a GitHub user.
   * If GITHUB_TOKEN is set, also returns private repos for the authenticated user.
   * @param {string} [username] - GitHub username. Omit to list authenticated user's repos.
   */
  async listRepos(username) {
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (config.github.token) headers['Authorization'] = `token ${config.github.token}`;

    // When a token is available use the authenticated endpoint so private repos
    // are included (the public /users/:username/repos endpoint only returns public ones).
    const endpoint = config.github.token
      ? `https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator`
      : username
        ? `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`
        : `https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator`;

    logger.info(`[GitHub] Listing repos: ${endpoint}`);
    const resp = await fetch(endpoint, { headers, agent: tlsAgent });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`GitHub API error ${resp.status}: ${err.message || resp.statusText}`);
    }

    const repos = await resp.json();
    if (!repos.length) return 'No repositories found.';

    const lines = repos.map((r, i) =>
      `${i + 1}. ${r.full_name}${ r.private ? ' 🔒' : '' } – ${r.description || 'no description'} [⭐${r.stargazers_count}]`
    );
    return `Found ${repos.length} repositories:\n\n${lines.join('\n')}`;
  }

  /**
   * List contents of a path inside a repository.
   * @param {string} repo  - "owner/repo"
   * @param {string} filePath - path inside the repo (default: root)
   */
  async listRepoContents(repo, filePath = '') {
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (config.github.token) headers['Authorization'] = `token ${config.github.token}`;

    const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    logger.info(`[GitHub] Listing contents: ${url}`);
    const resp = await fetch(url, { headers, agent: tlsAgent });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`GitHub API error ${resp.status}: ${err.message || resp.statusText}`);
    }

    const items = await resp.json();
    const list = Array.isArray(items) ? items : [items];
    const lines = list.map((f) => `${f.type === 'dir' ? '📁' : '📄'} ${f.name}`);
    return `Contents of ${repo}/${filePath}:\n${lines.join('\n')}`;
  }
}
