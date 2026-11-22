import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "Demo-Password-2026!";
export const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export async function login(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
}

/** Fetch the latest e-mail link for an address from the local Mailpit inbox. */
export async function latestEmailLink(to: string) {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const list = (await res.json()) as { messages?: { ID: string }[] };
    if (list.messages?.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0]!.ID}`)).json()) as { Text: string; HTML: string };
      const m = (msg.HTML || msg.Text).match(/https?:\/\/[^\s"'<>]+(?:verify|auth\/callback\?token_hash)[^\s"'<>]+/);
      if (m) return m[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No e-mail for ${to}`);
}

export async function expectNoAppError(page: Page) {
  await expect(page.getByText(/Something went wrong|Application error/)).toHaveCount(0);
}
