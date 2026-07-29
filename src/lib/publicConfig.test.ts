import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadHotmartFlag(
  disabled: string | undefined,
  canaryIds?: string,
) {
  if (disabled !== undefined) {
    vi.stubEnv("VITE_DISABLE_HOTMART_CHECKOUT", disabled);
  }
  if (canaryIds !== undefined) {
    vi.stubEnv("VITE_HOTMART_CANARY_WORKSPACE_IDS", canaryIds);
  }
  return import("./publicConfig");
}

describe("Hotmart checkout rollout", () => {
  it("keeps only the canary available when the emergency switch is active", async () => {
    const { isHotmartCheckoutEnabled } = await loadHotmartFlag(
      "true",
      "workspace-canary",
    );

    expect(isHotmartCheckoutEnabled("workspace-canary")).toBe(true);
    expect(isHotmartCheckoutEnabled("workspace-customer")).toBe(false);
    expect(isHotmartCheckoutEnabled(null)).toBe(false);
  });

  it("enables every workspace by default", async () => {
    const { isHotmartCheckoutEnabled } = await loadHotmartFlag(undefined, "");

    expect(isHotmartCheckoutEnabled("workspace-customer")).toBe(true);
    expect(isHotmartCheckoutEnabled(null)).toBe(true);
  });

  it("keeps every workspace available when the emergency switch is false", async () => {
    const { isHotmartCheckoutEnabled } = await loadHotmartFlag("false");

    expect(
      isHotmartCheckoutEnabled("ce21f804-5915-40fa-8499-e43092d2884b"),
    ).toBe(true);
    expect(isHotmartCheckoutEnabled("workspace-customer")).toBe(true);
  });
});
