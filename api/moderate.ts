import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { db, ID_RE, type PhotoRow } from './_db.js';

/**
 * Staff takedown for the guest book.
 *
 * This is the counterweight to /api/guestbook: consent puts an entry on a wall in
 * a public room without anyone approving it, so there has to be a way to take one
 * back off in under a minute, from a phone, by someone who is not a developer.
 *
 * Everything here works through one column. `hidden_at` set means the feed skips
 * the row, and that is the whole mechanism — which is deliberate, because the
 * next thing to want a photo off the wall is an automatic screen rather than a
 * person, and it should set this same column rather than invent a second state.
 *
 * Hiding never destroys anything. The row, the bytes and the guest's words all
 * stay exactly as they were, so a takedown made in a hurry can be undone. The
 * guest's own withdrawal is a different act on a different column (`consented_at`,
 * through /api/entry) and neither overwrites the other: an entry a guest has
 * taken down stays down whatever staff do here, and vice versa.
 */

const PAGE_DEFAULT = 40;
const PAGE_MAX = 100;

type Row = Pick<
  PhotoRow,
  'id' | 'blob_url' | 'consented_at' | 'message' | 'message_at' | 'frame' | 'source' | 'hidden_at'
>;

const COLUMNS = 'id, blob_url, consented_at, message, message_at, frame, source, hidden_at';

/**
 * Fails closed. An unset secret is a deployment mistake, and the wrong response
 * to it is a takedown endpoint anyone can drive — so the endpoint switches off
 * instead, the same way the purge cron does.
 */
function authorised(req: VercelRequest): boolean {
  const secret = process.env.MOD_SECRET;
  if (!secret) return false;
  const header = String(req.headers.authorization ?? '');
  const offered = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Length has to match before the compare, and it leaks on its own — which is
  // acceptable, where a byte-by-byte early return on the secret itself is not.
  const a = Buffer.from(offered);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.MOD_SECRET) {
    console.error('MOD_SECRET is not set — moderation is disabled');
    return res.status(503).json({ error: 'not_configured' });
  }
  if (!authorised(req)) return res.status(401).json({ error: 'unauthorized' });

  // Never cached, at any layer. A moderator acting on a stale list is acting on
  // a wall that has already moved on.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') return list(req, res);
  if (req.method === 'POST') return act(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
}

/**
 * The review list: every consented entry, hidden ones included, newest first.
 *
 * This is the one place the 8-character codes leave the table, which is why the
 * secret guards the GET and not only the POST. The codes have to be here — the
 * code is what the takedown acts on — and everywhere else in the system they are
 * treated as the credential they are.
 */
async function list(req: VercelRequest, res: VercelResponse) {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(one(req.query.limit)) || PAGE_DEFAULT));
  const before = String(one(req.query.before) ?? '');

  let q = db()
    .from('photos')
    .select(COLUMNS)
    .not('consented_at', 'is', null)
    .is('purged_at', null)
    .order('consented_at', { ascending: false })
    .limit(limit);

  if (before && !Number.isNaN(Date.parse(before))) q = q.lt('consented_at', before);

  const { data, error } = await q.returns<Row[]>();
  if (error) {
    console.error('moderation list failed', error);
    return res.status(502).json({ error: 'query_failed' });
  }

  const rows = data ?? [];
  return res.status(200).json({
    entries: rows.map(serialise),
    next: rows.length === limit ? rows[rows.length - 1].consented_at : null,
  });
}

/**
 * Hide, unhide, or strike a message.
 *
 * Two separate failures need two separate answers: a photo that should not be on
 * a wall, and a photo that is fine carrying words that are not. Clearing the
 * message leaves the entry standing, because pulling a guest's photo over someone
 * else's sentence is a heavier act than the situation needs.
 */
async function act(req: VercelRequest, res: VercelResponse) {
  const body = req.body as Record<string, unknown> | undefined;
  const id = String(body?.id ?? '').toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });

  const hidden = typeof body?.hidden === 'boolean' ? body.hidden : undefined;
  // Staff may delete words, never write them. An entry is the guest's voice, and
  // a moderator who could edit it could put a sentence in a stranger's mouth
  // under that stranger's photo.
  const clearMessage = body?.clearMessage === true;
  if (hidden === undefined && !clearMessage) {
    return res.status(400).json({ error: 'nothing_to_do' });
  }

  const patch: Partial<PhotoRow> = {};
  if (hidden !== undefined) patch.hidden_at = hidden ? new Date().toISOString() : null;
  if (clearMessage) {
    patch.message = null;
    patch.message_at = null;
  }

  const { data, error } = await db()
    .from('photos')
    .update(patch)
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle<Row>();

  if (error) {
    console.error('moderation update failed', error);
    return res.status(502).json({ error: 'update_failed' });
  }
  if (!data) return res.status(404).json({ error: 'not_found' });

  console.log(`moderate: ${id} ${hidden === undefined ? '' : hidden ? 'hidden' : 'restored'}${clearMessage ? ' message-cleared' : ''}`);
  return res.status(200).json({ entry: serialise(data) });
}

function serialise(r: Row) {
  return {
    id: r.id,
    url: r.blob_url,
    at: new Date(r.consented_at!).getTime(),
    message: r.message,
    messageAt: r.message_at ? new Date(r.message_at).getTime() : null,
    frame: r.frame,
    source: r.source,
    hidden: Boolean(r.hidden_at),
  };
}
