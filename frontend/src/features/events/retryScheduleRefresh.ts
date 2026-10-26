/** Membership refresh can replace the event query key; never run them together. */
export async function retryScheduleRefresh(refreshMemberships: () => Promise<unknown>, refreshEvents: () => Promise<unknown>) {
  await refreshMemberships();
  await refreshEvents();
}