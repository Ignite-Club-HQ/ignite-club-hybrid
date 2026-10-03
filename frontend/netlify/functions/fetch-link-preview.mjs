// Same-origin link-preview endpoint (replaces the old fetch-link-preview
// Supabase edge function). Served by Netlify Functions in production and by
// the Vite dev-server middleware (vite.live.config.ts) in the preview.
// Fetches the page server-side (browsers can't, due to CORS) and returns its
// Open Graph / Twitter Card metadata.

const MAX_HTML_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Basic SSRF guard: refuse loopback, link-local and private-range hosts.
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "::1" ||
    /^0\./.test(h) ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)
  );
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x0?27;/gi, "'")
    .replace(/&nbsp;/g, " ");
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : undefined;
}

function parseMetadata(html, pageUrl) {
  const metaTags = html.match(/<meta\s[^>]*>/gi) ?? [];
  const findMeta = (...names) => {
    for (const tag of metaTags) {
      const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
      if (names.includes(key)) {
        const content = attr(tag, "content");
        if (content && content.trim()) return decodeEntities(content.trim());
      }
    }
    return undefined;
  };

  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];

  const rawImage = findMeta("og:image", "og:image:url", "twitter:image", "twitter:image:src");
  let image;
  if (rawImage) {
    try {
      image = new URL(rawImage, pageUrl).toString();
    } catch {
      image = undefined;
    }
  }

  return {
    title: findMeta("og:title", "twitter:title") ?? (titleTag ? decodeEntities(titleTag.trim()) : undefined),
    description: findMeta("og:description", "twitter:description", "description"),
    image,
    siteName: findMeta("og:site_name", "application-name"),
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return json({ error: "Invalid URL" }, 400);
  }
  if (!/^https?:$/.test(parsed.protocol) || isBlockedHost(parsed.hostname)) {
    return json({ error: "URL not allowed" }, 400);
  }

  // Any failure (network, timeout, non-HTML) degrades to a bare URL card —
  // the chat UI renders a simple host card for that shape.
  const fallback = () => json({ url });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; IgniteLinkPreview/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("text/html")) return fallback();

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (received >= MAX_HTML_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks));

    return json({ url, ...parseMetadata(html, res.url || url) });
  } catch {
    return fallback();
  } finally {
    clearTimeout(timer);
  }
};
