import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, ID_RE, type PhotoRow } from './_db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.id;
  const id = (Array.isArray(raw) ? raw[0] : raw ?? '').toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });

  const { data, error } = await db()
    .from('photos')
    .select('id, blob_url, created_at, expires_at, purged_at')
    .eq('id', id)
    .maybeSingle<Pick<PhotoRow, 'id' | 'blob_url' | 'created_at' | 'expires_at' | 'purged_at'>>();

  if (error) {
    console.error('photo lookup failed', error);
    return res.status(502).json({ error: 'lookup_failed' });
  }
  if (!data) return res.status(404).json({ error: 'not_found' });

  const expiresAt = new Date(data.expires_at).getTime();
  // Expiry is enforced here, not by the purge job, so the link dies on time
  // regardless of when the bytes are actually reclaimed.
  if (Date.now() > expiresAt || data.purged_at) {
    return res.status(410).json({ error: 'expired' });
  }

  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({
    id: data.id,
    url: data.blob_url,
    uploadedAt: new Date(data.created_at).getTime(),
    expiresAt,
  });
}
