import { useEffect, useState } from "react";

/**
 * Extract a vibrant, accessible accent color from a club logo image.
 *
 * Used by the free-club header branch (where no curated theme palette is
 * stored in the DB) so the club name + chevron pick up the brand's logo
 * colour instead of falling back to plain `text-foreground` (near-black /
 * near-white) — which makes dark-logo'd clubs like "Basket Range Cricket
 * Club" look unbranded.
 *
 * Rules:
 *  - Ignore near-white / near-black / near-grey pixels.
 *  - Pick the most frequent saturated hue bucket.
 *  - Clamp lightness into a vibrant, accessible band per theme:
 *      light theme → L in [38, 50]   (dark enough to read on white bg)
 *      dark  theme → L in [60, 72]   (bright enough to read on dark bg)
 *    This automatically brightens a near-black logo green into a vibrant
 *    branded green for the text/chevron.
 *  - Boost saturation to at least 55% so muted logos still feel branded.
 */

type HSL = { h: number; s: number; l: number };

const cache = new Map<string, HSL | null>();
const inFlight = new Map<string, Promise<HSL | null>>();

function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

async function extract(url: string): Promise<HSL | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        // 12-bucket hue histogram weighted by saturation
        const buckets = new Map<number, { weight: number; s: number; l: number; count: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 200) continue;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const hsl = rgbToHsl(r, g, b);
          // skip near-white / near-black / desaturated
          if (hsl.l > 92 || hsl.l < 8) continue;
          if (hsl.s < 18) continue;
          const bucket = Math.floor(hsl.h / 30); // 12 hue buckets
          const w = hsl.s / 100;
          const prev = buckets.get(bucket);
          if (prev) {
            prev.weight += w;
            prev.s += hsl.s;
            prev.l += hsl.l;
            prev.count += 1;
          } else {
            buckets.set(bucket, { weight: w, s: hsl.s, l: hsl.l, count: 1 });
          }
        }
        if (buckets.size === 0) return resolve(null);
        let bestBucket = -1;
        let bestWeight = -1;
        for (const [k, v] of buckets) {
          if (v.weight > bestWeight) { bestWeight = v.weight; bestBucket = k; }
        }
        const winner = buckets.get(bestBucket)!;
        const h = bestBucket * 30 + 15;
        const s = Math.round(winner.s / winner.count);
        const l = Math.round(winner.l / winner.count);
        resolve({ h, s, l });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function clampForTheme(hsl: HSL, isDark: boolean): HSL {
  const s = Math.max(hsl.s, 55);
  const [minL, maxL] = isDark ? [60, 72] : [38, 50];
  const l = Math.min(Math.max(hsl.l, minL), maxL);
  return { h: hsl.h, s: Math.min(s, 90), l };
}

export function useLogoAccentColor(
  logoUrl: string | null | undefined,
  isDark: boolean
): string | undefined {
  const [hsl, setHsl] = useState<HSL | null>(() => (logoUrl ? cache.get(logoUrl) ?? null : null));

  useEffect(() => {
    if (!logoUrl) { setHsl(null); return; }
    if (cache.has(logoUrl)) { setHsl(cache.get(logoUrl) ?? null); return; }
    let cancelled = false;
    let p = inFlight.get(logoUrl);
    if (!p) {
      p = extract(logoUrl).then((res) => { cache.set(logoUrl, res); inFlight.delete(logoUrl); return res; });
      inFlight.set(logoUrl, p);
    }
    p.then((res) => { if (!cancelled) setHsl(res); });
    return () => { cancelled = true; };
  }, [logoUrl]);

  if (!hsl) return undefined;
  const c = clampForTheme(hsl, isDark);
  return `hsl(${c.h}, ${c.s}%, ${c.l}%)`;
}
