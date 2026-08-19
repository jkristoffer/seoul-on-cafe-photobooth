import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, ID_RE, type PhotoRow } from './_db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.id;
  const id = (Array.isArray(raw) ? raw[0] : raw ?? '').toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });

  const cols = 'id, blob_url, created_at, expires_at, purged_at, consented_at, message, hidden_at';
  const { data, error } = await db()
    .from('photos')
    .select(cols)
    .eq('id', id)
    .maybeSingle<Pick<PhotoRow,
      'id' | 'blob_url' | 'created_at' | 'expires_at' | 'purged_at' |
      'consented_at' | 'message' | 'hidden_at'>>();

  if (error) {
    console.error('photo lookup failed', error);
    return res.status(502).json({ error: 'lookup_failed' });
  }
  if (!data) return res.status(404).json({ error: 'not_found' });

  const expiresAt = new Date(data.expires_at).getTime();
  const consented = Boolean(data.consented_at);
  // Expiry is enforced here, not by the purge job, so the link dies on time
  // regardless of when the bytes are actually reclaimed.
  //
  // Consent suspends it. The guest asked for the photo to be kept, and this
  // link is the only credential they hold over the entry — a page that has gone
  // 410 cannot offer them the button that takes it back down.
  if (data.purged_at || (!consented && Date.now() > expiresAt)) {
    return res.status(410).json({ error: 'expired' });
  }

  // Never cache: the page reads its own consent state from this response, and a
  // guest who has just withdrawn must not be shown the entry still standing.
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    id: data.id,
    url: data.blob_url,
    uploadedAt: new Date(data.created_at).getTime(),
    expiresAt,
    consented,
    // A hidden entry still reports as consented to the guest who made it: the
    // takedown is staff business, and dropping their consent silently would be
    // telling them they changed their mind.
    message: consented ? data.message : null,
  });
}
