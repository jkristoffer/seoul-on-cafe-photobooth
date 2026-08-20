import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, type PhotoRow } from './_db.js';

/**
 * The guest book feed. Newest first, consented only.
 *
 * This is the one endpoint that enumerates photos, which is exactly what the
 * rest of the system is built to prevent — every other read needs the 8-char
 * code. It is safe only because of the where clause: a row is invisible here
 * until a guest has asked for it to be visible.
 *
 * Reading through a function rather than opening an RLS policy to the anon key
 * is what keeps the kiosk and the wall dependency-free, and it means the column
 * list below is the whole of what can ever leave the table. The blob URL is
 * public by nature — it is what a QR resolves to — but the code is not: it is
 * the credential that edits an entry, so the feed hands out neither it nor
 * anything else the row happens to carry.
 */

const PAGE_DEFAULT = 30;
const PAGE_MAX = 100;

type Row = Pick<PhotoRow, 'blob_url' | 'consented_at' | 'message' | 'frame' | 'source'>;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(one(req.query.limit)) || PAGE_DEFAULT));
  // Keyset paging on consented_at: an offset would skip or repeat entries as new
  // ones land at the top mid-scroll, which on a wall that polls is every minute.
  const before = String(one(req.query.before) ?? '');
  // The wall asks for the live feed; the archive takes the cached one. See the
  // Cache-Control below for why the two surfaces want different answers.
  const live = String(one(req.query.live) ?? '') === '1';

  let q = db()
    .from('photos')
    .select('blob_url, consented_at, message, frame, source')
    .not('consented_at', 'is', null)
    .is('hidden_at', null)
    .is('purged_at', null)
    .order('consented_at', { ascending: false })
    .limit(limit);

  if (before && !Number.isNaN(Date.parse(before))) q = q.lt('consented_at', before);

  const { data, error } = await q.returns<Row[]>();
  if (error) {
    console.error('guestbook query failed', error);
    return res.status(502).json({ error: 'query_failed' });
  }

  const entries = (data ?? []).map(r => ({
    url: r.blob_url,
    at: new Date(r.consented_at!).getTime(),
    message: r.message,
    frame: r.frame,
    // Drives the attribution mark. A cafe photo sitting untagged among guest
    // polaroids reads as manufactured social proof; named, it is the cafe
    // introducing itself.
    source: r.source,
  }));

  // Two surfaces, two answers.
  //
  // The wall is the screen a takedown has to reach, and the cache is pure delay
  // in front of it: the poll interval is already the floor on how fast staff can
  // clear the room, and a CDN layer only adds to it. So the wall opts out. It is
  // a handful of screens in one cafe — at a 20s poll that is roughly 130k
  // requests a month per screen, which is real but affordable, and it is the
  // honest price of a wall that clears when someone says clear it. (Purging the
  // cache on takedown would get to the same place; it would just do it with a
  // platform feature and a dependency, and still not beat the poll interval.)
  //
  // The archive is the opposite case: shareable, hit by phones rather than by one
  // known screen, and nobody is standing in front of it waiting. It caches — but
  // briefly, because it must not serve a removed photo for long either.
  res.setHeader('Cache-Control', live ? 'no-store' : 'public, s-maxage=20, stale-while-revalidate=40');
  return res.status(200).json({
    entries,
    // Cursor for the next page, absent when this was the last one.
    next: entries.length === limit ? new Date(entries[entries.length - 1].at).toISOString() : null,
  });
}
