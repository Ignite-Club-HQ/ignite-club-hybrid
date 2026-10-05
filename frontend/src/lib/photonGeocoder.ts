// Keyless address search for Internet Identity (ICP) users. The Google
// Places Edge Function needs a Supabase session, which II users don't have,
// and the app has no server of its own. Photon (OpenStreetMap, by komoot) is
// built for search-as-you-type and allows browser (CORS) calls.

const PHOTON = "https://photon.komoot.io";

export interface PhotonPlace {
  place_id: string;
  description: string;
  main_text: string;
  secondary_text: string;
  name: string;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
}

interface PhotonFeature {
  properties: Record<string, string | number | undefined>;
  geometry?: { coordinates?: [number, number] };
}

function toPlace(f: PhotonFeature, i: number): PhotonPlace {
  const p = f.properties;
  const s = (k: string) => (p[k] == null ? "" : String(p[k]));
  const street = [s("housenumber"), s("street")].filter(Boolean).join(" ");
  const name = s("name");
  const suburb = s("district") || s("locality") || s("city") || s("county");
  const main = name && name !== street ? name : street || name || suburb;
  const secondaryParts = [name && name !== street ? street : "", suburb, s("state"), s("postcode"), s("country")]
    .filter(Boolean)
    .filter((v, idx, arr) => arr.indexOf(v) === idx && v !== main);
  return {
    place_id: `${s("osm_type")}${s("osm_id")}` || `photon-${i}`,
    description: [main, ...secondaryParts].join(", "),
    main_text: main,
    secondary_text: secondaryParts.join(", "),
    name,
    street,
    suburb,
    state: s("state"),
    postcode: s("postcode"),
  };
}

// OSM spells street types out in full; "35 Driffield rd" only matches as
// "35 Driffield Road".
const ABBREVIATIONS: Record<string, string> = {
  rd: "Road", st: "Street", ave: "Avenue", av: "Avenue", dr: "Drive", ct: "Court",
  cres: "Crescent", cr: "Crescent", pl: "Place", tce: "Terrace", hwy: "Highway",
  pde: "Parade", ln: "Lane", bvd: "Boulevard", blvd: "Boulevard", cl: "Close", gr: "Grove",
};
export function expandAddressQuery(q: string): string {
  return q
    .split(/\s+/)
    .map((w) => ABBREVIATIONS[w.toLowerCase().replace(/\.$/, "")] ?? w)
    .join(" ");
}

// Rough home-region centres from the device time zone, used when we don't
// have a GPS fix. Results inside this region are tried first.
const TZ_CENTRES: Record<string, [number, number]> = {
  "Australia/Adelaide": [-34.93, 138.6], "Australia/Darwin": [-12.46, 130.84],
  "Australia/Perth": [-31.95, 115.86], "Australia/Brisbane": [-27.47, 153.03],
  "Australia/Sydney": [-33.87, 151.21], "Australia/Melbourne": [-37.81, 144.96],
  "Australia/Hobart": [-42.88, 147.33], "Australia/Canberra": [-35.28, 149.13],
  "Pacific/Auckland": [-36.85, 174.76], "Europe/London": [52.5, -1.5],
};
function regionCentre(bias?: { lat: number; lng: number }): [number, number] | null {
  if (bias) return [bias.lat, bias.lng];
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TZ_CENTRES[tz] ?? null;
  } catch {
    return null;
  }
}

async function search(q: string, extra: Record<string, string>, signal?: AbortSignal) {
  const params = new URLSearchParams({ q, limit: "6", lang: "en", ...extra });
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`Address search failed (${res.status})`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  // Transit stops are tagged as streets and crowd out real addresses.
  return (json.features ?? []).filter(
    (f) => !["bus_stop", "platform", "stop_position", "stop"].includes(String(f.properties.osm_value ?? "")),
  );
}

export async function photonAutocomplete(
  query: string,
  bias?: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<PhotonPlace[]> {
  const q = expandAddressQuery(query.trim());
  const houseNumber = /^(\d+[a-z]?)\s/i.exec(q)?.[1] ?? "";
  const centre = regionCentre(bias);
  let features: PhotonFeature[] = [];
  if (centre) {
    const [lat, lng] = centre;
    const d = 6;
    features = await search(q, { bbox: `${lng - d},${lat - d},${lng + d},${lat + d}`, lat: String(lat), lon: String(lng) }, signal);
  }
  if (features.length === 0) features = await search(q, {}, signal);
  return features.map((f, i) => {
    const place = toPlace(f, i);
    // A plain street match drops the typed house number — keep it.
    const p = f.properties;
    if (houseNumber && !p.housenumber && (p.osm_key === "highway") && place.name) {
      const street = `${houseNumber} ${place.name}`;
      return { ...place, name: "", street, main_text: street, description: [street, place.secondary_text].filter(Boolean).join(", ") };
    }
    return place;
  });
}

export async function photonReverse(lat: number, lng: number): Promise<PhotonPlace | null> {
  const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&lang=en`);
  if (!res.ok) throw new Error(`Reverse lookup failed (${res.status})`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const f = json.features?.[0];
  return f ? toPlace(f, 0) : null;
}
