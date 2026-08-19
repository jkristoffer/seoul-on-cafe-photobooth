import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, ID_RE, MESSAGE_MAX, type PhotoRow } from './_db.js';

/**
 * The guest's own control over their guest book entry: consent, withdraw, and
 * write or clear the message.
 *
 * The 8-character code is the credential. There are no accounts, so holding the
 * code — which means holding the polaroid or the QR link — is what authorises
 * an edit. That is the same trust model as the download itself, and it is the
 * right one for a cafe: the alternative is asking a guest to make an account
 * before they can take their own photo back down.
 *
 * Both surfaces post here. The kiosk sends consent alone, because it has no text
 * entry; the phone sends either, and is the only place a message ever comes from.
 */

type Patch = Partial<Pick<PhotoRow, 'consented_at' | 'message' | 'message_at'>>;

/**
 * A wall is read at arm's length, so a message is one line. Newlines and control
 * characters are folded rather than rejected: a guest who pressed return should
 * not be handed a validation error, they should be handed a shorter line.
 */
function cleanMessage(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;              // field absent — leave as is
  if (v === null) return null;                        // explicit clear
  if (typeof v !== 'string') return undefined;
  const text = v.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, MESSAGE_MAX);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body as Record<string, unknown> | undefined;
  const id = String(body?.id ?? '').toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });

  const consent = typeof body?.consent === 'boolean' ? body.consent : undefined;
  const message = cleanMessage(body?.message);
  if (consent === undefined && message === undefined) {
    return res.status(400).json({ error: 'nothing_to_do' });
  }

  const sb = db();
  const { data: row, error: readError } = await sb
    .from('photos')
    .select('id, expires_at, purged_at, consented_at')
    .eq('id', id)
    .maybeSingle<Pick<PhotoRow, 'id' | 'expires_at' | 'purged_at' | 'consented_at'>>();

  if (readError) {
    console.error('entry lookup failed', readError);
    return res.status(502).json({ error: 'lookup_failed' });
  }
  if (!row) return res.status(404).json({ error: 'not_found' });

  // Nothing can be done to a photo whose bytes are gone, and a private photo
  // past its deadline is already promised dead — consenting to it now would be
  // reviving something the guest was told had expired.
  const alive = !row.purged_at &&
    (Boolean(row.consented_at) || Date.now() <= new Date(row.expires_at).getTime());
  if (!alive) return res.status(410).json({ error: 'expired' });

  const now = new Date().toISOString();
  const patch: Patch = {};

  if (consent === true && !row.consented_at) patch.consented_at = now;
  // Withdrawal clears the consent only. The message stays on the row unserved,
  // so a guest who takes the entry down and puts it back does not have to write
  // it again — and nothing they wrote is readable in the meantime.
  if (consent === false) patch.consented_at = null;

  // A message is part of an entry, so there has to be an entry. Sending both in
  // one request is the normal path from the phone and is fine; sending a message
  // to a photo that is not in the guest book is not.
  if (message !== undefined) {
    const willBeConsented = consent === true || (consent === undefined && Boolean(row.consented_at));
    if (!willBeConsented) return res.status(409).json({ error: 'not_consented' });
    patch.message = message;
    patch.message_at = message === null ? null : now;
  }

  if (Object.keys(patch).length) {
    const { error } = await sb.from('photos').update(patch).eq('id', id);
    if (error) {
      console.error('entry update failed', error);
      return res.status(502).json({ error: 'update_failed' });
    }
  }

  const consented = 'consented_at' in patch
    ? Boolean(patch.consented_at)
    : Boolean(row.consented_at);
  return res.status(200).json({ id, consented });
}
