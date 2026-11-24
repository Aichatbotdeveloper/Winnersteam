-- =============================================================================
-- WINNERS TEAM — 0020 Fine payments to the administrator (trial feature)
-- Administrators add their bank details; a member with a fine pays by transfer,
-- taps "I've paid" with a receipt, and their administrator confirms. Nothing is
-- ever taken automatically. Switch it off with the setting fines.payments_enabled.
-- =============================================================================

insert into public.system_settings (key, value, description) values
  ('fines.payments_enabled', 'true', 'Members can pay financial fines to their administrator''s account and the administrator confirms')
on conflict (key) do nothing;

create or replace function private.fine_payments_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select value = 'true'::jsonb from public.system_settings where key = 'fines.payments_enabled'), false);
$$;

create table public.admin_payment_details (
  admin_id       uuid primary key references public.profiles (id),
  account_name   text not null check (char_length(btrim(account_name)) between 2 and 120),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  bank_name      text not null check (char_length(btrim(bank_name)) between 2 and 80),
  updated_at     timestamptz not null default now()
);
alter table public.admin_payment_details enable row level security;
-- The administrator, the Super Admin, and the members currently assigned to that administrator.
create policy admin_payment_details_read on public.admin_payment_details for select to authenticated
  using (admin_id = (select auth.uid()) or (select private.is_super_admin())
         or admin_id = (select private.current_admin_of((select auth.uid()))));
revoke all on public.admin_payment_details from anon, authenticated;
grant select on public.admin_payment_details to authenticated;
grant all on public.admin_payment_details to service_role;

create table public.fine_payments (
  ledger_id      uuid primary key references public.accountability_ledger (id),
  user_id        uuid not null references public.profiles (id),
  payee_id       uuid not null references public.profiles (id),
  amount         numeric(10, 2) not null,
  payee_snapshot jsonb not null,           -- the account details shown when they paid
  receipt_path   text not null,
  note           text check (note is null or char_length(note) <= 500),
  status         text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected')),
  reason         text check (reason is null or char_length(reason) <= 500),
  submitted_at   timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid references public.profiles (id)
);
create index fine_payments_payee_idx on public.fine_payments (payee_id, status);
alter table public.fine_payments enable row level security;
create policy fine_payments_read on public.fine_payments for select to authenticated
  using (user_id = (select auth.uid()) or payee_id = (select auth.uid()) or (select private.is_super_admin())
         or private.is_assigned_admin_of(user_id));
revoke all on public.fine_payments from anon, authenticated;
grant select on public.fine_payments to authenticated;
grant all on public.fine_payments to service_role;

-- Receipts: private files under "<member id>/…", visible to the member, their administrator and the Super Admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('fine-receipts', 'fine-receipts', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy fine_receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'fine-receipts' and (private.storage_owner(name) = (select auth.uid())
         or private.is_super_admin() or private.is_assigned_admin_of(private.storage_owner(name))));
create policy fine_receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fine-receipts' and private.storage_owner(name) = (select auth.uid()));

