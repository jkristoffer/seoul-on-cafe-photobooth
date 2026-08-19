import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const TTL_MS = 24 * 60 * 60 * 1000;

/** Short codes use a Crockford-style alphabet: no I, L, O or U. */
export const ID_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** A guest book message is one line, read at arm's length off a wall. */
export const MESSAGE_MAX = 140;

export interface PhotoRow {
  id: string;
  blob_url: string;
  created_at: string;
  expires_at: string;
  frame: string | null;
  filter: string | null;
  sticker_count: number;
  byte_size: number | null;
  purged_at: string | null;
  /** Set when the guest asked us to keep the photo; exempts it from the purge. */
  consented_at: string | null;
  message: string | null;
  message_at: string | null;
  /** Staff takedown, independent of consent. */
  hidden_at: string | null;
  /** Null for guest photos; set for seeded entries, which are attributed and immutable. */
  source: string | null;
}

let client: SupabaseClient | null = null;

/**
 * Server-side Supabase client. Uses the secret key, which bypasses RLS — the
 * photos table has RLS on with no policies, so this is the only way in. This
 * key must never reach the kiosk.
 */
export function db(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must both be set');
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
