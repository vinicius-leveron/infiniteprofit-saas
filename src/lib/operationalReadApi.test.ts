import { describe, expect, it } from "vitest";
import { isOperationalReadRetryable } from "@/lib/operationalReadApi";

describe("operational read API", () => {
  it("classifies infrastructure and statement timeouts as retryable", () => {
    expect(isOperationalReadRetryable({ status: 504 })).toBe(true);
    expect(isOperationalReadRetryable({ code: "57014" })).toBe(true);
    expect(
      isOperationalReadRetryable(
        new Error("connection terminated due to connection timeout"),
      ),
    ).toBe(true);
  });

  it("does not classify authorization or validation failures as retryable", () => {
    expect(
      isOperationalReadRetryable({
        status: 403,
        code: "42501",
        message: "permission denied",
      }),
    ).toBe(false);
  });
});
