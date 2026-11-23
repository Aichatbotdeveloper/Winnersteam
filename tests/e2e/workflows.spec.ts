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
  for (const t of ["prospecting", "goals", "development", "tasks", "accountability"]) {
    for (const period of ["daily", "weekly", "monthly"]) {
      const res = await page.request.get(`/api/reports/export?type=${t}&period=${period}&format=csv`);
      expect(res.status(), `${t}/${period}`).toBe(200);
    }
  }
  const csv = await (await page.request.get("/api/reports/export?type=prospecting&period=weekly&format=csv")).text();
  expect(csv).toContain("Achievement %");
});

test("staff pages render without errors", async ({ page }) => {
  await login(page, "superadmin@demo.winners-team.local", DEMO_PASSWORD);
  for (const p of ["/super-admin", "/super-admin/analytics", "/settings", "/settings/accountability", "/audit-logs", "/accountability"]) {
    await page.goto(p);
    await expectNoAppError(page);
  }
});

test("public website: signed-out visitors see the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Where ambition becomes achievement.");
  await expect(page.getByRole("heading", { name: "Mr Gabriel Samuel" })).toBeVisible();
  await page.getByRole("link", { name: "Join the team" }).first().click();
  await expect(page).toHaveURL(/\/register$/);
  for (const p of ["/privacy", "/terms"]) expect((await page.request.get(p)).status()).toBe(200);
});

test("public website: cookie banner remembers the choice and can be reopened", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByRole("region", { name: "Cookie notice" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Essential only" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(banner).toBeHidden();
  await page.getByRole("button", { name: "Cookie settings" }).click();
  await expect(banner).toBeVisible();
  await banner.getByRole("link", { name: "Read more" }).click();
  await expect(page).toHaveURL(/\/privacy#cookies$/);
  await expect(page.getByRole("heading", { name: "Cookies" })).toBeVisible();
});

test("light/dark toggle applies immediately and is remembered", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /Change theme/ }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  // "System" follows the device setting.
  await page.getByRole("button", { name: /Change theme/ }).click();
  await page.getByRole("menuitemradio", { name: "System" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "dark");
});
