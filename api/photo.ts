import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list } from '@vercel/blob';

export const TTL_MS = 24 * 60 * 60 * 1000;

const ID_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.id;
  const id = (Array.isArray(raw) ? raw[0] : raw ?? '').toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });

  // The blob path is the short code, so a prefix lookup replaces a database.
  const { blobs } = await list({ prefix: `photos/${id}.jpg`, limit: 1 });
  const blob = blobs.find(b => b.pathname === `photos/${id}.jpg`);
  if (!blob) return res.status(404).json({ error: 'not_found' });

  const uploadedAt = new Date(blob.uploadedAt).getTime();
  const expiresAt = uploadedAt + TTL_MS;
  if (Date.now() > expiresAt) return res.status(410).json({ error: 'expired' });

  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({ id, url: blob.url, uploadedAt, expiresAt });
}
