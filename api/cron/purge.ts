import type { VercelRequest, VercelResponse } from '@vercel/node';
import { del } from '@vercel/blob';
import { db } from '../_db.js';

export const config = { maxDuration: 60 };

/**
 * Storage cleanup for expired photos. Vercel Blob has no native TTL.
 *
 * The kiosk's "EXPIRES IN 24H" promise is enforced by /api/photo returning 410
 * past the deadline, not by this job — so running daily (the Hobby plan cron
 * limit) only means bytes linger a little after the link already went dead.
 *
 * Rows are kept and stamped with purged_at rather than deleted, so session
 * stats survive the images.
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

  const sb = db();
  const { data, error } = await sb
    .from('photos')
    .select('id, blob_url')
    .lt('expires_at', new Date().toISOString())
    .is('purged_at', null)
    .limit(1000);

  if (error) {
    console.error('purge query failed', error);
    return res.status(502).json({ error: 'query_failed' });
  }
  if (!data || data.length === 0) return res.status(200).json({ deleted: 0 });

  const purged: string[] = [];
  // del() accepts batches; chunk so a large backlog stays under request limits.
  for (let i = 0; i < data.length; i += 100) {
    const batch = data.slice(i, i + 100);
    try {
      await del(batch.map(r => r.blob_url));
      purged.push(...batch.map(r => r.id));
    } catch (err) {
      // Leave these rows unstamped so the next run retries them.
      console.error('blob delete failed for batch', err);
    }
  }

  if (purged.length) {
    const { error: stampError } = await sb
      .from('photos')
      .update({ purged_at: new Date().toISOString() })
      .in('id', purged);
    if (stampError) console.error('purge stamp failed', stampError);
  }

  console.log(`purge: deleted ${purged.length} of ${data.length} expired photo(s)`);
  return res.status(200).json({ deleted: purged.length, found: data.length });
}
