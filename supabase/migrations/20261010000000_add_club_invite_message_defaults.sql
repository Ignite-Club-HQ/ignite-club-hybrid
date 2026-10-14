create table if not exists public.club_invite_message_defaults (
  club_id uuid primary key references public.clubs (id) on delete cascade,
  message text not null
);

alter table public.club_invite_message_defaults enable row level security;

create policy "club members can view invite message default"
  on public.club_invite_message_defaults
  for select
  using (
    exists (
      select 1
      from public.user_roles ur
      where ur.club_id = club_invite_message_defaults.club_id
        and ur.user_id = auth.uid()
    )
  );

create policy "club admins can upsert invite message default"
  on public.club_invite_message_defaults
  for insert with check (
    exists (
      select 1
      from public.user_roles ur
      where ur.club_id = club_invite_message_defaults.club_id
        and ur.user_id = auth.uid()
        and ur.role = 'club_admin'
    )
  );

create policy "club admins can update invite message default"
  on public.club_invite_message_defaults
  for update
  using (
    exists (
      select 1
      from public.user_roles ur
      where ur.club_id = club_invite_message_defaults.club_id
        and ur.user_id = auth.uid()
        and ur.role = 'club_admin'
    )
  )
  with check (
    exists (
      select 1
      from public.user_roles ur
      where ur.club_id = club_invite_message_defaults.club_id
        and ur.user_id = auth.uid()
        and ur.role = 'club_admin'
    )
  );

create policy "club admins can delete invite message default"
  on public.club_invite_message_defaults
  for delete
  using (
    exists (
      select 1
      from public.user_roles ur
      where ur.club_id = club_invite_message_defaults.club_id
        and ur.user_id = auth.uid()
        and ur.role = 'club_admin'
    )
  );