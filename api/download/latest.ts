import type { VercelRequest, VercelResponse } from '@vercel/node';

const GITHUB_REPO = 'FAFO-Rotations/FAFO-Rotations';
// The release payload is now the FAFO v2.6 addon package (FAFO.zip), not the old bundled
// FAFO_AIO.lua. The bare /api/download/latest link (Discord "new build" ping) serves this.
// Per-spec delivery is supported via ?asset=FAFO-<Spec>.zip once those assets are wired up.
const DEFAULT_ASSET = 'FAFO.zip';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('[DownloadProxy] GITHUB_TOKEN not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const assetName = (req.query.asset as string) || DEFAULT_ASSET;

  try {
    // 1. Fetch latest release info
    console.log(`[DownloadProxy] Fetching latest release for ${GITHUB_REPO}`);
    const releaseRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'FAFO-Download-Proxy/1.0'
      }
    });

    if (!releaseRes.ok) {
      const errorBody = await releaseRes.text();
      console.error(`[DownloadProxy] GitHub release fetch failed: ${releaseRes.status}`, errorBody);
      if (releaseRes.status === 401 || releaseRes.status === 403) {
        return res.status(502).json({ error: 'GitHub authentication failed. Check GITHUB_TOKEN.' });
      }
      if (releaseRes.status === 404) {
        return res.status(502).json({ error: 'Repository or release not found' });
      }
      return res.status(502).json({ error: 'Failed to fetch release info from GitHub' });
    }

    const release = await releaseRes.json();
    const tag = release.tag_name;
    const assets = release.assets || [];

    console.log(`[DownloadProxy] Latest release: ${tag}, assets: ${assets.length}`);

    if (assets.length === 0) {
      console.error(`[DownloadProxy] Release ${tag} has no assets`);
      return res.status(404).json({ error: 'Latest release has no assets' });
    }

    // 2. Find the requested asset
    const asset = assets.find((a: any) => a.name === assetName);
    if (!asset) {
      const available = assets.map((a: any) => a.name).join(', ');
      console.error(`[DownloadProxy] Asset "${assetName}" not found. Available: ${available}`);
      return res.status(404).json({
        error: `Asset "${assetName}" not found in release ${tag}`,
        availableAssets: assets.map((a: any) => a.name)
      });
    }

    console.log(`[DownloadProxy] Selected asset: ${asset.name}, id: ${asset.id}, size: ${asset.size}, content_type: ${asset.content_type}`);

    // 3. Download asset via GitHub API (manual redirect to avoid leaking auth to S3)
    const assetApiUrl = asset.url;
    console.log(`[DownloadProxy] Requesting asset API: ${assetApiUrl}`);

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
      console.error(`[DownloadProxy] Expected redirect, got ${assetRedirectRes.status}`, errorBody);
      return res.status(502).json({ error: 'GitHub asset download unexpected response' });
    }

    const downloadUrl = assetRedirectRes.headers.get('location');
    if (!downloadUrl) {
      console.error(`[DownloadProxy] Redirect location missing`);
      return res.status(502).json({ error: 'GitHub asset redirect URL missing' });
    }

    console.log(`[DownloadProxy] Following redirect to binary URL (length: ${downloadUrl.length})`);

    // 4. Fetch binary from the pre-signed URL (no auth headers)
    const binaryRes = await fetch(downloadUrl);

    if (!binaryRes.ok) {
      const errorBody = await binaryRes.text();
      console.error(`[DownloadProxy] Binary download failed: ${binaryRes.status}`, errorBody);
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

    console.log(`[DownloadProxy] Stream success: ${asset.name}, size: ${contentLength || 'unknown'}`);

  } catch (err: any) {
    console.error('[DownloadProxy] Unhandled error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
    res.end();
  }
}
