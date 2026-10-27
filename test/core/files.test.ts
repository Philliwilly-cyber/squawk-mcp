import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureCachedFile } from "../../src/core/files.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "squawk-files-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ensureCachedFile", () => {
  it("downloads a missing file", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response("a,b\n")));
    const path = join(dir, "x.csv");
    await ensureCachedFile({ url: "https://example.org/x.csv", path, maxAgeMs: 1000, userAgent: "t", fetchFn });
    expect(await readFile(path, "utf8")).toBe("a,b\n");
  });

  it("keeps a recent copy without downloading", async () => {
    const path = join(dir, "x.csv");
    await writeFile(path, "old");
    const fetchFn = vi.fn();
    await ensureCachedFile({ url: "https://example.org/x.csv", path, maxAgeMs: 60_000, userAgent: "t", fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("falls back to an old copy when the refresh fails", async () => {
    const path = join(dir, "x.csv");
    await writeFile(path, "old");
    await utimes(path, new Date(0), new Date(0));
    const fetchFn = vi.fn(() => Promise.resolve(new Response("", { status: 503 })));
    const result = await ensureCachedFile({ url: "https://example.org/x.csv", path, maxAgeMs: 1, userAgent: "t", fetchFn });
    expect(result.refreshError).toMatch(/503/);
    expect(await readFile(path, "utf8")).toBe("old");
  });
});
