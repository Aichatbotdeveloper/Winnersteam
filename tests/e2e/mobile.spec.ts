import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("mobile: navigation drawer, dashboard and wheel page fit the screen", async ({ page }) => {
  await login(page, "member010@demo.winners-team.local");
  await page.goto("/dashboard");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Accountability & Spin Wheel" }).click();
  await expect(page).toHaveURL(/accountability/);
  await expect(page.getByRole("heading", { name: "Accountability & Spin Wheel" })).toBeVisible();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow2).toBeLessThanOrEqual(1);
});
