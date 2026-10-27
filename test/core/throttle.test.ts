import { describe, expect, it } from "vitest";
import { Throttle } from "../../src/core/throttle.js";

describe("Throttle", () => {
  it("spaces task starts by the interval", async () => {
    let now = 0;
    const starts: number[] = [];
    const throttle = new Throttle(
      1_000,
      () => now,
      (ms) => {
        now += ms;
        return Promise.resolve();
      },
    );
    await Promise.all(
      [1, 2, 3].map(() =>
        throttle.run(() => {
          starts.push(now);
          return Promise.resolve();
        }),
      ),
    );
    expect(starts).toEqual([0, 1_000, 2_000]);
  });

  it("keeps going after a failed task", async () => {
    const throttle = new Throttle(0);
    await expect(throttle.run(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(throttle.run(() => Promise.resolve(1))).resolves.toBe(1);
  });
});
