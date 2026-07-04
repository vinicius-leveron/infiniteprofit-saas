import { expect, test } from "@playwright/test";
import { hasAuthEnv, login } from "./helpers";

test.describe("setup wizard smoke", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasAuthEnv(), "Set E2E_EMAIL and E2E_PASSWORD to run setup wizard smoke.");
    await login(page);
  });

  test("wizard keeps the draft after reload and blocks empty operation name", async ({ page }) => {
    const projectName = `QA Smoke ${Date.now()}`;

    await page.goto("/setup-operation");

    await expect(page.getByRole("heading", { name: /Nova operação/i })).toBeVisible();
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByRole("button", { name: "Próximo" }).click();

    await expect(page.getByRole("button", { name: /Criar operação/i })).toBeDisabled();

    await page.getByRole("button", { name: "Funil", exact: true }).click();
    await page.getByLabel("Nome").fill(projectName);
    await page.getByRole("button", { name: "Meta", exact: true }).click();
    await page.getByPlaceholder("act_123 ou 123").fill("123456789");
    await page.getByPlaceholder("Kosmos").fill("Conta QA");
    await page.getByPlaceholder("Cole o token Meta").fill("meta-token-qa");
    await page.getByRole("button", { name: "VTurb", exact: true }).click();
    await page.getByPlaceholder("Cole a API key da VTurb").fill("vturb-key-qa");
    await page.getByPlaceholder("Selecione acima ou cole um player ID por linha").fill("player-qa-1");

    await page.reload();

    await expect(page.getByPlaceholder("Cole a API key da VTurb")).toHaveValue("vturb-key-qa");
    await expect(page.getByPlaceholder("Selecione acima ou cole um player ID por linha")).toHaveValue("player-qa-1");

    await page.getByRole("button", { name: "Funil", exact: true }).click();
    await expect(page.getByLabel("Nome")).toHaveValue(projectName);
    await page.getByRole("button", { name: "Meta", exact: true }).click();
    await expect(page.getByPlaceholder("act_123 ou 123")).toHaveValue("123456789");
    await expect(page.getByPlaceholder("Kosmos")).toHaveValue("Conta QA");
    await expect(page.getByPlaceholder("Cole o token Meta")).toHaveValue("meta-token-qa");
    await page.getByRole("button", { name: "Revisão", exact: true }).click();
    await expect(page.getByRole("button", { name: /Criar operação/i })).toBeEnabled();
  });
});
