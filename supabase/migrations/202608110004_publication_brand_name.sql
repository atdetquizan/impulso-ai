alter table public.publication_batches
  add column if not exists brand_name text not null default 'IMPULSO IA'
  check (char_length(brand_name) between 1 and 32);

alter table public.publications
  add column if not exists brand_name text not null default 'IMPULSO IA'
  check (char_length(brand_name) between 1 and 32);