-- -----------------------------------------------------------------------------
create or replace function public.set_payment_details(p_account_name text, p_account_number text, p_bank_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old jsonb;
begin
  perform private.require(private.is_administrator() and private.is_active_user(), 'Only administrators add payment details');
  perform private.require(char_length(btrim(coalesce(p_account_name, ''))) between 2 and 120, 'Enter the account name');
  perform private.require(coalesce(p_account_number, '') ~ '^[0-9]{10}$', 'The account number must be 10 digits');
  perform private.require(char_length(btrim(coalesce(p_bank_name, ''))) between 2 and 80, 'Enter the bank (for example OPay)');
  select to_jsonb(d) into v_old from public.admin_payment_details d where admin_id = (select auth.uid());
  insert into public.admin_payment_details (admin_id, account_name, account_number, bank_name)
  values ((select auth.uid()), btrim(p_account_name), p_account_number, btrim(p_bank_name))
  on conflict (admin_id) do update set account_name = excluded.account_name, account_number = excluded.account_number,
    bank_name = excluded.bank_name, updated_at = now();
  perform private.audit('fines.payment_details_saved', 'admin_payment_details', (select auth.uid())::text, (select auth.uid()), v_old,
    jsonb_build_object('account_name', btrim(p_account_name), 'account_number', p_account_number, 'bank_name', btrim(p_bank_name)));
end $$;

-- Member: "I've paid" (with a receipt). Can be sent again after "Not received".
create or replace function public.submit_fine_payment(p_ledger uuid, p_receipt_path text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.accountability_ledger; v_admin uuid; d public.admin_payment_details; v_prev text; v_name text;
begin
  perform private.require(private.fine_payments_enabled(), 'Fine payments are switched off');
  select * into l from public.accountability_ledger where id = p_ledger for update;
  perform private.require(found and l.user_id = (select auth.uid()) and private.is_active_user(), 'Fine not found');
  perform private.require(l.category = 'financial_fine', 'Only financial fines are paid');
  perform private.require(l.status <> 'completed', 'This fine is already settled');
  v_admin := private.current_admin_of(l.user_id);
  select * into d from public.admin_payment_details where admin_id = v_admin;
  perform private.require(v_admin is not null and d.admin_id is not null, 'Your administrator has not added payment details yet');
  perform private.require(p_receipt_path like l.user_id::text || '/%', 'Upload your payment receipt');
  perform private.require(p_note is null or char_length(p_note) <= 500, 'The note is too long');
  select status into v_prev from public.fine_payments where ledger_id = p_ledger;
  perform private.require(v_prev is distinct from 'confirmed', 'This payment has already been confirmed');
  perform private.require(v_prev is distinct from 'submitted', 'You have already sent this payment — your administrator will confirm it');

  insert into public.fine_payments (ledger_id, user_id, payee_id, amount, payee_snapshot, receipt_path, note)
  values (p_ledger, l.user_id, v_admin, l.quantity,
          jsonb_build_object('account_name', d.account_name, 'account_number', d.account_number, 'bank_name', d.bank_name),
          p_receipt_path, nullif(btrim(p_note), ''))
  on conflict (ledger_id) do update set payee_id = excluded.payee_id, amount = excluded.amount, payee_snapshot = excluded.payee_snapshot,
    receipt_path = excluded.receipt_path, note = excluded.note, status = 'submitted', reason = null,
    submitted_at = now(), decided_at = null, decided_by = null;
  update public.accountability_ledger set status = 'in_progress', updated_at = now() where id = p_ledger;

  select full_name into v_name from public.profiles where id = l.user_id;
  perform private.audit('fines.payment_submitted', 'accountability_ledger', p_ledger::text, l.user_id, null,
    jsonb_build_object('amount', l.quantity, 'payee', v_admin, 'bank', d.bank_name));
  perform private.notify(v_admin, 'accountability', 'fine.payment_submitted',
    v_name || ' says they paid a ₦' || to_char(l.quantity, 'FM999,999') || ' fine',
    'Check your ' || d.bank_name || ' account, then confirm on the Accountability page.',
    '/accountability?status=in_progress', jsonb_build_object('ledger_id', p_ledger), 'fine-paid:' || p_ledger || ':' || extract(epoch from now())::bigint);
end $$;

-- Administrator (the payee) or the Super Admin: confirm, or say it was not received.
create or replace function public.decide_fine_payment(p_ledger uuid, p_received boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.fine_payments; v_by text;
begin
  select * into f from public.fine_payments where ledger_id = p_ledger for update;
  perform private.require(found and f.status = 'submitted', 'There is no payment waiting for confirmation');
  perform private.require(private.is_active_user() and (f.payee_id = (select auth.uid()) or private.is_super_admin()),
    'Only the administrator who received the payment can confirm it');
  select full_name into v_by from public.profiles where id = (select auth.uid());
  if p_received then
    update public.fine_payments set status = 'confirmed', decided_at = now(), decided_by = (select auth.uid()) where ledger_id = p_ledger;
    update public.accountability_ledger set status = 'completed', completed_at = coalesce(completed_at, now()),
           completion_note = 'Fine paid — confirmed by ' || v_by, updated_at = now() where id = p_ledger;
    perform private.notify(f.user_id, 'accountability', 'fine.payment_confirmed',
      'Your ₦' || to_char(f.amount, 'FM999,999') || ' fine payment was confirmed', 'Thank you. This fine is now settled.',
      '/accountability', jsonb_build_object('ledger_id', p_ledger), 'fine-confirmed:' || p_ledger);
  else
    perform private.require(char_length(btrim(coalesce(p_reason, ''))) between 3 and 500, 'Say briefly why (for example: not received yet)');
    update public.fine_payments set status = 'rejected', reason = btrim(p_reason), decided_at = now(), decided_by = (select auth.uid()) where ledger_id = p_ledger;
    update public.accountability_ledger set status = 'assigned', updated_at = now() where id = p_ledger;
    perform private.notify(f.user_id, 'accountability', 'fine.payment_not_received',
      'Your ₦' || to_char(f.amount, 'FM999,999') || ' fine payment could not be confirmed', btrim(p_reason) || ' Please check and send it again.',
      '/accountability', jsonb_build_object('ledger_id', p_ledger), 'fine-rejected:' || p_ledger || ':' || extract(epoch from now())::bigint);
  end if;
  perform private.audit(case when p_received then 'fines.payment_confirmed' else 'fines.payment_not_received' end,
    'accountability_ledger', p_ledger::text, f.user_id, null, jsonb_build_object('amount', f.amount, 'reason', p_reason));
end $$;

-- While payments are on, a member settles a fine through "I've paid" (not by ticking Completed themselves).
create or replace function public.update_ledger_status(p_ledger uuid, p_status public.ledger_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_l public.accountability_ledger;
begin
  select * into v_l from public.accountability_ledger where id = p_ledger for update;
  perform private.require(found and (private.is_owner_active(v_l.user_id) or private.is_super_admin() or private.is_assigned_admin_of(v_l.user_id)),
    'Not authorised to update this accountability record');
  perform private.require(p_note is null or char_length(p_note) <= 1000, 'Note is too long');
  perform private.require(not (v_l.category = 'financial_fine' and p_status = 'completed' and private.fine_payments_enabled()
      and v_l.user_id = (select auth.uid())),
    'Pay the fine and press "I''ve paid" — your administrator will confirm it');
  update public.accountability_ledger set status = p_status, completion_note = coalesce(p_note, completion_note),
         completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else null end,
         updated_at = now()
   where id = p_ledger;
  perform private.audit(case when p_status = 'completed' then 'accountability.completed' else 'accountability.status_changed' end,
    'accountability_ledger', p_ledger::text, v_l.user_id, jsonb_build_object('status', v_l.status),
    jsonb_build_object('status', p_status, 'note', p_note));
end $$;

revoke execute on all functions in schema public from anon, public;
grant execute on function public.set_payment_details(text, text, text), public.submit_fine_payment(uuid, text, text),
  public.decide_fine_payment(uuid, boolean, text), public.update_ledger_status(uuid, public.ledger_status, text) to authenticated;
