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
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    await page.goto("/share/invalid-e2e-token");
    await expect(
      page.getByText(/Link invalido|Link inválido|Link indispon|Link desativado/i),
    ).toBeVisible();
    await expect(page.getByText(/Edge Function|non-2xx|status code/i)).toHaveCount(0);
    await expect(page.getByText(/Conexões|Workspace Settings|Sincronizar Meta|Sincronizar VTurb/)).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
  });

  test("support and preliminary legal pages stay public", async ({ page }) => {
    for (const path of ["/help", "/terms", "/privacy"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page).not.toHaveURL(/\/auth/);
    }
  });

  test("valid public share is read-only", async ({ page }) => {
    test.skip(!hasPublicShareEnv(), "Set E2E_PUBLIC_SHARE_TOKEN to run public share smoke test.");

    await page.goto(`/share/${qaPublicShareToken}`);
    await expect(page.getByText("Modo cliente", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /PDF/i })).toBeVisible();
    await expect(page.getByText(/Conexões|Workspace Settings|Sincronizar Meta|Sincronizar VTurb|Atualizar alertas/)).toHaveCount(0);
  });
});
