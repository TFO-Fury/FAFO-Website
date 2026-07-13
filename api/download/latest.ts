import type { VercelRequest, VercelResponse } from '@vercel/node';

const GITHUB_REPO = 'FAFO-Rotations/FAFO-Rotations';
const DEFAULT_ASSET = 'FAFO_AIO.lua';

// The repo has two independent series of GitHub Releases sharing one repo: `release-*` (this one,
// the main Lua bundle, from bundle.yml) and `manager-*` (the FAFO Manager, from fafo-manager.yml).
// GitHub's own "latest release" endpoint returns whichever series most recently published, which
// silently broke THIS endpoint the moment a manager-* release published after the last release-*
// one (2026-07-13: this returned FAFO.zip's "unknown asset" error for FAFO_AIO.lua requests because
// /releases/latest had started resolving to a manager-* release). Same fix as
// api/download/manager-latest.ts already uses for its own series: list releases and pick the
// newest whose tag starts with "release-" explicitly, instead of trusting GitHub's single "latest"
// slot.
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
    // 1. Fetch releases and pick the newest release-* one. NOTE: GitHub's /releases list endpoint
    // does NOT reliably return newest-first (confirmed empirically elsewhere in this codebase), so
    // this sorts by created_at explicitly rather than trusting API order.
    console.log(`[DownloadProxy] Fetching releases for ${GITHUB_REPO}`);
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
      console.error(`[DownloadProxy] GitHub releases fetch failed: ${releasesRes.status}`, errorBody);
      if (releasesRes.status === 401 || releasesRes.status === 403) {
        return res.status(502).json({ error: 'GitHub authentication failed. Check GITHUB_TOKEN.' });
      }
      return res.status(502).json({ error: 'Failed to fetch release info from GitHub' });
    }

    const releases = await releasesRes.json();
    const release = (releases as any[])
      .filter(r => typeof r.tag_name === 'string' && r.tag_name.startsWith('release-'))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    if (!release) {
      console.error('[DownloadProxy] No release-* release found');
      return res.status(404).json({ error: 'No main bundle release found yet' });
    }

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
