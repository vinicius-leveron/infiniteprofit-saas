import { expect, test } from "@playwright/test";
import { hasAuthEnv, hasProjectEnv, login, qaProjectId } from "./helpers";

test.describe("dashboard data regression", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasAuthEnv(), "Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E tests.");
    test.skip(!hasProjectEnv(), "Set E2E_PROJECT_ID to run project data regression tests.");
    await login(page);
  });

  test("monthly dashboard keeps data after period changes and reload", async ({ page }) => {
    await page.goto(`/dashboard?project=${qaProjectId}`);
    await expect(page.getByRole("heading", { name: /Visão Geral|Visao Geral/ })).toBeVisible();

    await page.getByRole("button", { name: "30 dias" }).click();
    await expect(page.getByText("Nenhum dia no período")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "30 dias" })).toBeVisible();

    await page.reload();
    await expect(page.getByText("Nenhum dia no período")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Visão Geral|Visao Geral/ })).toBeVisible();

    await page.goto(`/dashboard?project=${qaProjectId}&tab=trafego`);
    await expect(page.getByRole("heading", { name: /Tráfego|Trafego/i })).toBeVisible();
    await expect(page.getByText("Nenhum dia no período")).toHaveCount(0);

    await page.goto(`/dashboard?project=${qaProjectId}&tab=funil`);
    await expect(page.getByRole("heading", { name: "Funil VSL" })).toBeVisible();
    await expect(page.getByText("Nenhum dia no período")).toHaveCount(0);

    await page.goto(`/dashboard?project=${qaProjectId}&tab=diagnostico`);
    await expect(page.getByText(/Diagnóstico|Diagnostico|alertas comparativos/i)).toBeVisible();
    await expect(page.getByText("Nenhum dia no período")).toHaveCount(0);
  });

  test("diagnostics and connections expose actionable QA surfaces", async ({ page }) => {
    await page.goto(`/diagnostics?project=${qaProjectId}`);
    await expect(page.getByRole("heading", { name: /O que precisa de ação|Alertas operacionais/i }).first()).toBeVisible();
    await expect(page.getByText("Eventos", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Agregado", { exact: true }).first()).toBeVisible();

    await page.goto(`/connections?project=${qaProjectId}`);
    await expect(page.getByRole("heading", { name: /Conexões/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meta Ads" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "VTurb" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gateway de Pagamento" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Importar CSV/XLSX Hubla" })).toBeVisible();
  });
});
