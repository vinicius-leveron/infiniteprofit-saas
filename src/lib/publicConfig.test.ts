import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadHotmartFlag(
  globalFlag: string,
  canaryIds?: string,
) {
  vi.stubEnv("VITE_ENABLE_HOTMART_CHECKOUT", globalFlag);
  if (canaryIds !== undefined) {
    vi.stubEnv("VITE_HOTMART_CANARY_WORKSPACE_IDS", canaryIds);
  }
  return import("./publicConfig");
}

describe("Hotmart checkout rollout", () => {
  it("keeps the integration disabled outside the canary allowlist", async () => {
    const { isHotmartCheckoutEnabled } = await loadHotmartFlag(
      "false",
      "workspace-canary",
    );

    expect(isHotmartCheckoutEnabled("workspace-canary")).toBe(true);
    expect(isHotmartCheckoutEnabled("workspace-customer")).toBe(false);
    expect(isHotmartCheckoutEnabled(null)).toBe(false);
  });

  it("enables every workspace when the production rollout flag is active", async () => {
    const { isHotmartCheckoutEnabled } = await loadHotmartFlag("true", "");

    expect(isHotmartCheckoutEnabled("workspace-customer")).toBe(true);
    expect(isHotmartCheckoutEnabled(null)).toBe(true);
  });

  it("keeps the internal canary available when the host has no new env var", async () => {
    const { isHotmartCheckoutEnabled } = await loadHotmartFlag("false");

    expect(
      isHotmartCheckoutEnabled("ce21f804-5915-40fa-8499-e43092d2884b"),
    ).toBe(true);
    expect(isHotmartCheckoutEnabled("workspace-customer")).toBe(false);
  });
});
