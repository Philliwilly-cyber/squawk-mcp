import { describe, expect, it } from "vitest";
import { explainSquawk, isEmergencySquawk, squawkReference } from "../../src/core/squawk.js";

describe("squawk", () => {
  it.each(["7500", "7600", "7700"])("treats %s as an emergency with a caveat", (code) => {
    const info = explainSquawk(code);
    expect(info.category).toBe("emergency");
    expect(info.caveat).toBeDefined();
    expect(isEmergencySquawk(code)).toBe(true);
  });

  it("explains conspicuity codes without a caveat", () => {
    const info = explainSquawk("7000");
    expect(info.category).toBe("conspicuity");
    expect(info.caveat).toBeUndefined();
  });

  it("falls back to discrete codes", () => {
    expect(explainSquawk("4321").category).toBe("discrete");
  });

  it("rejects non-octal codes", () => {
    expect(explainSquawk("7800").category).toBe("invalid");
    expect(explainSquawk("770").category).toBe("invalid");
  });

  it("lists the reference table", () => {
    expect(squawkReference().map((s) => s.code)).toContain("7700");
  });
});
