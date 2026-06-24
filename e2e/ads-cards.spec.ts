import { expect, test } from "@playwright/test";
import {
  hasAuthEnv,
  hasProjectEnv,
  login,
  qaProjectId,
} from "./helpers";

test.describe("ads cards workspace", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasAuthEnv(), "Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E tests.");
    await login(page);
  });

  test("cards view loads and can switch to funnel", async ({ page }) => {
    test.skip(!hasProjectEnv(), "Set E2E_PROJECT_ID to run project ads tests.");

    await page.goto(`/dashboard?project=${qaProjectId}&tab=anuncios`);
    await expect(page.getByRole("button", { name: "Cards" })).toBeVisible();
    const funnelViewButton = page.getByRole("button", { name: "Funil", exact: true });
    await expect(funnelViewButton).toBeVisible();
    await expect(page.getByRole("heading", { name: /Galeria de Criativos/i })).toBeVisible();

    await funnelViewButton.click();
    await expect(page.getByText(/Funil por Anúncio|Funil por Anuncio/i)).toBeVisible();
  });
});
