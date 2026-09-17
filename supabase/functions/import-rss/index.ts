import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;
const admin = createClient(supabaseUrl, serviceKey);

const decode = (v: string) => v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/gi, "'");
const clean = (v: string) => decode(v).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tag = (x: string, n: string) => { const m = x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`, "i")); return m ? decode(m[1]) : ""; };
const attr = (x: string, t: string, a: string) => { const m = x.match(new RegExp(`<${t}\\b[^>]*\\b${a}\\s*=\\s*["']([^"']+)["'][^>]*>`, "i")); return m ? decode(m[1]) : ""; };
const abs = (v: string, b: string) => { try { return new URL(v, b).href; } catch { return v; } };

function rssImage(x: string, base: string) {
  let v = attr(x, "media:content", "url") || attr(x, "media:thumbnail", "url");
  if (v) return abs(v, base);
  v = attr(x, "enclosure", "url");
  if (v) { const t = attr(x, "enclosure", "type"); if (!t || t.startsWith("image/")) return abs(v, base); }
  const b = x.match(/<image\b[^>]*>([\s\S]*?)<\/image>/i);
  if (b && (v = tag(b[1], "url"))) return abs(v, base);
  const m = x.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? abs(decode(m[1]), base) : null;
}

function items(x: string, base: string) {
  return x.split(/<item\b|<entry\b/i).slice(1).map(c => {
    const link = tag(c, "link") || attr(c, "link", "href");
    return {
      title: clean(tag(c, "title")),
      link: abs(clean(link), base),
      description: clean(tag(c, "description") || tag(c, "summary") || tag(c, "content") || tag(c, "content:encoded")),
      guid: clean(tag(c, "guid") || tag(c, "id")),
      pub: clean(tag(c, "pubDate") || tag(c, "published") || tag(c, "updated") || tag(c, "dc:date")),
      image: rssImage(c, base),
    };
  }).filter(i => i.title && i.link);
}

function pageImage(html: string, base: string) {
  const meta = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const r of meta) { const m = html.match(r); if (m?.[1]) return abs(decode(m[1]), base); }
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const stack: any[] = [JSON.parse(m[1])];
      while (stack.length) {
        const o = stack.pop(); if (!o) continue;
        if (Array.isArray(o)) { stack.push(...o); continue; }
        if (typeof o === "object") {
          if (o.image) { const im = o.image; if (typeof im === "string") return abs(im, base); if (Array.isArray(im) && im[0]) return abs(String(im[0]), base); if (im.url) return abs(im.url, base); }
          for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  }
  return null;
}

async function fallbackImages(list: any[], limit = 10) {
  let checked = 0, found = 0;
  for (const item of list) {
    if (item.image || checked >= limit) continue;
    checked++;
    try {
      const r = await fetch(item.link, { headers: { "user-agent": "NEXUS NewsBot/1.1" }, signal: AbortSignal.timeout(5000) });
      if (r.ok) { const image = pageImage(await r.text(), item.link); if (image) { item.image = image; found++; } }
    } catch { /* source page may block bots/time out */ }
  }
  return { checked, found };
}

const category = (v: string) => { const s = v.toLowerCase(); if (/crypto|bitcoin|ethereum|blockchain|token|defi|web3/.test(s)) return "crypto"; if (/ai|artificial intelligence|machine learning|openai|robot|chatgpt/.test(s)) return "ai"; if (/space|nasa|moon|mars|rocket|satellite|astronomy/.test(s)) return "space"; if (/internet|social media|tiktok|reddit|web|facebook|instagram/.test(s)) return "internet"; if (/quantum|chip|iphone|software|technology|tech|computer|apple|google|microsoft/.test(s)) return "technology"; if (/mystery|strange|odd|bizarre|unusual|weird|mysterious/.test(s)) return "strange"; return "weird"; };
const summary = (v: string) => { const t = clean(v); return t.length <= 260 ? t : `${t.slice(0, 257)}...`; };
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 120);
const safeDate = (v: string) => { const d = new Date(v || ""); return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); };

Deno.serve(async (req: Request) => {
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (!profile || !["admin", "editor"].includes(profile.role)) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });

    const body = await req.json().catch(() => ({}));
    if (!body.source_id) return new Response(JSON.stringify({ error: "source_id is required" }), { status: 400 });
    const { data: source, error: sourceError } = await admin.from("rss_sources").select("*").eq("id", body.source_id).single();
    if (sourceError || !source) return new Response(JSON.stringify({ error: "Source not found" }), { status: 404 });

    const response = await fetch(source.url, { headers: { "user-agent": "NEXUS NewsBot/1.1", "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
    if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
    const parsed = items(await response.text(), source.url).slice(0, 50);
    const fallback = await fallbackImages(parsed, 10);
    const { data: categories } = await admin.from("categories").select("id,slug");
    const categoryMap = new Map((categories || []).map((c: any) => [c.slug, c.id]));
    let added = 0, published = 0, skipped = 0, errors = 0, images = 0;

    for (const item of parsed) {
      const externalId = item.guid || item.link;
      const { data: existing } = await admin.from("import_items").select("id").eq("source_id", source.id).eq("external_id", externalId).maybeSingle();
      if (existing) { skipped++; continue; }
      const cat = category(item.title), excerpt = summary(item.description), shouldPublish = Boolean(source.auto_publish);
      const { data: news, error: newsError } = await admin.from("news").insert({ title: item.title, slug: `${slug(item.title) || "news"}-${crypto.randomUUID().slice(0, 6)}`, excerpt, content: excerpt, image_url: item.image || null, category_id: categoryMap.get(cat) || null, tags: [cat], source_name: source.name, source_url: item.link, status: shouldPublish ? "published" : "draft", published_at: shouldPublish ? safeDate(item.pub) : null, seo_title: item.title.slice(0, 150), seo_description: excerpt }).select("id").single();
      if (newsError) { errors++; await admin.from("import_items").insert({ source_id: source.id, external_id: externalId, source_url: item.link, title: item.title, status: "error", raw: item, error: newsError.message }); continue; }
      await admin.from("import_items").insert({ source_id: source.id, external_id: externalId, source_url: item.link, title: item.title, status: shouldPublish ? "published" : "queued", raw: item, news_id: news.id });
      added++; if (shouldPublish) published++; if (item.image) images++;
    }
    await admin.from("rss_sources").update({ last_run_at: new Date().toISOString(), last_error: null }).eq("id", source.id);
    return new Response(JSON.stringify({ ok: true, source: source.name, found: parsed.length, added, published, skipped, errors, images, fallback_checked: fallback.checked, fallback_found: fallback.found }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
