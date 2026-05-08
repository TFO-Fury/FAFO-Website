import { Octokit } from 'octokit';
import { getDb } from './firebase-admin.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

export async function syncKeyToGithub(userId: string): Promise<{ success: boolean; path?: string; sha?: string; error?: string }> {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.log('[GitHubSync] Missing GitHub credentials, skipping sync');
    return { success: false, error: 'Missing GitHub credentials' };
  }

  try {
    const firestore = await getDb();

    const userDoc = await firestore.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return { success: false, error: 'User not found' };
    }

    const userData = userDoc.data();
    if (!userData || userData.accountStatus !== 'active') {
      console.log(`[GitHubSync] User ${userId} not active (status: ${userData?.accountStatus}), skipping`);
      return { success: false, error: 'User not active' };
    }

    const keysSnap = await firestore.collection('cd_keys')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (keysSnap.empty) {
      console.log(`[GitHubSync] No active key found for user ${userId}, skipping`);
      return { success: false, error: 'No active key found' };
    }

    const keyDoc = keysSnap.docs[0];
    const key = keyDoc.id;

    const expiresAt = userData.expiresAt?.toDate?.() || userData.expiresAt;
    if (!expiresAt || new Date(expiresAt) < new Date()) {
      console.log(`[GitHubSync] User ${userId} entitlement expired, skipping`);
      return { success: false, error: 'Entitlement expired' };
    }

    const plan = userData.plan || 'none';
    const filePath = `licenses/${key}.json`;
    const content = JSON.stringify({
      key,
      plan,
      expires: new Date(expiresAt).toISOString(),
      updatedAt: new Date().toISOString()
    }, null, 2);

    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const contentEncoded = Buffer.from(content).toString('base64');

    let sha: string | undefined;
    try {
      const { data: fileData } = await octokit.rest.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: filePath
      });
      if (!Array.isArray(fileData)) {
        sha = fileData.sha;
      }
    } catch (e: any) {
      if (e.status !== 404) {
        console.error(`[GitHubSync] Error checking existing file ${filePath}:`, e);
      }
    }

    const result = await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: filePath,
      message: `Sync license ${key} for user ${userId} (${plan})`,
      content: contentEncoded,
      sha
    });

    console.log(`[GitHubSync] Success - ${sha ? 'Updated' : 'Created'} ${filePath} (commit: ${result.data.commit.sha})`);
    return { success: true, path: filePath, sha: result.data.commit.sha };
  } catch (err: any) {
    console.error(`[GitHubSync] Failed for user ${userId}:`, err);
    return { success: false, error: err.message || 'GitHub API error' };
  }
}

export async function removeKeyFromGithub(key: string): Promise<{ success: boolean; path: string; error?: string }> {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.log('[GitHubSync] Missing GitHub credentials, skipping removal');
    return { success: false, path: `licenses/${key}.json`, error: 'Missing GitHub credentials' };
  }

  const filePath = `licenses/${key}.json`;
  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  try {
    const { data: fileData } = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: filePath
    });

    if (Array.isArray(fileData)) {
      return { success: false, path: filePath, error: 'Path is a directory' };
    }

    await octokit.rest.repos.deleteFile({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: filePath,
      message: `Remove deactivated license ${key}`,
      sha: fileData.sha
    });

    console.log(`[GitHubSync] Removed ${filePath}`);
    return { success: true, path: filePath };
  } catch (e: any) {
    if (e.status === 404) {
      console.log(`[GitHubSync] File ${filePath} already removed or never existed`);
      return { success: true, path: filePath };
    }
    console.error(`[GitHubSync] Failed to remove ${filePath}:`, e);
    return { success: false, path: filePath, error: e.message || 'GitHub API error' };
  }
}
