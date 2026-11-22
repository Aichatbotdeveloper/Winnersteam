import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, expectNoAppError, latestEmailLink, login } from "./helpers";

test.describe.configure({ mode: "serial" });
const email = `e2e.${Date.now().toString(36)}@example.com`;
const password = "E2e-Password-12345";

test("registration → e-mail verification → pending approval", async ({ page }) => {
  await page.goto("/register");
  await page.fill("input[name=full_name]", "E2E Applicant");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=job_title]", "Analyst");
  await page.fill("input[name=password]", password);
  await page.fill("input[name=confirm]", password);
  await page.check("input[name=consent]");
  await page.click("button[type=submit]");
  await page.waitForURL(/verify-email/);
  await page.goto(await latestEmailLink(email));
  await page.waitForURL(/pending-approval/);
  await expect(page.getByText("PENDING APPROVAL")).toBeVisible();
  await expect(page.getByText("E-mail verified")).toBeVisible();
});

test("pending users cannot open the workspace", async ({ page }) => {
  await login(page, email, password).catch(() => {});
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/pending-approval/);
});

test("Super Admin approves and assigns; member signs in and sees a motivational quote", async ({ page, browser }) => {
  await login(page, "superadmin@demo.winners-team.local");
  await page.goto("/super-admin/registrations");
  const row = page.locator("tr", { hasText: email });
  await row.locator("select").selectOption({ index: 1 });
  await row.getByRole("button", { name: "Approve & assign" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Registration approved" })).toBeVisible();

  const ctx = await browser.newContext();
  const member = await ctx.newPage();
  await login(member, email, password);
  await expect(member).toHaveURL(/\/dashboard\?welcome=1/);
  await expect(member.getByRole("dialog").getByText(/Welcome back/)).toBeVisible();
  await member.getByRole("button", { name: "Let's get to work" }).click();

  // Create and complete a task — the score updates live.
  await member.getByRole("button", { name: "Add New Task" }).click();
  await member.getByRole("dialog").locator("input[name=title]").fill("E2E first task");
  await member.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await expect(member.getByText("E2E first task")).toBeVisible();
  await member.getByRole("button", { name: 'Mark "E2E first task" completed' }).click();
  await expect(member.getByText("1/1 tasks completed")).toBeVisible();
  await ctx.close();
});

test("role boundaries are enforced on direct URLs", async ({ page }) => {
  await login(page, "admin001@demo.winners-team.local");
  await page.goto("/super-admin/users");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/settings/accountability");
  await expect(page).toHaveURL(/\/admin$/);
  const res = await page.request.get("/api/cron/daily");
  expect(res.status()).toBe(401);
});

test("LEX answers platform questions (knowledge base mode without AI key)", async ({ page }) => {
  await login(page, "member003@demo.winners-team.local");
  await page.goto("/lex");
  await page.getByRole("button", { name: "How is my performance calculated?" }).click();
  await expect(page.getByText(/weighted average of five categories/)).toBeVisible({ timeout: 20_000 });
});

test("reports export as CSV, Excel and PDF", async ({ page }) => {
  await login(page, "admin001@demo.winners-team.local");
  for (const f of ["csv", "xlsx", "pdf"]) {
    const res = await page.request.get(`/api/reports/export?type=performance&period=weekly&format=${f}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain(`.${f}`);
    expect((await res.body()).length).toBeGreaterThan(100);
  }
});

test("staff pages render without errors", async ({ page }) => {
  await login(page, "superadmin@demo.winners-team.local", DEMO_PASSWORD);
  for (const p of ["/super-admin", "/super-admin/analytics", "/settings", "/settings/accountability", "/audit-logs", "/accountability"]) {
    await page.goto(p);
    await expectNoAppError(page);
  }
});
