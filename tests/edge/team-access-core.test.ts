import { describe, expect, it } from "vitest";
import {
  canGrantRole,
  highestEffectiveAccess,
} from "../../supabase/functions/team-access/core";

describe("team access authorization", () => {
  it("allows only an Owner to grant the Owner role", () => {
    expect(canGrantRole("owner", "owner")).toBe(true);
    expect(canGrantRole("admin", "owner")).toBe(false);
    expect(canGrantRole("admin", "admin")).toBe(true);
    expect(canGrantRole("admin", "moderator")).toBe(true);
    expect(canGrantRole("admin", "member")).toBe(true);
  });

  it("combines direct and inherited access using role precedence", () => {
    expect(
      highestEffectiveAccess([
        { role: "member", origin: "workspace" },
        { role: "admin", origin: "organization" },
      ]),
    ).toEqual({ role: "admin", origin: "organization" });

    expect(
      highestEffectiveAccess([
        { role: "owner", origin: "workspace" },
        { role: "admin", origin: "organization" },
      ]),
    ).toEqual({ role: "owner", origin: "workspace" });
    expect(highestEffectiveAccess([])).toBeNull();
  });
});
