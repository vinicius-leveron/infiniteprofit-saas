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
    await expect(page.getByRole("heading", { name: "Funis" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Novo funil/i })).toBeVisible();
  });

  test("diagnostics, dashboard, and connections load for QA project", async ({ page }) => {
    test.skip(!hasProjectEnv(), "Set E2E_PROJECT_ID to run project smoke tests.");

    await page.goto(`/diagnostics?project=${qaProjectId}`);
    await expect(page.getByText("Saúde do funil", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /Atualizar alertas/i })).toBeVisible();
    await expect(page.getByText("Meta", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("VTurb", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Gateway", { exact: true }).first()).toBeVisible();

    await page.goto(`/dashboard?project=${qaProjectId}`);
    await expect(page.getByText(/Visão Geral|Visao Geral/)).toBeVisible();
    await expect(page.getByText(/Anúncios|Anuncios/)).toBeVisible();
    await expect(page.getByText("Funil VSL")).toBeVisible();
    await expect(page.getByText("Bumps & Upsell")).toBeVisible();
    await expect(page.getByText("Simulador")).toBeVisible();

    await page.goto(`/connections?project=${qaProjectId}`);
    await expect(page.getByRole("heading", { name: /Fontes de dados/i })).toBeVisible();
    await expect(page.getByText("Meta Ads")).toBeVisible();
    await expect(page.getByRole("heading", { name: "VTurb" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gateway" })).toBeVisible();
  });
});
