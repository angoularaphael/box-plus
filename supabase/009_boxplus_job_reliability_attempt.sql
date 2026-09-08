-- Hotfix : `attempt` ambigu dans boxplus_acquire_job_action (RETURNS TABLE).
-- Réapplique les fonctions de 008 déjà déployé. Sans mutation des commandes.

create or replace function public.boxplus_acquire_job_action(
  p_order_id text,
  p_action text,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table (
  acquired boolean,
  reason text,
  status text,
  attempt integer,
  lifecycle_state text,
  member_id text,
  sale_id text,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.boxplus_job_actions%rowtype;
begin
  if coalesce(trim(p_order_id), '') = '' or coalesce(trim(p_action), '') = '' then
    raise exception 'order_id and action are required';
  end if;

  insert into public.boxplus_job_actions (
    order_id, action, status, attempt, worker_id, lease_expires_at
  ) values (
    p_order_id, p_action, 'processing', 1, p_worker_id,
    now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600)))
  )
  on conflict (order_id, action) do nothing;

  select * into current_row
  from public.boxplus_job_actions
  where boxplus_job_actions.order_id = p_order_id
    and boxplus_job_actions.action = p_action
  for update;

  if current_row.status = 'completed' then
    return query select false, 'completed', current_row.status, current_row.attempt,
      current_row.lifecycle_state, current_row.member_id, current_row.sale_id,
      current_row.lease_expires_at;
    return;
  end if;

  if current_row.status = 'processing'
    and current_row.worker_id is distinct from p_worker_id
    and current_row.lease_expires_at > now() then
    return query select false, 'leased', current_row.status, current_row.attempt,
      current_row.lifecycle_state, current_row.member_id, current_row.sale_id,
      current_row.lease_expires_at;
    return;
  end if;

  -- RETURNS TABLE expose `attempt` comme variable PL/pgSQL : qualifier la colonne.
  update public.boxplus_job_actions as j
  set status = 'processing',
      attempt = case
        when j.worker_id is distinct from p_worker_id then j.attempt + 1
        else j.attempt
      end,
      worker_id = p_worker_id,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600))),
      updated_at = now()
  where j.order_id = p_order_id
    and j.action = p_action
  returning * into current_row;

  return query select true, 'acquired', current_row.status, current_row.attempt,
    current_row.lifecycle_state, current_row.member_id, current_row.sale_id,
    current_row.lease_expires_at;
end;
$$;

revoke all on function public.boxplus_acquire_job_action(text, text, text, integer) from public;
grant execute on function public.boxplus_acquire_job_action(text, text, text, integer) to service_role;

create or replace function public.boxplus_checkpoint_job_action(
  p_order_id text,
  p_action text,
  p_worker_id text,
  p_status text,
  p_lifecycle_state text default null,
  p_attempt integer default 1,
  p_error_classification text default null,
  p_error_message text default null,
  p_human_action text default null,
  p_member_id text default null,
  p_sale_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_lease_seconds integer default 300
)
returns public.boxplus_job_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.boxplus_job_actions%rowtype;
begin
  if p_status not in ('processing', 'completed', 'failed', 'manual_review') then
    raise exception 'invalid status';
  end if;

  update public.boxplus_job_actions as j
  set status = p_status,
      lifecycle_state = coalesce(p_lifecycle_state, j.lifecycle_state),
      attempt = greatest(j.attempt, p_attempt),
      error_classification = p_error_classification,
      error_message = left(p_error_message, 1000),
      human_action = left(p_human_action, 500),
      member_id = coalesce(p_member_id, j.member_id),
      sale_id = coalesce(p_sale_id, j.sale_id),
      metadata = coalesce(j.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      lease_expires_at = case
        when p_status = 'processing'
          then now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600)))
        else null
      end,
      completed_at = case when p_status = 'completed' then now() else j.completed_at end,
      updated_at = now()
  where j.order_id = p_order_id
    and j.action = p_action
    and j.worker_id = p_worker_id
  returning * into result;

  if not found then
    raise exception 'lease ownership lost for %/%', p_order_id, p_action;
  end if;
  return result;
end;
$$;

revoke all on function public.boxplus_checkpoint_job_action(
  text, text, text, text, text, integer, text, text, text, text, text, jsonb, integer
) from public;
grant execute on function public.boxplus_checkpoint_job_action(
  text, text, text, text, text, integer, text, text, text, text, text, jsonb, integer
) to service_role;
