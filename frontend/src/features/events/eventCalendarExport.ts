import type { IcsEventInput } from "@/lib/icsExport";

export async function exportEventToCalendar(
  exporter: (event: IcsEventInput) => Promise<unknown>,
  event: any,
  shareUrl: string,
): Promise<void> {
  await exporter({
    id: event.id,
    title: event.title,
    type: event.type,
    event_date: event.event_date,
    start_time: event.start_time,
    end_time: event.end_time,
    description: event.description,
    location_name: event.location_name,
    address: event.address,
    suburb: event.suburb,
    state: event.state,
    postcode: event.postcode,
    is_cancelled: event.is_cancelled,
    updated_at: event.updated_at,
    url: shareUrl,
  });
}
