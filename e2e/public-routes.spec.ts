import { expect, test } from "@playwright/test";
import {
  assertPrivateRouteRedirects,
  hasPublicShareEnv,
  qaPublicShareToken,
} from "./helpers";

test.describe("public and auth boundaries", () => {
  test("private routes redirect anonymous users to auth", async ({ page }) => {
    await assertPrivateRouteRedirects(page, "/projects");
    await assertPrivateRouteRedirects(page, "/dashboard");
    await assertPrivateRouteRedirects(page, "/diagnostics?project=00000000-0000-0000-0000-000000000000");
    await assertPrivateRouteRedirects(page, "/connections?project=00000000-0000-0000-0000-000000000000");
  });

  test("invalid public share token shows a controlled error", async ({ page }) => {
    await page.goto("/share/invalid-e2e-token");
    await expect(page.getByText(/Link invalido|Link inválido|Link indispon/i)).toBeVisible();
    await expect(page.getByText(/Conexões|Workspace Settings|Sincronizar Meta|Sincronizar VTurb/)).toHaveCount(0);
  });

  test("valid public share is read-only", async ({ page }) => {
    test.skip(!hasPublicShareEnv(), "Set E2E_PUBLIC_SHARE_TOKEN to run public share smoke test.");

    await page.goto(`/share/${qaPublicShareToken}`);
    await expect(page.getByText("Modo cliente", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /PDF/i })).toBeVisible();
    await expect(page.getByText(/Conexões|Workspace Settings|Sincronizar Meta|Sincronizar VTurb|Atualizar alertas/)).toHaveCount(0);
  });
});
