import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list, del } from '@vercel/blob';
import { TTL_MS } from '../photo.js';

export const config = { maxDuration: 60 };

/**
 * Storage cleanup for expired photos. Vercel Blob has no native TTL.
 *
 * The kiosk's "EXPIRES IN 24H" promise is enforced by /api/photo returning 410
 * past the deadline, not by this job — so running daily (the Hobby plan cron
 * limit) only means bytes linger a little after the link already went dead.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Fail closed: a deployed booth with no CRON_SECRET refuses to purge rather
  // than leaving a public delete endpoint open. Vercel attaches this header to
  // its own cron invocations whenever the variable is set.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET is not set — refusing to run purge');
    return res.status(503).json({ error: 'not_configured' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const cutoff = Date.now() - TTL_MS;
  const expired: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await list({ prefix: 'photos/', cursor, limit: 1000 });
    for (const blob of page.blobs) {
      if (new Date(blob.uploadedAt).getTime() < cutoff) expired.push(blob.url);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  // del() accepts batches; chunk so a large backlog stays under request limits.
  for (let i = 0; i < expired.length; i += 100) {
    await del(expired.slice(i, i + 100));
  }

  console.log(`purge: deleted ${expired.length} expired photo(s)`);
  return res.status(200).json({ deleted: expired.length });
}
