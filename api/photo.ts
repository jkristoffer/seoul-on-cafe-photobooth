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
  const removed = Boolean(data.hidden_at);
  // What suspends the expiry is the entry actually standing, not the consent on
  // its own. A photo staff have taken down would otherwise keep the exemption it
  // was granted for being in the guest book and be hosted, on a live link, for
  // ever — the one outcome a takedown is supposed to prevent. Removed, it falls
  // back to the ordinary 24 hours and the purge collects it on schedule.
  const kept = consented && !removed;

  // Expiry is enforced here, not by the purge job, so the link dies on time
  // regardless of when the bytes are actually reclaimed.
  //
  // While an entry stands, this link is the only credential the guest holds over
  // it — a page that has gone 410 cannot offer them the button that takes it
  // back down — so it stays alive for as long as the entry does.
  if (data.purged_at || (!kept && Date.now() > expiresAt)) {
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
    // Consent is reported as the guest left it — a takedown is not them changing
    // their mind, and the column that records their decision is untouched. But
    // the removal is reported too, because the page's job is to tell them the
    // truth about where their photo is, and offering to take down something that
    // is already down would be a lie made of buttons.
    consented,
    removed,
    message: kept ? data.message : null,
  });
}
