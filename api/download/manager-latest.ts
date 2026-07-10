import type { VercelRequest, VercelResponse } from '@vercel/node';

const GITHUB_REPO = 'FAFO-Rotations/FAFO-Rotations';
const DEFAULT_ASSET = 'FAFO.zip';

// Same proxy-download pattern as api/download/latest.ts, but for the FAFO Manager's own release
// train. The repo has two independent series of GitHub Releases sharing one repo: `release-*`
// (main Lua bundle, from bundle.yml) and `manager-*` (this one, from fafo-manager.yml). Reusing
// latest.ts's GitHub "latest release" endpoint directly would be wrong here -- it returns whichever
// series most recently published, which would silently break EITHER download link the next time the
// other series publishes. So this lists releases and picks the newest whose tag starts with
// "manager-" explicitly, instead of trusting GitHub's own single "latest" slot.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('[ManagerDownloadProxy] GITHUB_TOKEN not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const assetName = (req.query.asset as string) || DEFAULT_ASSET;

  try {
    // 1. Fetch releases and pick the newest manager-* one. NOTE: GitHub's /releases list endpoint
    // does NOT reliably return newest-first (confirmed empirically -- a release published hours
    // after another one showed up in the MIDDLE of the list, not first), so this sorts by
    // created_at explicitly rather than trusting API order.
    console.log(`[ManagerDownloadProxy] Fetching releases for ${GITHUB_REPO}`);
    const releasesRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'FAFO-Download-Proxy/1.0'
      }
    });

    if (!releasesRes.ok) {
      const errorBody = await releasesRes.text();
      console.error(`[ManagerDownloadProxy] GitHub releases fetch failed: ${releasesRes.status}`, errorBody);
      if (releasesRes.status === 401 || releasesRes.status === 403) {
        return res.status(502).json({ error: 'GitHub authentication failed. Check GITHUB_TOKEN.' });
      }
      return res.status(502).json({ error: 'Failed to fetch release info from GitHub' });
    }

    const releases = await releasesRes.json();
    const release = (releases as any[])
      .filter(r => typeof r.tag_name === 'string' && r.tag_name.startsWith('manager-'))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    if (!release) {
      console.error('[ManagerDownloadProxy] No manager-* release found');
      return res.status(404).json({ error: 'No FAFO Manager release found yet' });
    }

    const tag = release.tag_name;
    const assets = release.assets || [];

    console.log(`[ManagerDownloadProxy] Latest manager release: ${tag}, assets: ${assets.length}`);

    if (assets.length === 0) {
      console.error(`[ManagerDownloadProxy] Release ${tag} has no assets`);
      return res.status(404).json({ error: 'Latest FAFO Manager release has no assets' });
    }

    // 2. Find the requested asset
    const asset = assets.find((a: any) => a.name === assetName);
    if (!asset) {
      const available = assets.map((a: any) => a.name).join(', ');
      console.error(`[ManagerDownloadProxy] Asset "${assetName}" not found. Available: ${available}`);
      return res.status(404).json({
        error: `Asset "${assetName}" not found in release ${tag}`,
        availableAssets: assets.map((a: any) => a.name)
      });
    }

    console.log(`[ManagerDownloadProxy] Selected asset: ${asset.name}, id: ${asset.id}, size: ${asset.size}, content_type: ${asset.content_type}`);

    // 3. Download asset via GitHub API (manual redirect to avoid leaking auth to S3)
    const assetApiUrl = asset.url;
    console.log(`[ManagerDownloadProxy] Requesting asset API: ${assetApiUrl}`);

    const assetRedirectRes = await fetch(assetApiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/octet-stream',
        'User-Agent': 'FAFO-Download-Proxy/1.0'
      },
      redirect: 'manual'
    });

    if (assetRedirectRes.status !== 302 && assetRedirectRes.status !== 301) {
      const errorBody = await assetRedirectRes.text();
      console.error(`[ManagerDownloadProxy] Expected redirect, got ${assetRedirectRes.status}`, errorBody);
      return res.status(502).json({ error: 'GitHub asset download unexpected response' });
    }

    const downloadUrl = assetRedirectRes.headers.get('location');
    if (!downloadUrl) {
      console.error(`[ManagerDownloadProxy] Redirect location missing`);
      return res.status(502).json({ error: 'GitHub asset redirect URL missing' });
    }

    console.log(`[ManagerDownloadProxy] Following redirect to binary URL (length: ${downloadUrl.length})`);

    // 4. Fetch binary from the pre-signed URL (no auth headers)
    const binaryRes = await fetch(downloadUrl);

    if (!binaryRes.ok) {
      const errorBody = await binaryRes.text();
      console.error(`[ManagerDownloadProxy] Binary download failed: ${binaryRes.status}`, errorBody);
      return res.status(502).json({ error: 'Failed to download asset binary' });
    }

    const contentLength = binaryRes.headers.get('content-length');

    // 5. Stream to client
    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${assetName}"`);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    res.setHeader('Cache-Control', 'no-store');

    if (binaryRes.body) {
      const reader = binaryRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } else {
      const buffer = await binaryRes.arrayBuffer();
      res.end(Buffer.from(buffer));
    }

    console.log(`[ManagerDownloadProxy] Stream success: ${asset.name}, size: ${contentLength || 'unknown'}`);

  } catch (err: any) {
    console.error('[ManagerDownloadProxy] Unhandled error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
    res.end();
  }
}
