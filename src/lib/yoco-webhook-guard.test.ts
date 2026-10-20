import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const WEBHOOK_PATH = path.resolve(__dirname, "../../supabase/functions/yoco-webhook/index.ts");

describe("yoco-webhook guard", () => {
  it("does not contain redacted SECURITY_DATA placeholder", () => {
    const src = readFileSync(WEBHOOK_PATH, "utf8");
    expect(src).not.toContain("SECURITY_DATA");
  });

  it("reads YOCO_WEBHOOK_SECRET via Deno.env.get", () => {
    const src = readFileSync(WEBHOOK_PATH, "utf8");
    expect(src).toContain("Deno.env.get('YOCO_WEBHOOK_SECRET')");
    // The old broken line had `[SECURITY_DATA]'YOCO_WEBHOOK_SECRET')` — ensure it's gone
    expect(src).not.toContain("[SECURITY_DATA]");
  });

  it("is not empty and still handles signature verification", () => {
    const src = readFileSync(WEBHOOK_PATH, "utf8");
    expect(src).toContain("isSignatureValid");
    expect(src).toContain("YOCO_WEBHOOK_SECRET");
  });
});
