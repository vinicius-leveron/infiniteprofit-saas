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
    await expect(page.getByRole("button", { name: "Funil" })).toBeVisible();

    const analysisButtons = page.getByRole("button", { name: /Ver análise|Ver analise/i });
    if (await analysisButtons.count()) {
      await analysisButtons.first().click();
      await expect(page.getByRole("tab", { name: /Resumo/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /Transcrição|Transcricao/i })).toBeVisible();
    } else {
      await expect(page.getByText(/Sem criativos materializados|Processando criativos|Falha ao montar os cards de criativos/i)).toBeVisible();
    }

    await page.getByRole("button", { name: "Funil" }).click();
    await expect(page.getByText(/Funil por Anúncio|Funil por Anuncio/i)).toBeVisible();
  });
});
