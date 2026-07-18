import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const productionProjectRef = "nztnctrkmfrgclrnflfa";
const enabled = process.env.E2E_MARKET_ONBOARDING === "true";
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const reportPath =
  process.env.E2E_ONBOARDING_REPORT_PATH ??
  "artifacts/staging-onboarding.json";
const artifactUrl =
  process.env.READINESS_ARTIFACT_URL ??
  "https://github.com/vinicius-leveron/infiniteprofit-saas/actions";

test.describe("staging market onboarding", () => {
  test.skip(!enabled, "Set E2E_MARKET_ONBOARDING=true to run the destructive staging journey.");
  test.skip(!supabaseUrl || !serviceRoleKey, "Staging URL and service-role key are required.");

  test("creates the account and first funnel without persisting credentials", async ({
    page,
  }) => {
    if (supabaseUrl?.includes(productionProjectRef)) {
      throw new Error("Market onboarding E2E refuses the production Supabase project.");
    }

    const admin = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `market-readiness-${unique}@example.test`;
    const password = `Market-${unique}-Aa1!`;
    let userId: string | null = null;

    try {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: "Market Readiness" },
      });
      if (error || !data.user) {
        throw error ?? new Error("Staging user was not created.");
      }
      userId = data.user.id;

      await page.goto("/auth");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Senha").fill(password);
      await page.getByRole("button", { name: /^Entrar$/ }).click();
      await expect(page).toHaveURL(/\/welcome$/);

      await page.getByLabel("Nome da sua empresa ou agência")
        .fill(`Agência Market ${unique}`);
      await page.getByLabel("Nome do primeiro cliente")
        .fill(`Cliente Market ${unique}`);
      await page.getByRole("button", { name: "Criar cliente e continuar" })
        .click();
      await expect(page).toHaveURL(/\/clients\/[^/]+\/funnels\/new$/);

      await page.getByLabel("Nome").fill(`Funil Market ${unique}`);
      await page.getByRole("button", { name: "Fontes opcionais" }).click();

      const secrets = {
        meta: `meta-${unique}`,
        vturb: `vturb-${unique}`,
        gateway: `gateway-${unique}`,
      };
      await page.getByLabel("Access token Meta").fill(secrets.meta);
      await page.getByLabel("API key").fill(secrets.vturb);
      await page.getByLabel("Token/secret do webhook").fill(secrets.gateway);

      const draftBeforeReload = await page.evaluate(() =>
        Object.values(sessionStorage).join("\n")
      );
      expect(draftBeforeReload).not.toContain(secrets.meta);
      expect(draftBeforeReload).not.toContain(secrets.vturb);
      expect(draftBeforeReload).not.toContain(secrets.gateway);

      await page.reload();
      await expect(page.getByLabel("Access token Meta")).toHaveValue("");
      await expect(page.getByLabel("API key")).toHaveValue("");
      await expect(page.getByLabel("Token/secret do webhook")).toHaveValue("");

      const postponeButtons = page.getByRole("button", {
        name: "Fazer depois",
      });
      await expect(postponeButtons).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) {
        await postponeButtons.first().click();
      }

      await page.getByRole("button", { name: "Próximo" }).click();
      await expect(page.getByRole("heading", { name: "Revisão" })).toBeVisible();
      await page.getByRole("button", { name: "Criar funil" }).click();

      await expect(page).toHaveURL(/\/funnels\/[^/]+\/activation$/);
      await expect(
        page.getByRole("heading", {
          name: "Seu funil está pronto para começar",
        }),
      ).toBeVisible();

      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, JSON.stringify({
        schema_version: 1,
        environment: "staging",
        completed_at: new Date().toISOString(),
        login: true,
        bootstrap_account: true,
        first_funnel: true,
        activation_redirect: true,
        secrets_not_persisted: true,
        artifact_url: artifactUrl,
      }, null, 2));
    } finally {
      if (userId) {
        await admin.auth.admin.deleteUser(userId);
      }
    }
  });
});
