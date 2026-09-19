import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_HOSTS = [
  "cdn.arstechnica.net",
  "arstechnica.com",
  "cryptoslate.com",
  "assets.science.nasa.gov",
  "nasa.gov",
  "science.nasa.gov",
  "techcrunch.com",
  "cdn.techcrunch.com",
  "theverge.com",
  "wired.com",
  "technologyreview.com",
  "openai.com",
  "esa.int",
  "coindesk.com",
  "cointelegraph.com",
  "theblock.co",
  "decrypt.co",
  "bitcoinmagazine.com",
  "engadget.com",
  "sciencedaily.com",
  "gstatic.com",
  "googleusercontent.com",
  "google.com"
];

function allowed(hostname: string) {
  const h = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((d) => h === d || h.endsWith("." + d));
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=86400, s-maxage=86400",
  "Vary": "Origin",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {
    const requestUrl = new URL(req.url);
    const raw = requestUrl.searchParams.get("url");
    if (!raw) return new Response("Missing url", { status: 400, headers: cors });

    const target = new URL(raw);
    if (target.protocol !== "https:") {
      return new Response("HTTPS required", { status: 400, headers: cors });
    }
    if (!allowed(target.hostname)) {
      return new Response("Host not allowed", { status: 403, headers: cors });
    }

    const upstream = await fetch(target.href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NEXUS Image Proxy/1.0)",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": target.origin + "/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) {
      return new Response("Upstream image unavailable", { status: 502, headers: cors });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return new Response("Upstream is not an image", { status: 415, headers: cors });
    }

    const headers = new Headers(cors);
    headers.set("Content-Type", contentType);
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);

    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return new Response("Image proxy error", { status: 502, headers: cors });
  }
});
