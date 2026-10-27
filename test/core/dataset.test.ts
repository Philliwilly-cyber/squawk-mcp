import { describe, expect, it } from "vitest";
import { LazyDataset } from "../../src/core/dataset.js";

describe("LazyDataset", () => {
  it("reports loading when the wait runs out", async () => {
    const dataset = new LazyDataset(() => new Promise<never>(() => undefined));
    expect((await dataset.get(5)).status).toBe("loading");
  });

  it("becomes ready", async () => {
    const dataset = new LazyDataset(() => Promise.resolve({ data: 42, updatedAt: 1 }));
    expect(await dataset.get(100)).toMatchObject({ status: "ready", data: 42 });
  });

  it("reports failures and retries later", async () => {
    let calls = 0;
    const dataset = new LazyDataset(() => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ data: 1, updatedAt: 1 });
    }, 0);
    expect(await dataset.get(100)).toMatchObject({ status: "failed", error: "offline" });
    expect(await dataset.get(100)).toMatchObject({ status: "ready" });
  });
});

describe("LazyDataset after failures", () => {
  it("does not retry a failed load before the cool-down", async () => {
    let now = 0;
    let calls = 0;
    const dataset = new LazyDataset(
      () => {
        calls++;
        return Promise.reject(new Error("offline"));
      },
      60_000,
      () => now,
    );
    await dataset.get(10);
    await dataset.get(10);
    expect(calls).toBe(1);
    now = 61_000;
    await dataset.get(10);
    expect(calls).toBe(2);
  });

  it("peek never starts a load", () => {
    let calls = 0;
    const dataset = new LazyDataset(() => {
      calls++;
      return Promise.resolve({ data: 1, updatedAt: 1 });
    });
    expect(dataset.peek().status).toBe("loading");
    expect(calls).toBe(0);
  });
});
