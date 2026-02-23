/**
 * tools/github.js
 * Git and GitHub operations using simple-git.
 * GitHub API calls use the optional token from .env.
 */

import simpleGit from 'simple-git';
import path from 'path';
import fetch from 'node-fetch';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

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
      default:
        throw new Error(`Unknown GitHub operation: ${operation}`);
    }
  }

  async clone(repoUrl, destDir, branch) {
    const repoName = repoUrl.split('/').pop().replace('.git', '');
    const cloneDir = path.join(destDir, repoName);
    logger.info(`[GitHub] Cloning ${repoUrl} → ${cloneDir}`);

    const options = branch ? ['--branch', branch] : [];
    await simpleGit().clone(repoUrl, cloneDir, options);
    return `Cloned ${repoUrl} to ${cloneDir}`;
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
      body: JSON.stringify({ title, body, head, base }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(`GitHub API error: ${err.message}`);
    }

    const data = await resp.json();
    return `PR created: ${data.html_url}`;
  }
}
