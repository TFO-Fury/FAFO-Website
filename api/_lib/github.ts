import { Octokit } from 'octokit';
import { getDb } from './firebase-admin.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

(function validateGithubConfig() {
  console.log('[GitHubSync] Startup validation:');
  console.log(`  GITHUB_OWNER: ${GITHUB_OWNER ? `"${GITHUB_OWNER}"` : 'MISSING'}`);
  console.log(`  GITHUB_REPO: ${GITHUB_REPO ? `"${GITHUB_REPO}"` : 'MISSING'}`);
  console.log(`  GITHUB_TOKEN: ${GITHUB_TOKEN ? `set (length=${GITHUB_TOKEN.length})` : 'MISSING'}`);
})();


export async function syncKeyToGithub(
  userId: string,
  knownKey?: string
): Promise<{
  success: boolean;
  path?: string;
  sha?: string;
  error?: string;
  githubStatus?: number;
  githubResponse?: any;
  selectedKey?: string;
}> {
  console.log(`[GitHubSync] === START syncKeyToGithub ===`);
  console.log(`[GitHubSync] userId=${userId}, knownKey=${knownKey || '(none)'}`);

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.log('[GitHubSync] Missing GitHub credentials, skipping sync');
    return { success: false, error: 'Missing GitHub credentials' };
  }

  try {
    const firestore = await getDb();

    // --- USER FETCH ---
    console.log(`[GitHubSync] Fetching user doc: users/${userId}`);
    const userDoc = await firestore.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      console.warn(`[GitHubSync] User ${userId} not found in Firestore`);
      return { success: false, error: 'User not found' };
    }

    const userData = userDoc.data();
    console.log(`[GitHubSync] User loaded:`, {
      exists: true,
      plan: userData?.plan,
      selectedClass: userData?.selectedClass || '(none)',
      accountStatus: userData?.accountStatus,
      expiresAt: userData?.expiresAt?.toDate?.()?.toISOString?.() || userData?.expiresAt || '(none)'
    });

    if (!userData || userData.accountStatus !== 'active') {
      console.log(`[GitHubSync] User not active (status: ${userData?.accountStatus}), skipping`);
      return { success: false, error: 'User not active' };
    }

    // --- KEY RESOLUTION ---
    let key: string | undefined = knownKey;
    let selectedKeyDocData: any = null;

    if (!key) {
      console.log(`[GitHubSync] No knownKey provided. Querying collection=cd_keys, filters: userId==${userId}, status==active`);

      let keysSnap;
      try {
        keysSnap = await firestore.collection('cd_keys')
          .where('userId', '==', userId)
          .where('status', '==', 'active')
          .orderBy('updatedAt', 'desc')
          .limit(1)
          .get();
      } catch (queryErr: any) {
        console.error(`[GitHubSync] Ordered query failed. Collection: cd_keys, filters: userId==${userId}, status==active, orderBy: updatedAt desc. Error:`, queryErr);
        console.log(`[GitHubSync] Retrying without orderBy...`);
        keysSnap = await firestore.collection('cd_keys')
          .where('userId', '==', userId)
          .where('status', '==', 'active')
          .limit(1)
          .get();
      }

      console.log(`[GitHubSync] Active query returned ${keysSnap.size} document(s)`);
      keysSnap.forEach((doc, i) => {
        const d = doc.data();
        console.log(`[GitHubSync]   Result[${i}]: id=${doc.id}, status=${d?.status}, userId=${d?.userId}, updatedAt=${d?.updatedAt?.toDate?.() || d?.updatedAt || 'unknown'}`);
      });

      if (keysSnap.empty) {
        console.log(`[GitHubSync] No active key found. Waiting 1.5s for eventual consistency...`);
        await new Promise(r => setTimeout(r, 1500));
        keysSnap = await firestore.collection('cd_keys')
          .where('userId', '==', userId)
          .where('status', '==', 'active')
          .limit(1)
          .get();
        console.log(`[GitHubSync] Retry returned ${keysSnap.size} document(s)`);
      }

      if (keysSnap.empty) {
        // FALLBACK: dump ALL keys for user
        console.warn(`[GitHubSync] Still no active key. Dumping ALL keys for user ${userId}:`);
        const allKeysSnap = await firestore.collection('cd_keys')
          .where('userId', '==', userId)
          .get();
        console.warn(`[GitHubSync] Found ${allKeysSnap.size} total key(s):`);
        allKeysSnap.forEach(doc => {
          const d = doc.data();
          console.warn(`[GitHubSync]   id=${doc.id}, status=${d?.status || '(no status)'}, userId=${d?.userId || '(no userId)'}, updatedAt=${d?.updatedAt?.toDate?.() || d?.updatedAt || 'unknown'}`);
        });
        return { success: false, error: `No active key found for user ${userId}` };
      }

      const keyDoc = keysSnap.docs[0];
      key = keyDoc.id;
      selectedKeyDocData = keyDoc.data();
      console.log(`[GitHubSync] Selected key from query: ${key}`);
    } else {
      console.log(`[GitHubSync] Using knownKey directly: ${knownKey}`);
      // Verify knownKey document exists and is readable
      const keyDoc = await firestore.collection('cd_keys').doc(knownKey).get();
      if (!keyDoc.exists) {
        console.warn(`[GitHubSync] Known key ${knownKey} not readable in Firestore. Waiting 1s...`);
        await new Promise(r => setTimeout(r, 1000));
        const retryDoc = await firestore.collection('cd_keys').doc(knownKey).get();
        if (!retryDoc.exists) {
          return { success: false, error: `Known key ${knownKey} not found in Firestore after retry` };
        }
        selectedKeyDocData = retryDoc.data();
        console.log(`[GitHubSync] Key ${knownKey} readable after retry. status=${selectedKeyDocData?.status}`);
      } else {
        selectedKeyDocData = keyDoc.data();
        console.log(`[GitHubSync] Key ${knownKey} verified. status=${selectedKeyDocData?.status}`);
      }
      key = knownKey;
    }

    // --- EXPIRATION CHECK ---
    const expiresAt = userData.expiresAt?.toDate?.() || userData.expiresAt;
    console.log(`[GitHubSync] expiresAt resolved to: ${expiresAt || '(none)'}`);

    if (!expiresAt || new Date(expiresAt) < new Date()) {
      console.log(`[GitHubSync] Entitlement expired or missing. expiresAt=${expiresAt}, now=${new Date().toISOString()}`);
      return { success: false, error: 'Entitlement expired' };
    }

    // --- BUILD PAYLOAD ---
    const plan = userData.plan || 'none';
    const selectedClass = plan === 'aio' ? 'all' : (userData.selectedClass || null);
    const safeKey = String(key).trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = `licenses/${safeKey}.json`;

    const payload = {
      key: safeKey,
      plan,
      selectedClass,
      expires: new Date(expiresAt).toISOString(),
      updatedAt: new Date().toISOString()
    };
    console.log(`[GitHubSync] Building license JSON:`, JSON.stringify(payload));

    // --- GITHUB API ---
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const contentEncoded = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64');

    console.log(`[GitHubSync] GitHub target: owner=${GITHUB_OWNER}, repo=${GITHUB_REPO}, path=${filePath}`);

    // Verify authenticated identity
    try {
      const { data: userData } = await octokit.rest.users.getAuthenticated();
      console.log(`[GitHubSync] Authenticated as: ${userData.login} (type=${userData.type}, id=${userData.id})`);
    } catch (authErr: any) {
      console.error(`[GitHubSync] Identity check FAILED. Status: ${authErr.status}, Message: ${authErr.message}`);
      return {
        success: false,
        error: `GitHub authentication failed: ${authErr.message}`,
        githubStatus: authErr.status,
        githubResponse: authErr.response?.data || null
      };
    }

    // Verify repository accessibility
    try {
      const { data: repoData } = await octokit.rest.repos.get({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO
      });
      console.log(`[GitHubSync] Repo accessible: ${repoData.full_name}, visibility=${repoData.visibility}, default_branch=${repoData.default_branch}, permissions=${JSON.stringify(repoData.permissions)}`);
    } catch (repoErr: any) {
      console.error(`[GitHubSync] Repo access FAILED for ${GITHUB_OWNER}/${GITHUB_REPO}. Status: ${repoErr.status}, Message: ${repoErr.message}, Response:`, repoErr.response?.data || '(no response data)');
      return {
        success: false,
        error: `Repository ${GITHUB_OWNER}/${GITHUB_REPO} not accessible: ${repoErr.message}`,
        githubStatus: repoErr.status,
        githubResponse: repoErr.response?.data || null
      };
    }

    console.log(`[GitHubSync] Checking if file already exists...`);

    let sha: string | undefined;
    let getStatus: number | undefined;
    try {
      const { data: fileData, status } = await octokit.rest.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: filePath
      });
      getStatus = status;
      if (!Array.isArray(fileData)) {
        sha = fileData.sha;
      }
      console.log(`[GitHubSync] File exists. GET status=${status}, sha=${sha || '(directory)'}`);
    } catch (e: any) {
      getStatus = e.status;
      if (e.status === 404) {
        console.log(`[GitHubSync] File does not exist (404). Will create new file.`);
      } else {
        console.error(`[GitHubSync] File check FAILED. Status: ${e.status}, Message: ${e.message}, Response:`, e.response?.data || '(no response data)');
      }
    }

    console.log(`[GitHubSync] Sending createOrUpdateFileContents...`);
    let result;
    let writeStatus: number | undefined;
    try {
      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: filePath,
        message: `Sync license ${safeKey} for user ${userId} (${plan})`,
        content: contentEncoded,
        sha
      });
      result = response;
      writeStatus = response.status;
      console.log(`[GitHubSync] GitHub write SUCCESS. HTTP status=${response.status}, commit SHA=${response.data.commit.sha}`);
    } catch (ghErr: any) {
      console.error(`[GitHubSync] GitHub write FAILED. HTTP status=${ghErr.status}, Message: ${ghErr.message}, Response:`, ghErr.response?.data || '(no response data)');
      throw ghErr;
    }

    const action = sha ? 'Updated' : 'Created';
    console.log(`[GitHubSync] ${action} file: ${filePath}`);
    if (selectedClass) {
      console.log(`[License] Selected class synced: ${selectedClass}`);
    }
    console.log(`[GitHubSync] === END syncKeyToGithub ===`);

    return {
      success: true,
      path: filePath,
      sha: result.data.commit.sha,
      githubStatus: writeStatus,
      githubResponse: { status: writeStatus, commitSha: result.data.commit.sha },
      selectedKey: safeKey
    };
  } catch (err: any) {
    console.error(`[GitHubSync] === SYNC FAILED ===`);
    console.error(`[GitHubSync] Error for user ${userId}:`, err);
    return {
      success: false,
      error: err.message || 'GitHub API error',
      githubStatus: err.status,
      githubResponse: err.response?.data || null
    };
  }
}

export async function removeKeyFromGithub(key: string): Promise<{ success: boolean; path: string; error?: string }> {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.log('[GitHubSync] Missing GitHub credentials, skipping removal');
    return { success: false, path: `licenses/${key}.json`, error: 'Missing GitHub credentials' };
  }

  const safeKey = String(key).trim().replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = `licenses/${safeKey}.json`;
  console.log(`[GitHubSync] Remove target: owner=${GITHUB_OWNER}, repo=${GITHUB_REPO}, path=${filePath}`);
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
