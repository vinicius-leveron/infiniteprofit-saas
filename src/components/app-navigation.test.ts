import { describe, expect, it } from "vitest";
import {
  createAppNavigation,
  getNavigationScope,
} from "./app-navigation";

const baseContext = {
  clientId: "client-1",
  funnelId: "funnel-1",
  canManageOrganization: true,
  canManageClient: true,
};

describe("contextual app navigation", () => {
  it("shows only the nine Dashboard destinations in the Dashboard surface", () => {
    const groups = createAppNavigation({
      ...baseContext,
      surface: "dashboard",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("dashboard");
    expect(groups[0].items).toHaveLength(9);
    expect(groups[0].items.every((item) => item.dashboardTab)).toBe(true);
  });

  it("keeps organization and client administration out of the Dashboard sidebar", () => {
    const groups = createAppNavigation({
      ...baseContext,
      surface: "dashboard",
    });
    const ids = groups.flatMap((group) => group.items.map((item) => item.id));

    expect(ids).not.toContain("organization-clients");
    expect(ids).not.toContain("client-integrations");
    expect(ids).not.toContain("funnel-health");
  });

  it("hides administrative client destinations from members", () => {
    const groups = createAppNavigation({
      ...baseContext,
      canManageClient: false,
      surface: "client",
    });

    expect(groups[0].items.map((item) => item.id)).toEqual(["client-funnels"]);
  });

  it("exposes only organization and client shortcuts in the account menu", () => {
    const groups = createAppNavigation({
      ...baseContext,
      surface: "account-menu",
    });

    expect(groups.map((group) => group.id)).toEqual(["organization", "client"]);
  });

  it("resolves the navigation scope from current routes", () => {
    expect(getNavigationScope("/dashboard")).toBe("dashboard");
    expect(getNavigationScope("/clients/client-1/integrations")).toBe("client");
    expect(getNavigationScope("/funnels/funnel-1/health")).toBe("funnel");
    expect(getNavigationScope("/health")).toBe("organization");
  });
});
