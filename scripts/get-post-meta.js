#!/usr/bin/env node

const url = process.argv[2];

if (!url) {
  console.error("Usage: node get-post-meta.js <post-url>");
  process.exit(1);
}

const res = await fetch(url, {
  headers: {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept": "text/html",
  },
});

if (!res.ok) {
  console.error(`Failed to fetch: ${res.status}`);
  process.exit(1);
}

const html = await res.text();

const get = (attr, value) => {
  const match = html.match(new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]+content=["']([^"']+)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${value}["']`, "i"));
  return match?.[1] ?? "";
};

const title = get("property", "og:title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
const description = get("property", "og:description") || get("name", "description") || "";
const image = get("property", "og:image") || "";

const slug = new URL(url).pathname.replace(/^\//, "").replace(/\/$/, "");

console.log(JSON.stringify({
  [slug]: { title: title.trim(), description: description.trim(), image: image.trim() }
}, null, 2));