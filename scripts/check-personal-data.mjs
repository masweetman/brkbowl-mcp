#!/usr/bin/env node
// Rejects files that look like they contain personal data or secrets.
// Usage: node scripts/check-personal-data.mjs [--all]   (default: staged files only)
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const all = process.argv.includes("--all");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const files = (all ? git("ls-files") : git("diff", "--cached", "--name-only", "--diff-filter=ACM"))
  .split("\n")
  .filter(Boolean);

const SELF = "scripts/check-personal-data.mjs";
const ALLOWED_EMAIL = /@(example\.(com|org)|users\.noreply\.github\.com|localhost)$/i;
const FAKE_PHONE = /^\(?555\)?[\s.-]?01\d/;

const checks = [
  {
    name: "forbidden file type",
    pathOnly: true,
    test: (file) =>
      /\.(har|db|sqlite)$|(^|\/)(\.env(\.[^/]+)?|session[^/]*\.json)$/.test(file) &&
      !file.endsWith(".env.example")
        ? [file]
        : [],
  },
  {
    name: "phone number",
    test: (_f, text) =>
      [...text.matchAll(/(?<![\d.])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d.])/g)]
        .map((m) => m[0])
        .filter((p) => !FAKE_PHONE.test(p)),
  },
  {
    name: "email address",
    test: (_f, text) =>
      [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)]
        .map((m) => m[0])
        .filter((e) => !ALLOWED_EMAIL.test(e)),
  },
  {
    name: "auth token assignment",
    test: (_f, text) =>
      [...text.matchAll(/auth_?token["']?\s*[:=]\s*["'][A-Za-z0-9._\-+/=]{20,}["']/gi)].map(
        (m) => m[0],
      ),
  },
  {
    name: "bearer token",
    test: (_f, text) => [...text.matchAll(/Bearer\s+[A-Za-z0-9._-]{24,}/g)].map((m) => m[0]),
  },
];

let problems = 0;
for (const file of files) {
  if (file === SELF) continue;
  let text = "";
  const pathHits = checks
    .filter((c) => c.pathOnly)
    .flatMap((c) => c.test(file, "").map((h) => [c, h]));
  for (const [check, hit] of pathHits) {
    problems++;
    console.error(`✗ ${file}: ${check.name} (${hit})`);
  }
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const check of checks.filter((c) => !c.pathOnly)) {
    for (const hit of check.test(file, text).slice(0, 3)) {
      problems++;
      console.error(`✗ ${file}: ${check.name} (${hit.slice(0, 4)}…)`);
    }
  }
}

if (problems) {
  console.error(`\n${problems} possible personal-data/secret finding(s). Commit blocked.`);
  console.error("Use placeholders such as (555) 010-0000 and user@example.com.");
  process.exit(1);
}
console.log("check-personal-data: ok");
