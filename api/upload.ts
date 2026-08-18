import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

export const config = { maxDuration: 30 };

// Crockford-ish: no I/L/O/U, so codes read cleanly off a printed polaroid.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 8;
const MAX_BYTES = 3 * 1024 * 1024;

function newId(): string {
  // Rejection-free because 256 % 32 === 0 — every byte maps to exactly one symbol.
  return Array.from(randomBytes(ID_LENGTH), b => ALPHABET[b % ALPHABET.length]).join('');
}

function originOf(req: VercelRequest): string {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  return `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body as { image?: unknown } | undefined;
  const image = body?.image;
  if (typeof image !== 'string' || !image) {
    return res.status(400).json({ error: 'missing_image' });
  }

  // Accept either a bare base64 payload or a full `data:image/jpeg;base64,...` URL.
  const base64 = image.startsWith('data:') ? image.slice(image.indexOf(',') + 1) : image;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    return res.status(400).json({ error: 'bad_base64' });
  }
  if (bytes.length === 0) return res.status(400).json({ error: 'empty_image' });
  if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'image_too_large' });
  // JPEG SOI marker — refuse anything that is not actually an image.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return res.status(400).json({ error: 'not_a_jpeg' });
  }

  const id = newId();
  try {
    await put(`photos/${id}.jpg`, bytes, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      cacheControlMaxAge: 60 * 60 * 24,
    });
  } catch (err) {
    console.error('blob put failed', err);
    return res.status(502).json({ error: 'storage_unavailable' });
  }

  const shareUrl = `${originOf(req)}/p/${id}`;
  const qr = await QRCode.toDataURL(shareUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
    color: { dark: '#123B26FF', light: '#F7F1E3FF' },
  });

  return res.status(200).json({ id, shareUrl, qr, expiresInHours: 24 });
}
