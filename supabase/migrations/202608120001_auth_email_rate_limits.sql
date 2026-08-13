-- Límite propio para el envío SMTP de Magic Links. Solo el backend con la
-- service role puede ejecutar estas funciones; nunca se almacenan correos.
create table if not exists public.auth_email_rate_limits (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  last_sent_at timestamptz not null,
  claim_token uuid not null,
  updated_at timestamptz not null default now()
);

alter table public.auth_email_rate_limits enable row level security;

create or replace function public.claim_magic_link_send(
  p_email_hash text,
  p_cooldown_seconds integer default 60
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  claim_token uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_last_sent_at timestamptz;
  v_claim_token uuid;
  v_retry_after integer;
begin
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid email hash';
  end if;

  if p_cooldown_seconds < 1 or p_cooldown_seconds > 3600 then
    raise exception 'Invalid cooldown';
  end if;

  v_claim_token := gen_random_uuid();
  insert into public.auth_email_rate_limits (
    email_hash,
    last_sent_at,
    claim_token,
    updated_at
  )
  values (p_email_hash, v_now, v_claim_token, v_now)
  on conflict (email_hash) do nothing;

  if found then
    return query select true, 0, v_claim_token;
    return;
  end if;

  select rate_limit.last_sent_at
  into v_last_sent_at
  from public.auth_email_rate_limits as rate_limit
  where rate_limit.email_hash = p_email_hash
  for update;

  v_retry_after := greatest(
    0,
    ceil(extract(epoch from (
      v_last_sent_at + make_interval(secs => p_cooldown_seconds) - v_now
    )))::integer
  );

  if v_retry_after > 0 then
    return query select false, v_retry_after, null::uuid;
    return;
  end if;

  v_claim_token := gen_random_uuid();
  update public.auth_email_rate_limits as rate_limit
  set last_sent_at = v_now,
      claim_token = v_claim_token,
      updated_at = v_now
  where rate_limit.email_hash = p_email_hash;

  return query select true, 0, v_claim_token;
end;
$$;

create or replace function public.release_magic_link_send(
  p_email_hash text,
  p_claim_token uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.auth_email_rate_limits as rate_limit
  where rate_limit.email_hash = p_email_hash
    and rate_limit.claim_token = p_claim_token;
$$;

revoke all on table public.auth_email_rate_limits from public, anon, authenticated;
revoke all on function public.claim_magic_link_send(text, integer) from public, anon, authenticated;
revoke all on function public.release_magic_link_send(text, uuid) from public, anon, authenticated;

grant execute on function public.claim_magic_link_send(text, integer) to service_role;
grant execute on function public.release_magic_link_send(text, uuid) to service_role;

comment on table public.auth_email_rate_limits is
  'Control de frecuencia para Magic Links SMTP; guarda únicamente SHA-256 del correo.';
