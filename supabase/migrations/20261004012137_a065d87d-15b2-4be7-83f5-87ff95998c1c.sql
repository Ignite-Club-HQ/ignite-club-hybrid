drop policy "Authenticated users can read photo views" on public.photo_views;
create policy "Users can read own photo views"
on public.photo_views
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.has_role((select auth.uid()), 'app_admin'::public.app_role, null::uuid, null::uuid)
  or exists (
    select 1
    from public.photos p
    where p.id = photo_views.photo_id
      and public.has_role((select auth.uid()), 'club_admin'::public.app_role, p.club_id, null::uuid)
  )
);

drop policy "Authenticated users can read club DM settings" on public.club_dm_settings;
create policy "Club members can read their club DM settings"
on public.club_dm_settings
for select
to authenticated
using (
  public.is_club_member((select auth.uid()), club_id)
  or public.has_role((select auth.uid()), 'app_admin'::public.app_role, null::uuid, null::uuid)
);