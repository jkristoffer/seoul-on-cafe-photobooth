-- The guest book: photos a guest explicitly asked us to keep.
--
-- A photo's default life is 24 hours. Consent is the only thing that overrides
-- that, and it is always the guest's own act — from the kiosk right after the
-- print, or from the QR page afterwards. It is reversible from the QR page for
-- as long as the entry is up, which is the reason a consented photo's download
-- link outlives the 24-hour window: withdrawal needs a door to knock on.
--
-- Nothing here is a new table. An entry *is* a photo row with consent on it, so
-- there is no second place a photo can exist and no join to keep honest.

alter table public.photos
  -- When the guest agreed. Null means the photo is private and expires normally,
  -- so this single column drives the purge, the download link and the feed.
  add column if not exists consented_at timestamptz,
  -- Optional, always written from the guest's own phone — the kiosk has no text
  -- entry — and always after consent, so an entry can gain a caption minutes
  -- after it went up.
  add column if not exists message      text,
  add column if not exists message_at   timestamptz,
  -- Staff takedown. Separate from consent so pulling an entry does not read as
  -- the guest having changed their mind, and so it survives a re-consent.
  add column if not exists hidden_at    timestamptz;

-- The feed reads newest-first over the small consented subset. A partial index
-- keeps it proportional to the guest book rather than to every session ever run.
create index if not exists photos_guestbook_idx
  on public.photos (consented_at desc)
  where consented_at is not null and hidden_at is null and purged_at is null;

comment on column public.photos.consented_at is
  'Guest asked for this photo to be kept and shown. Exempts the row from the 24h purge.';
comment on column public.photos.hidden_at is
  'Staff takedown, independent of the guest''s consent.';
