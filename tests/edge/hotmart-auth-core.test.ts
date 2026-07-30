import { describe, expect, it } from "vitest";
import {
  hotmartAuthorizationErrorMessage,
  normalizeHotmartBasicToken,
} from "../../supabase/functions/_shared/hotmart";

describe("Hotmart auth helpers", () => {
  it.each([
    ["YWJjZGVmZ2g=", "Basic YWJjZGVmZ2g="],
    ["Basic YWJjZGVmZ2g=", "Basic YWJjZGVmZ2g="],
    ["basic   YWJjZGVmZ2g=", "Basic YWJjZGVmZ2g="],
    ["Authorization: Basic YWJjZGVmZ2g=", "Basic YWJjZGVmZ2g="],
    ['"Basic YWJjZGVmZ2g="', "Basic YWJjZGVmZ2g="],
  ])("normalizes accepted Basic token formats", (input, expected) => {
    expect(normalizeHotmartBasicToken(input)).toBe(expected);
  });

  it.each(["", "Basic", "Bearer token", "Basic ###"])(
    "rejects an incomplete or wrong token: %s",
    (input) => {
      expect(normalizeHotmartBasicToken(input)).toBeNull();
    },
  );

  it("returns actionable and safe provider errors", () => {
    expect(hotmartAuthorizationErrorMessage(401)).toMatch(
      /mesma credencial de produção/,
    );
    expect(hotmartAuthorizationErrorMessage(403)).toMatch(/permissão/);
    expect(hotmartAuthorizationErrorMessage(503)).toMatch(
      /temporariamente indisponível/,
    );
  });
});
