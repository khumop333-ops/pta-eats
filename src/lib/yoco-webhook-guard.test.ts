import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Built from parts on purpose. This file is inside `src/`, which the CI guard
// greps for the placeholder; spelling the literal out here made the guard match
// its own test and turned CI red for every PR (including main) from #18 until
// the fix that introduced this line.
const REDACTION_PLACEHOLDER = ["SECURITY", "DATA"].join("_");

const REPO_ROOT = path.resolve(__dirname, "../..");
const WEBHOOK_PATH = path.join(REPO_ROOT, "supabase/functions/yoco-webhook/index.ts");

// The real risk is an Edge Function that cannot deploy because a redaction
// artefact replaced real code. Scanning src/ as well keeps the mistake from
// migrating into the frontend.
const SCANNED_DIRS = ["src", "supabase"];
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".sql",
  ".toml",
  ".md",
  ".yml",
  ".yaml",
  ".html",
  ".css",
]);

function listTextFiles(dir: string): string[] {
  const files: string[] = [];
  let entries;

  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // node_modules is gitignored but present locally; never scan it.
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      files.push(...listTextFiles(fullPath));
      continue;
    }

    if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("yoco-webhook guard", () => {
  it("does not contain the redacted secret placeholder", () => {
    const src = readFileSync(WEBHOOK_PATH, "utf8");
    expect(src).not.toContain(REDACTION_PLACEHOLDER);
    expect(src).not.toContain(`[${REDACTION_PLACEHOLDER}]`);
  });

  it("reads YOCO_WEBHOOK_SECRET via Deno.env.get", () => {
    const src = readFileSync(WEBHOOK_PATH, "utf8");
    expect(src).toContain("Deno.env.get('YOCO_WEBHOOK_SECRET')");
  });

  it("is not empty and still handles signature verification", () => {
    const src = readFileSync(WEBHOOK_PATH, "utf8");
    expect(src).toContain("isSignatureValid");
    expect(src).toContain("YOCO_WEBHOOK_SECRET");
  });

  it("has no redacted placeholder anywhere in src/ or supabase/", () => {
    const offenders = SCANNED_DIRS.flatMap((dir) => listTextFiles(path.join(REPO_ROOT, dir)))
      .filter((file) => readFileSync(file, "utf8").includes(REDACTION_PLACEHOLDER))
      .map((file) => path.relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
