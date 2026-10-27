import { describe, expect, it, vi } from "vitest";
import { HttpError, fetchWithTimeout } from "../../src/core/http.js";
import { withRetry } from "../../src/core/retry.js";

const options = {
  retries: 3,
  baseDelayMs: 100,
  maxDelayMs: 1_000,
  maxTotalWaitMs: 5_000,
  random: () => 1,
};

describe("withRetry", () => {
  it("retries 5xx with exponential backoff", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpError("boom", 503))
      .mockRejectedValueOnce(new HttpError("boom", 502))
      .mockResolvedValue("ok");
    await expect(withRetry(fn, { ...options, sleep })).resolves.toBe("ok");
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it("honours retry-after on 429", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fn = vi.fn().mockRejectedValueOnce(new HttpError("slow down", 429, 2)).mockResolvedValue("ok");
    await withRetry(fn, { ...options, sleep });
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("gives up when retry-after exceeds the total wait budget", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fn = vi.fn().mockRejectedValue(new HttpError("quota", 429, 3_600));
    await expect(withRetry(fn, { ...options, sleep })).rejects.toThrow("quota");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry other 4xx", async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError("bad", 400));
    await expect(withRetry(fn, options)).rejects.toThrow("bad");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("fetchWithTimeout", () => {
  it("includes the cause of network errors", async () => {
    const fetchFn = () => Promise.reject(new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND x") }));
    await expect(fetchWithTimeout(fetchFn, "https://x.example/", {}, 1000)).rejects.toThrow(
      "Request to x.example failed: fetch failed (getaddrinfo ENOTFOUND x)",
    );
  });
});
