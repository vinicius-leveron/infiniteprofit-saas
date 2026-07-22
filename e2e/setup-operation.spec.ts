import { expect, test } from "@playwright/test";
import { hasAuthEnv, login } from "./helpers";

test.describe("setup wizard smoke", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasAuthEnv(), "Set E2E_EMAIL and E2E_PASSWORD to run setup wizard smoke.");
    await login(page);
  });

  test("wizard persists only non-sensitive draft data after reload", async ({ page }) => {
    const projectName = `QA Smoke ${Date.now()}`;
    const metaToken = "meta-token-qa";
    const vturbKey = "vturb-key-qa";
    const gatewaySecret = "gateway-secret-qa";
    const hublaCsv = "ID da fatura;Status da fatura;Data de pagamento;Valor total\nfat-qa;Aprovada;01/07/2026;R$ 200,00";

    await page.goto("/setup-operation");

    await expect(page.getByRole("heading", { name: "Novo funil" })).toBeVisible();
    await page.getByLabel("Nome").fill(projectName);
    await page.getByRole("button", { name: "Fontes opcionais" }).click();
    await page.getByLabel("Access token Meta").fill(metaToken);
    await page.getByPlaceholder("Cole a API key da VTurb").fill(vturbKey);
    await page.getByPlaceholder("Selecione acima ou cole um player ID por linha").fill("player-qa-1");
    await page.getByPlaceholder("Cole o secret da Hubla").fill(gatewaySecret);
    await page.getByLabel(/Selecionar CSV ou XLSX da Hubla/i).setInputFiles({
      name: "hubla-qa.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(hublaCsv),
    });
    await expect(page.getByText("hubla-qa.csv")).toBeVisible();

    await page.reload();

    await expect(page.getByPlaceholder("Cole o secret da Hubla")).toHaveValue("");
    await expect(page.getByPlaceholder("Cole a API key da VTurb")).toHaveValue("");
    await expect(page.getByPlaceholder("Selecione acima ou cole um player ID por linha")).toHaveValue("player-qa-1");
    await expect(page.getByText("hubla-qa.csv")).toHaveCount(0);

    await page.getByRole("button", { name: "Nome" }).click();
    await expect(page.getByLabel("Nome")).toHaveValue(projectName);
    await page.getByRole("button", { name: "Fontes opcionais" }).click();
    await expect(page.getByLabel("Access token Meta")).toHaveValue("");

    const persistedDrafts = await page.evaluate(() =>
      Object.values(sessionStorage).join("\n")
    );
    expect(persistedDrafts).not.toContain(metaToken);
    expect(persistedDrafts).not.toContain(vturbKey);
    expect(persistedDrafts).not.toContain(gatewaySecret);
    expect(persistedDrafts).not.toContain("fat-qa");
  });
});
