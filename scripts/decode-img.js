#!/usr/bin/env node

const input = process.argv[2];

if (!input) {
  console.error("Usage: node decode-img.js <url1,url2,...>");
  process.exit(1);
}

input.split(",").forEach((raw) => {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const param = url.searchParams.get("url");
    if (param) {
      console.log(param);
      return;
    }
  } catch {}

  // Fallback: manual extraction for shell-escaped URLs
  const match = trimmed.match(/[?&\\]url[=\\]([^&\\]+)/);
  if (match) {
    console.log(decodeURIComponent(match[1]));
    return;
  }

  console.error(`Could not extract url param from: ${trimmed}`);
});