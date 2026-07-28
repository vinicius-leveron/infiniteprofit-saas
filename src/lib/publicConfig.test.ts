import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadHotmartFlag(globalFlag: string, canaryIds: string) {
  vi.stubEnv("VITE_ENABLE_HOTMART_CHECKOUT", globalFlag);
  vi.stubEnv("VITE_HOTMART_CANARY_WORKSPACE_IDS", canaryIds);
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

  it("enables every workspace only when the global flag is explicit", async () => {
    const { isHotmartCheckoutEnabled } = await loadHotmartFlag("true", "");

    expect(isHotmartCheckoutEnabled("workspace-customer")).toBe(true);
  });
});
