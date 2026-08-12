-- Versionado de publicaciones: conserva revisiones anteriores sin mezclarlas
-- con las piezas vigentes de un paquete.
alter type public.publication_status add value if not exists 'obsolete';

alter table public.publications
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists is_current boolean not null default true,
  add column if not exists supersedes_id uuid references public.publications(id) on delete set null,
  add column if not exists superseded_at timestamptz;

create index if not exists publications_batch_current_idx
  on public.publications(batch_id, is_current, created_at);

alter table public.music_tracks
  add column if not exists source text not null default 'uploaded'
    check (source in ('uploaded', 'ai_generated')),
  add column if not exists ai_provider text,
  add column if not exists validation_status text not null default 'pending'
    check (validation_status in ('pending', 'verified', 'invalid')),
  add column if not exists mime_type text;

-- La pista inicial era solo un marcador y no existe en Storage por defecto.
update public.music_tracks
set active = false,
    validation_status = 'invalid',
    license_notes = 'Pista de ejemplo deshabilitada: sube un archivo real y con licencia.'
where id = '00000000-0000-0000-0000-000000000001'
  and storage_path = 'system/inspirational-piano.mp3';
