import { describe, expect, it } from "vitest";
import {
  normalizeHotmartBasicTokenInput,
  validateHotmartCredentialDraft,
} from "@/lib/hotmartCredentials";

describe("Hotmart credential form helpers", () => {
  it("normalizes a copied Authorization header", () => {
    expect(
      normalizeHotmartBasicTokenInput(
        "Authorization: Basic YWJjZGVmZ2g=\n",
      ),
    ).toBe("Basic YWJjZGVmZ2g=");
  });

  it("rejects a Bearer token before calling the backend", () => {
    expect(
      validateHotmartCredentialDraft({
        clientId: "client-id",
        clientSecret: "client-secret",
        basicToken: "Bearer access-token",
      }),
    ).toMatch(/não um Access Token/);
  });

  it("accepts complete credentials and Basic without its prefix", () => {
    expect(
      validateHotmartCredentialDraft({
        clientId: "client-id",
        clientSecret: "client-secret",
        basicToken: "YWJjZGVmZ2g=",
      }),
    ).toBeNull();
  });
});
