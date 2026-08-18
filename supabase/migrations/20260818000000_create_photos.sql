-- Photo sessions produced by the kiosk.
--
-- The image bytes live in Vercel Blob; this table holds the record that makes a
-- short code resolvable, expirable and countable. `id` is the 8-character code
-- printed on the kiosk and encoded into the QR.

create table if not exists public.photos (
  id            text primary key,
  blob_url      text        not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  -- What the guest chose, for reporting on which looks actually get used.
  frame         text,
  filter        text,
  sticker_count integer     not null default 0,
  byte_size     integer,
  -- Set when the purge job removes the blob, so the row can be kept for stats.
  purged_at     timestamptz
);

-- The purge job scans by deadline; the lookup path hits the primary key.
create index if not exists photos_expires_at_idx
  on public.photos (expires_at)
  where purged_at is null;

create index if not exists photos_created_at_idx
  on public.photos (created_at desc);

-- Every read and write goes through the serverless functions using the service
-- role key, which bypasses RLS. Enabling RLS with no policies therefore denies
-- anonymous and authenticated clients entirely, which is what we want: the
-- anon key must never be able to enumerate photos.
alter table public.photos enable row level security;

comment on table public.photos is
  'Kiosk photo records. Bytes are in Vercel Blob; rows outlive the blob for stats.';
