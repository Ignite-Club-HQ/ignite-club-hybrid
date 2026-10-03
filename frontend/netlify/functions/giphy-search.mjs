// Same-origin GIF search endpoint (replaces the old giphy-search Supabase
// edge function). Served by Netlify Functions in production and by the Vite
// dev-server middleware (vite.live.config.ts) in the preview. The GIPHY API
// key stays server-side: GIPHY_API_KEY is read from the function/dev-server
// environment and never reaches the browser.

const GIPHY_BASE = "https://api.giphy.com/v1/gifs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  const limit = Math.min(Math.max(Number(body.limit) || 24, 1), 50);

  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    return json({ error: "GIF search is not configured on this deployment" }, 503);
  }

  const endpoint = query.length > 0 ? "search" : "trending";
  const url =
    `${GIPHY_BASE}/${endpoint}?api_key=${encodeURIComponent(apiKey)}` +
    `&limit=${limit}&rating=pg-13` +
    (query.length > 0 ? `&q=${encodeURIComponent(query)}` : "");

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) return json({ error: "GIPHY request failed" }, 502);
    data = await res.json();
  } catch {
    return json({ error: "GIPHY request failed" }, 502);
  }

  const gifs = (data.data ?? [])
    .map((g) => {
      const previewImg = g.images?.fixed_width_small ?? g.images?.fixed_width ?? {};
      const fullImg = g.images?.original ?? {};
      return {
        id: g.id,
        title: g.title ?? "",
        preview: previewImg.url ?? "",
        previewWidth: Number(previewImg.width) || 0,
        previewHeight: Number(previewImg.height) || 0,
        url: fullImg.url ?? "",
        width: Number(fullImg.width) || 0,
        height: Number(fullImg.height) || 0,
      };
    })
    .filter((g) => g.preview && g.url);

  return json({ gifs });
};
