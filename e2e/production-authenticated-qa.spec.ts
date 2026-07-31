import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type QaIdentity = {
  email: string;
  password: string;
  fullName: string;
  userId: string;
};

type QaFixture = {
  publicUrl: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  roles: {
    owner: QaIdentity;
    admin: QaIdentity;
    organizationMember: QaIdentity;
    clientMember: QaIdentity;
  };
};

const enabled = process.env.E2E_PRODUCTION_AUTH_QA === "true";
const fixturePath = process.env.E2E_PRODUCTION_FIXTURE_PATH;
const fixture: QaFixture | null =
  enabled && fixturePath
    ? JSON.parse(readFileSync(fixturePath, "utf8"))
    : null;

test.describe("production authenticated QA", () => {
  test.skip(!enabled || !fixture, "Production authenticated QA fixture is required.");
  test.describe.configure({ mode: "serial" });

  test("Owner and inherited Organization Admin can administer the client", async ({
    page,
  }) => {
    for (const identity of [fixture!.roles.owner, fixture!.roles.admin]) {
      const errors = collectRuntimeErrors(page);
      await loginAs(page, identity);
      await page.goto(`/clients/${fixture!.workspaceId}/funnels`);
      await expect(page.getByRole("heading", { name: "Funis" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Novo funil/i })).toBeVisible();

      const navigation = page.getByRole("navigation", {
        name: "Navegação de Cliente",
      });
      await expect(navigation.getByText("Integrações")).toBeVisible();
      await expect(navigation.getByText("Equipe", { exact: true })).toBeVisible();
      await expect(navigation.getByText("Configurações")).toBeVisible();

      await page.goto(`/clients/${fixture!.workspaceId}/team`);
      await expect(page.getByRole("heading", { name: "Equipe" })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Convidar pessoa" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Convidar" })).toBeVisible();
      await expect(page.getByLabel(/token|secret|api key/i)).toHaveCount(0);

      await page.goto("/organization/team");
      await expect(
        page.getByRole("heading", { name: "Equipe da organização" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Convidar pessoa" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Convidar" })).toBeVisible();

      await page.goto(`/funnels/${fixture!.projectId}/activation`);
      await expect(
        page.getByRole("heading", {
          name: /Seu primeiro resultado chegou|Sua primeira conexão foi confirmada/i,
        }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());
    }
  });

  test("Organization Member and direct Client Member remain read-only", async ({
    page,
  }) => {
    for (const identity of [
      fixture!.roles.organizationMember,
      fixture!.roles.clientMember,
    ]) {
      const errors = collectRuntimeErrors(page);
      await loginAs(page, identity);
      await page.goto(`/clients/${fixture!.workspaceId}/funnels`);
      await expect(page.getByRole("heading", { name: "Funis" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Novo funil/i })).toHaveCount(0);

      const navigation = page.getByRole("navigation", {
        name: "Navegação de Cliente",
      });
      await expect(navigation.getByText("Funis")).toBeVisible();
      await expect(navigation.getByText("Integrações")).toHaveCount(0);
      await expect(navigation.getByText("Equipe", { exact: true })).toHaveCount(0);
      await expect(navigation.getByText("Configurações")).toHaveCount(0);

      for (const path of [
        `/clients/${fixture!.workspaceId}/integrations`,
        `/clients/${fixture!.workspaceId}/team`,
        `/clients/${fixture!.workspaceId}/settings`,
        `/clients/${fixture!.workspaceId}/funnels/new`,
        `/clients/${fixture!.workspaceId}/funnels/import`,
      ]) {
        await page.goto(path);
        await expect(page).toHaveURL(
          new RegExp(`/clients/${fixture!.workspaceId}/funnels$`),
        );
      }
      for (const path of ["/organization/team", "/organization/settings"]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/clients$/);
      }
      for (const destination of ["sources", "sharing"]) {
        await page.goto(`/funnels/${fixture!.projectId}/${destination}`);
        await expect(page).toHaveURL(
          new RegExp(`/dashboard\\?project=${fixture!.projectId}$`),
        );
      }

      await page.goto(`/dashboard?project=${fixture!.projectId}`);
      await expect(
        page.getByRole("navigation", { name: "Navegação de Dashboard" }),
      ).toBeVisible();
      await expect(page.getByText(/Visão Geral|Visao Geral/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Sincronizar agora/i })).toHaveCount(0);
      await expect(page.getByLabel(/token|secret|api key|webhook/i)).toHaveCount(0);

      await page.goto(`/health?client=${fixture!.workspaceId}`);
      await expect(
        page.getByRole("heading", { name: "Saúde das fontes" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Ver detalhe" })).toBeVisible();

      await page.goto(`/funnels/${fixture!.projectId}/health`);
      await expect(
        page.getByRole("heading", { name: /Saúde do funil/i }),
      ).toBeVisible();
      await expect(page.getByText("Ações operacionais")).toHaveCount(0);
      await expect(page.getByText("Diagnóstico avançado")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Sincronizar/i })).toHaveCount(0);
      expect(errors).toEqual([]);
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());
    }
  });

  test("dashboard filters and responsive shell work at launch viewports", async ({
    browser,
  }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 1000 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = collectRuntimeErrors(page);
      await loginAs(page, fixture!.roles.owner);
      await page.goto(`/dashboard?project=${fixture!.projectId}`);
      await expect(page.getByText(/Visão Geral|Visao Geral/).first()).toBeVisible();

      const accountFilter = page.getByRole("combobox", {
        name: /Conta de anúncio/i,
      });
      await expect(accountFilter).toBeVisible();
      await accountFilter.click();
      await page.getByText("qa-account-1", { exact: true }).click();
      await expect(accountFilter).toHaveAccessibleName(/1 selecionado/i);
      await page.keyboard.press("Escape");
      await expect(page.getByText(/Cobertura: vendas/i)).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        accessibility.violations.filter(
          (violation) =>
            violation.impact === "serious" ||
            violation.impact === "critical",
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    }
  });

  test("postponing Hotmart does not postpone the other checkout paths", async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await loginAs(page, fixture!.roles.owner);
    await page.goto(`/clients/${fixture!.workspaceId}/funnels/new`);
    await page.getByLabel("Nome").fill(`QA onboarding ${Date.now()}`);
    await page.getByRole("button", { name: "Fontes opcionais" }).click();
    await page.getByRole("button", { name: /Quick win Hotmart/i }).click();
    await page.getByRole("button", { name: "Fazer depois" }).first().click();

    await expect(
      page.getByRole("button", { name: /Hotmart.*Adiado para depois/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Histórico Hubla.*Ainda não configurado/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Gateway.*Ainda não configurado/i }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

async function loginAs(page: Page, identity: QaIdentity) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(identity.email);
  await page.locator("#password").fill(identity.password);
  const tokenResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/v1/token") &&
      response.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /^Entrar$/ }).click();
  const response = await tokenResponse;
  if (!response.ok()) {
    const body = await response.json().catch(() => ({})) as {
      code?: string;
      error_code?: string;
      message?: string;
    };
    throw new Error(
      `Auth token request failed (${response.status()}): ${
        body.error_code ?? body.code ?? body.message ?? "unknown"
      }`,
    );
  }
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/, { timeout: 30_000 });
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}
