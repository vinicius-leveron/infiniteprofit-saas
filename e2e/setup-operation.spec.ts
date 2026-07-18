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
    await page.getByLabel("Access token Meta").fill(metaToken);
    await page.getByRole("button", { name: "VTurb", exact: true }).click();
    await page.getByPlaceholder("Cole a API key da VTurb").fill(vturbKey);
    await page.getByPlaceholder("Selecione acima ou cole um player ID por linha").fill("player-qa-1");
    await page.getByRole("button", { name: "Gateway", exact: true }).click();
    await page.getByPlaceholder("Cole o secret da Hubla").fill(gatewaySecret);

    await page.reload();

    await expect(page.getByPlaceholder("Cole o secret da Hubla")).toHaveValue("");
    await page.getByRole("button", { name: "VTurb", exact: true }).click();
    await expect(page.getByPlaceholder("Cole a API key da VTurb")).toHaveValue("");
    await expect(page.getByPlaceholder("Selecione acima ou cole um player ID por linha")).toHaveValue("player-qa-1");

    await page.getByRole("button", { name: "Funil", exact: true }).click();
    await expect(page.getByLabel("Nome")).toHaveValue(projectName);
    await page.getByRole("button", { name: "Meta", exact: true }).click();
    await expect(page.getByLabel("Access token Meta")).toHaveValue("");

    const persistedDrafts = await page.evaluate(() =>
      Object.values(sessionStorage).join("\n")
    );
    expect(persistedDrafts).not.toContain(metaToken);
    expect(persistedDrafts).not.toContain(vturbKey);
    expect(persistedDrafts).not.toContain(gatewaySecret);
  });
});
