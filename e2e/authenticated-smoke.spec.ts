import { expect, test } from "@playwright/test";
import {
  hasAuthEnv,
  hasProjectEnv,
  login,
  qaProjectId,
} from "./helpers";

test.describe("authenticated launch smoke", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasAuthEnv(), "Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E tests.");
    await login(page);
  });

  test("projects and main navigation load", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByText("Infinite Profit")).toBeVisible();
    await expect(page.getByRole("button", { name: /Nova operação/i })).toBeVisible();
  });

  test("diagnostics, dashboard, and connections load for QA project", async ({ page }) => {
    test.skip(!hasProjectEnv(), "Set E2E_PROJECT_ID to run project smoke tests.");

    await page.goto(`/diagnostics?project=${qaProjectId}`);
    await expect(page.getByText("Diagnóstico", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /Atualizar alertas/i })).toBeVisible();
    await expect(page.getByText(/Meta|VTurb|Hubla/)).toBeVisible();

    await page.goto(`/dashboard?project=${qaProjectId}`);
    await expect(page.getByText(/Visão Geral|Visao Geral/)).toBeVisible();
    await expect(page.getByText(/Anúncios|Anuncios/)).toBeVisible();
    await expect(page.getByText(/Atribuição|Atribuicao/)).toBeVisible();
    await expect(page.getByText("Relatório")).toBeVisible();

    await page.goto(`/connections?project=${qaProjectId}`);
    await expect(page.getByText("Conexões", { exact: false })).toBeVisible();
    await expect(page.getByText("Meta Ads")).toBeVisible();
    await expect(page.getByText("VTurb")).toBeVisible();
    await expect(page.getByText(/Gateway de Pagamento|Compartilhamento/)).toBeVisible();
  });
});
