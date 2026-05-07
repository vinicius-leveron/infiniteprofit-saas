import { expect, test } from "@playwright/test";
import { hasAuthEnv, login } from "./helpers";

test.describe("setup wizard smoke", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasAuthEnv(), "Set E2E_EMAIL and E2E_PASSWORD to run setup wizard smoke.");
    await login(page);
  });

  test("wizard accepts skipped integrations and blocks empty operation name", async ({ page }) => {
    await page.goto("/setup-operation");

    await expect(page.getByRole("heading", { name: /Nova Operação via API/i })).toBeVisible();
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByRole("button", { name: "Próximo" }).click();

    await expect(page.getByRole("button", { name: /Criar operação/i })).toBeDisabled();
    await page.getByRole("button", { name: "Operação" }).click();
    await page.getByLabel("Nome").fill(`QA Smoke ${Date.now()}`);
    await page.getByRole("button", { name: "Revisão" }).click();
    await expect(page.getByRole("button", { name: /Criar operação/i })).toBeEnabled();
  });
});
