import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const FUNNEL_ID = "44444444-4444-4444-8444-444444444444";
const AUTH_STORAGE_KEY = "sb-nztnctrkmfrgclrnflfa-auth-token";

async function mockAuthenticatedPlatform(page: Page) {
  await page.addInitScript(
    ({ storageKey, userId }) => {
      const encode = (value: object) =>
        btoa(JSON.stringify(value))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, "");
      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
      const accessToken = `${encode({ alg: "none", typ: "JWT" })}.${encode({
        aud: "authenticated",
        exp: expiresAt,
        sub: userId,
        email: "owner@infiniteprofit.test",
        role: "authenticated",
      })}.signature`;
      const user = {
        id: userId,
        aud: "authenticated",
        role: "authenticated",
        email: "owner@infiniteprofit.test",
        app_metadata: {},
        user_metadata: { full_name: "Owner Infinite" },
        created_at: new Date().toISOString(),
      };

      localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: "mock-refresh-token",
          expires_at: expiresAt,
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
      );
    },
    { storageKey: AUTH_STORAGE_KEY, userId: USER_ID },
  );

  await page.route("**/auth/v1/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "owner@infiniteprofit.test",
        app_metadata: {},
        user_metadata: { full_name: "Owner Infinite" },
        created_at: new Date().toISOString(),
      }),
    });
  });

  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop();
    let body: unknown = [];

    if (table === "workspace_members") {
      body = [
        {
          role: "owner",
          workspaces: {
            id: CLIENT_ID,
            name: "Loja Aurora",
            organization_id: ORGANIZATION_ID,
            organizations: { name: "Agência Infinite" },
          },
        },
      ];
    } else if (table === "organization_members") {
      body = [
        {
          role: "owner",
          organizations: {
            id: ORGANIZATION_ID,
            name: "Agência Infinite",
          },
        },
      ];
    } else if (table === "workspaces") {
      body = [
        {
          id: CLIENT_ID,
          name: "Loja Aurora",
          organization_id: ORGANIZATION_ID,
        },
      ];
    } else if (table === "projects") {
      body = url.searchParams.get("id") === `eq.${FUNNEL_ID}`
        ? {
            id: FUNNEL_ID,
            name: "Black Friday",
            file_name: null,
            csv_content: null,
            sheet_url: null,
            sync_token: null,
            last_synced_at: null,
            source: "api",
            workspace_id: CLIENT_ID,
          }
        : [
            {
              id: FUNNEL_ID,
              name: "Black Friday",
              file_name: null,
              source: "api",
              updated_at: "2026-07-17T12:00:00.000Z",
              created_at: "2026-07-17T12:00:00.000Z",
              workspace_id: CLIENT_ID,
            },
          ];
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify(body),
    });
  });

  await page.route("**/rest/v1/rpc/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
}

test.describe("contextual navigation shell", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedPlatform(page);
  });

  test("keeps client administration scoped and the account menu at the sidebar footer", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chrome", "Desktop sidebar behavior.");
    await page.goto(`/clients/${CLIENT_ID}/funnels`);

    const navigation = page.getByRole("navigation", {
      name: "Navegação de Cliente",
    });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("button")).toHaveCount(4);
    await expect(navigation.getByText("Integrações")).toBeVisible();
    await expect(navigation.getByText("Visão geral")).toHaveCount(0);

    const accountTrigger = page
      .locator("aside")
      .getByRole("button", { name: "Abrir menu da conta" });
    await expect(accountTrigger).toBeVisible();
    await accountTrigger.click();
    await expect(page.getByText("Equipe da organização")).toBeVisible();
    await expect(page.getByText("Configurações gerais")).toBeVisible();
  });

  test("renders only the nine Dashboard destinations", async ({ page }, testInfo) => {
    await page.goto(`/dashboard?project=${FUNNEL_ID}`);

    if (testInfo.project.name === "mobile-chrome") {
      await page
        .getByRole("button", { name: "Abrir navegação do Dashboard" })
        .click();
    }
    const navigation = page.getByRole("navigation", {
      name: "Navegação de Dashboard",
    });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("button")).toHaveCount(9);
    await expect(navigation.getByText("Visão geral")).toBeVisible();
    await expect(navigation.getByText("Clientes")).toHaveCount(0);
    await expect(navigation.getByText("Fontes de dados")).toHaveCount(0);

    if (testInfo.project.name === "mobile-chrome") {
      await page.keyboard.press("Escape");
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      ),
    ).toEqual([]);
  });

  test("uses horizontal scoped navigation without overflow on mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/clients/${CLIENT_ID}/funnels`);

    await expect(
      page.getByRole("navigation", { name: "Navegação de Cliente" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Abrir menu da conta" }),
    ).toBeVisible();
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });
});
