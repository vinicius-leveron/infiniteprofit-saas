import { expect, type Page, type TestInfo } from "@playwright/test";

export const qaProjectId = process.env.E2E_PROJECT_ID;
export const qaPublicShareToken = process.env.E2E_PUBLIC_SHARE_TOKEN;
export const qaEmail = process.env.E2E_EMAIL;
export const qaPassword = process.env.E2E_PASSWORD;

export function hasAuthEnv() {
  return Boolean(qaEmail && qaPassword);
}

export function hasProjectEnv() {
  return Boolean(qaProjectId);
}

export function hasPublicShareEnv() {
  return Boolean(qaPublicShareToken);
}

export async function login(page: Page) {
  if (!qaEmail || !qaPassword) {
    throw new Error("E2E_EMAIL and E2E_PASSWORD are required for authenticated E2E tests.");
  }

  await page.goto("/auth");
  await page.getByLabel("Email").fill(qaEmail);
  await page.getByLabel("Senha").fill(qaPassword);
  await page.getByRole("button", { name: /^Entrar$/ }).click();
  await expect(page).toHaveURL(
    /\/(dashboard|clients(?:\/[^/]+\/funnels)?|welcome)(\?.*)?$/,
  );
}

export async function expectNoConsoleErrors(page: Page, testInfo: TestInfo) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await testInfo.attach("console-errors", {
    body: errors.length ? errors.join("\n") : "none",
    contentType: "text/plain",
  });

  expect(errors).toEqual([]);
}

export async function assertPrivateRouteRedirects(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth\?next=/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
}
