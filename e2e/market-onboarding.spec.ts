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
      const clientId = new URL(page.url()).pathname.split("/")[2];

      await page.getByLabel("Nome").fill(`Funil Market ${unique}`);
      await page.getByRole("button", { name: "Fontes opcionais" }).click();

      const secrets = {
        meta: `meta-${unique}`,
        vturb: `vturb-${unique}`,
        gateway: `gateway-${unique}`,
      };
      await page.getByRole("button", { name: /Meta Ads/i }).click();
      await page.getByLabel("Access token Meta").fill(secrets.meta);
      await page.getByRole("button", { name: "Voltar às fontes" }).click();
      await page.getByRole("button", { name: /VTurb/i }).click();
      await page.getByLabel("API key").fill(secrets.vturb);
      await page.getByRole("button", { name: "Voltar às fontes" }).click();
      await page.getByRole("button", { name: /Gateway/i }).click();
      await page.getByLabel("Token/secret do webhook").fill(secrets.gateway);

      const draftBeforeReload = await page.evaluate(() =>
        Object.values(sessionStorage).join("\n")
      );
      expect(draftBeforeReload).not.toContain(secrets.meta);
      expect(draftBeforeReload).not.toContain(secrets.vturb);
      expect(draftBeforeReload).not.toContain(secrets.gateway);

      await page.reload();
      await page.getByRole("button", { name: /Meta Ads/i }).click();
      await expect(page.getByLabel("Access token Meta")).toHaveValue("");
      await page.getByRole("button", { name: "Voltar às fontes" }).click();
      await page.getByRole("button", { name: /VTurb/i }).click();
      await expect(page.getByLabel("API key")).toHaveValue("");
      await page.getByRole("button", { name: "Voltar às fontes" }).click();
      await page.getByRole("button", { name: /Gateway/i }).click();
      await expect(page.getByLabel("Token/secret do webhook")).toHaveValue("");
      await page.getByRole("button", { name: "Voltar às fontes" }).click();

      const hublaCsv =
        "ID da fatura;Status da fatura;Data de pagamento;Valor total\n" +
        `fat-${unique};Aprovada;01/07/2026;R$ 200,00`;
      await page.getByRole("button", { name: /Histórico Hubla/i }).click();
      await page.getByLabel(/Selecionar CSV ou XLSX da Hubla/i).setInputFiles({
        name: `hubla-${unique}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(hublaCsv),
      });
      await expect(page.getByText(`hubla-${unique}.csv`)).toBeVisible();
      const draftWithHubla = await page.evaluate(() =>
        Object.values(sessionStorage).join("\n")
      );
      expect(draftWithHubla).not.toContain(`fat-${unique}`);
      await page.getByRole("button", { name: "Voltar às fontes" }).click();

      await page.getByRole("button", { name: "Revisar e criar funil" }).click();
      await expect(page.getByRole("heading", { name: "Revisão" })).toBeVisible();
      await page.getByRole("button", { name: "Criar funil" }).click();

      await expect(page).toHaveURL(/\/funnels\/[^/]+\/activation$/);
      const funnelId = new URL(page.url()).pathname.split("/")[2];
      await expect(
        page.getByRole("heading", {
          name: "Seu primeiro resultado chegou",
        }),
      ).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Ver meu primeiro resultado" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/dashboard\\?project=${funnelId}`),
      );

      await page.goto(`/clients/${clientId}/team`);
      await expect(page.getByRole("heading", { name: "Equipe" })).toBeVisible();
      await expect(page.getByLabel(/token|secret|api key/i)).toHaveCount(0);

      await page.goto(`/funnels/${funnelId}/sharing`);
      await expect(
        page.getByRole("heading", { name: "Compartilhamento" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Criar link público" }).click();
      await expect(page.getByText("Acesso do cliente")).toBeVisible();

      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, JSON.stringify({
        schema_version: 1,
        environment: "staging",
        completed_at: new Date().toISOString(),
        login: true,
        bootstrap_account: true,
        first_funnel: true,
        hubla_history: true,
        first_signal: true,
        first_dashboard: true,
        team_viewed: true,
        sharing_created: true,
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
