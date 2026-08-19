-- Seed entries, so the guest book is never an empty room.
--
-- These are the cafe's own photos from @cafe_on_seoul, cropped square from the
-- marketing posters they were published in. They are ordinary rows rather than a
-- special empty state: they sort by date with everything else and sink as real
-- entries arrive, so there is no second code path and no flicker on the day the
-- first guest consents.
--
-- `source` is what separates them. It drives the attribution on the card, and it
-- is what /api/entry refuses to mutate — these codes are readable in this file,
-- so without that guard anyone could take the cafe's own photos down.

alter table public.photos
  add column if not exists source text;

comment on column public.photos.source is
  'Null for guest photos. Set for seeded entries (e.g. instagram), which are attributed on the card and cannot be edited through /api/entry.';

-- The bytes are committed assets under public/assets/guestbook/, not Vercel Blob,
-- so the purge has nothing to delete here even if it ever saw these rows — which
-- it does not, because consent exempts them.
insert into public.photos
  (id, blob_url, created_at, expires_at, consented_at, frame, sticker_count, source)
values
  ('SEEDTEA0', '/assets/guestbook/seed-tea.jpg',
   '2026-08-09T12:00:00Z', '2026-08-10T12:00:00Z', '2026-08-09T12:00:00Z', 'cream', 0, 'instagram'),
  ('SEEDCRSN', '/assets/guestbook/seed-croissant.jpg',
   '2026-08-02T12:00:00Z', '2026-08-03T12:00:00Z', '2026-08-02T12:00:00Z', 'white', 0, 'instagram'),
  ('SEEDMTCH', '/assets/guestbook/seed-matcha.jpg',
   '2026-07-20T12:00:00Z', '2026-07-21T12:00:00Z', '2026-07-20T12:00:00Z', 'green', 0, 'instagram')
on conflict (id) do nothing;
