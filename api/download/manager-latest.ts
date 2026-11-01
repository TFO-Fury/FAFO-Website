import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const GITHUB_REPO = 'FAFO-Rotations/FAFO-Rotations';
const DEFAULT_ASSET = 'FAFO.zip';

// ZIP end-of-central-directory record: a fixed 22-byte trailer every zip
// reader (Explorer, 7-Zip, Python's zipfile, the ones real-world leaks get
// re-extracted and re-zipped with) locates by scanning backward from EOF for
// this signature, then trusts the comment-length field to know how many
// bytes of free-form "comment" follow it. Rewriting just that comment is the
// one way to change the file's bytes - and therefore its hash - on every
// download without touching any entry's data or the central directory, so
// the archive still opens identically for the person downloading it.
const EOCD_SIG = 0x06054b50;
const EOCD_FIXED_SIZE = 22;
const MAX_COMMENT_LEN = 65535;

function findEocdOffset(buf: Buffer): number {
  const searchStart = Math.max(0, buf.length - EOCD_FIXED_SIZE - MAX_COMMENT_LEN);
  // Scan backward from the end so a signature-looking byte sequence inside
  // stored file data (before any real EOCD) is never mistaken for it - and
  // confirm the match by checking the comment length actually reaches EOF,
  // since the 4-byte signature alone isn't enough to rule out a coincidence.
  for (let offset = buf.length - EOCD_FIXED_SIZE; offset >= searchStart; offset--) {
    if (buf.readUInt32LE(offset) === EOCD_SIG) {
      const commentLen = buf.readUInt16LE(offset + 20);
      if (offset + EOCD_FIXED_SIZE + commentLen === buf.length) return offset;
    }
  }
  return -1;
}

// Stamps a unique watermark (timestamp + random nonce, so two downloads in
// the same millisecond still differ) into the hidden ZIP comment field.
// Invisible during normal use - nothing in the archive's file list or
// extracted contents changes - but it means every single download is a
// bit-for-bit unique file, traceable back to this log line if a copy of it
// ever turns up somewhere it shouldn't.
function watermarkZip(buf: Buffer, assetName: string): Buffer {
  const eocdOffset = findEocdOffset(buf);
  if (eocdOffset === -1) {
    console.error(`[ManagerDownloadProxy] Could not locate ZIP EOCD in "${assetName}"; shipping unwatermarked`);
    return buf;
  }
  const watermark = `fafo-dl:${new Date().toISOString()}:${crypto.randomBytes(8).toString('hex')}`;
  const commentBuf = Buffer.from(watermark, 'utf8');
  const lengthBuf = Buffer.alloc(2);
  lengthBuf.writeUInt16LE(commentBuf.length, 0);
  console.log(`[ManagerDownloadProxy] Watermarked "${assetName}": ${watermark}`);
  return Buffer.concat([buf.subarray(0, eocdOffset + 20), lengthBuf, commentBuf]);
}

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
    // created_at explicitly rather than trusting API order. The repo's main bundle pipeline
    // (release-*) publishes far more often than the manager (manager-*), so a single page of 20
    // isn't enough -- it can push the last manager-* release off the page entirely. Paginate
    // through up to 10 pages (1000 releases) before giving up.
    console.log(`[ManagerDownloadProxy] Fetching releases for ${GITHUB_REPO}`);
    const releases: any[] = [];
    for (let page = 1; page <= 10; page++) {
      const releasesRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100&page=${page}`, {
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

      const pageReleases: any[] = await releasesRes.json();
      releases.push(...pageReleases);

      const hasManagerRelease = pageReleases.some(r => typeof r.tag_name === 'string' && r.tag_name.startsWith('manager-'));
      if (hasManagerRelease || pageReleases.length < 100) break;
    }

    const release = releases
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

    // 5. Buffer the full file (watermarking needs to rewrite the trailing few
    // bytes after the whole thing is in hand - can't stream chunk-by-chunk
    // and still do that) and watermark it if it's a zip before sending.
    const rawBuffer = Buffer.from(await binaryRes.arrayBuffer());
    const outBuffer = assetName.toLowerCase().endsWith('.zip') ? watermarkZip(rawBuffer, assetName) : rawBuffer;

    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${assetName}"`);
    res.setHeader('Content-Length', String(outBuffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(outBuffer);

    console.log(`[ManagerDownloadProxy] Download success: ${asset.name}, size: ${outBuffer.length}`);

  } catch (err: any) {
    console.error('[ManagerDownloadProxy] Unhandled error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
    res.end();
  }
}
