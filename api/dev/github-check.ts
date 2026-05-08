import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Octokit } from 'octokit';
import { requireAdmin } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  const GITHUB_REPO = process.env.GITHUB_REPO;

  const diagnostics: any = {
    accessible: false,
    owner: GITHUB_OWNER || null,
    repo: GITHUB_REPO || null,
    tokenSet: !!GITHUB_TOKEN,
    user: null,
    repoMeta: null,
    error: null
  };

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    diagnostics.error = 'Missing GitHub credentials';
    return res.status(500).json(diagnostics);
  }

  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  // Authenticated identity
  try {
    const { data: userData } = await octokit.rest.users.getAuthenticated();
    diagnostics.user = {
      login: userData.login,
      id: userData.id,
      type: userData.type
    };
    console.log(`[GitHubCheck] Authenticated as: ${userData.login} (${userData.type})`);
  } catch (e: any) {
    diagnostics.error = `Token authentication failed: ${e.message}`;
    console.error(`[GitHubCheck] Auth failed:`, e);
    return res.status(500).json(diagnostics);
  }

  // Repository accessibility
  try {
    const { data: repoData } = await octokit.rest.repos.get({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO
    });
    diagnostics.repoMeta = {
      exists: true,
      name: repoData.name,
      full_name: repoData.full_name,
      visibility: repoData.visibility,
      private: repoData.private,
      default_branch: repoData.default_branch,
      permissions: repoData.permissions
    };
    diagnostics.accessible = true;
    console.log(`[GitHubCheck] Repo accessible: ${repoData.full_name}, visibility=${repoData.visibility}, permissions=${JSON.stringify(repoData.permissions)}`);
  } catch (e: any) {
    if (e.status === 404) {
      diagnostics.repoMeta = { exists: false, error: 'Repository not found or not accessible' };
      diagnostics.error = `Repository ${GITHUB_OWNER}/${GITHUB_REPO} returned 404. Check owner name, repo name, and token scopes.`;
    } else {
      diagnostics.repoMeta = { exists: false, error: e.message };
      diagnostics.error = `Repository check failed: ${e.message}`;
    }
    console.error(`[GitHubCheck] Repo access failed (${e.status}):`, e.message);
    return res.status(200).json(diagnostics);
  }

  return res.status(200).json(diagnostics);
}
