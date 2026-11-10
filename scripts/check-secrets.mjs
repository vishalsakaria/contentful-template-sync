#!/usr/bin/env node
/**
 * Secret guard. Fails (exit 1) if anything about to be committed contains
 *   - a value from your local .env (token, webhook secret, password, org/space/template IDs), or
 *   - a token-shaped string, or
 *   - a .env file that isn't .env.example.
 * It only ever prints file names and variable NAMES — never the values.
 *
 *   npm run check:secrets            # every committable file on disk
 *   npm run check:secrets -- --staged  # only what is staged (used by the pre-commit hook)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const staged = process.argv.includes("--staged");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// 1. values from the local .env (if there is one)
const env = {};
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    const v = m?.[2].trim().replace(/^["']|["']$/g, "");
    if (m && v) env[m[1]] = v;
  }
}
const SKIP = new Set(["SOURCE_ENVIRONMENT_ID", "AUTO_INSTALL_MODE"]); // harmless config, not secrets
const needles = []; // [variableName, value]
for (const [k, v] of Object.entries(env)) {
  if (SKIP.has(k)) continue;
  for (const part of k === "TEMPLATE_IDS" ? v.split(",") : [v]) {
    if (part.trim().length >= 6) needles.push([k, part.trim()]);
  }
}

// 2. token-shaped strings
const PATTERNS = [
  ["Contentful personal access token (CFPAT-…)", /CFPAT-[A-Za-z0-9_-]{20,}/],
  ["JWT-like token", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Authorization: Bearer <token>", /Bearer\s+[A-Za-z0-9._-]{30,}/],
];

const files = (staged ? git("diff", "--cached", "--name-only", "--diff-filter=ACM") : git("ls-files", "-co", "--exclude-standard"))
  .split("\n")
  .filter(Boolean);

const problems = [];
for (const f of files) {
  if (/(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith(".env.example")) {
    problems.push(`${f}: an env file must never be committed`);
    continue;
  }
  if (f === "package-lock.json" || /\.(png|jpe?g|gif|ico|woff2?)$/i.test(f)) continue;
  let text;
  try {
    text = staged ? git("show", `:${f}`) : readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const [name, value] of needles) if (text.includes(value)) problems.push(`${f}: contains the value of ${name} from your .env`);
  for (const [label, re] of PATTERNS) if (re.test(text)) problems.push(`${f}: looks like a ${label}`);
}

if (problems.length) {
  console.error("\n✖ Secret check failed — nothing was committed:\n");
  for (const p of problems) console.error("  • " + p);
  console.error("\nRemove the value (read it from process.env instead) and try again.\n");
  process.exit(1);
}
console.log(`✔ Secret check passed (${files.length} files${staged ? " staged" : ""}, ${needles.length} .env values checked)`);
