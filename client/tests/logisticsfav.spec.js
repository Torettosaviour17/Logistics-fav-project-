import { test, expect } from "@playwright/test";

test.describe("LogisticsFav live application", () => {
  test("loads the public app and keeps core routes working", async ({ page }) => {
    const consoleErrors = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/LogisticsFav/i);
    await expect(page.getByRole("heading", { name: /Move packages/i })).toBeVisible();

    await page.getByRole("link", { name: /Track/i }).last().click();
    await expect(page).toHaveURL(/#\/track$/);
    await expect(page.getByRole("heading", { name: /Where is your package/i })).toBeVisible();

    await page.goto("/#/this-route-does-not-exist");
    await expect(page.getByRole("heading", { name: /Page not found/i })).toBeVisible();

    expect(consoleErrors, "browser console errors").toEqual([]);
  });

  test("connects frontend to backend and completes customer shipment flow", async ({ page, request }) => {
    const health = await request.get("https://logisticsfav-api.onrender.com/api/health");
    expect(health.ok()).toBeTruthy();

    const stamp = Date.now();
    const email = "e2e+" + stamp + "@logisticsfav.demo";
    const password = "LogisticsFavE2E2026!";
    
    await page.goto("/#/register");
    await page.locator("#auth-full-name").fill("Playwright Customer");
    await page.locator("#auth-email").fill(email);
    await page.locator("#auth-phone").fill("08000000000");
    await page.locator("#auth-password").fill(password);
    await page.getByRole("button", { name: /Create account/i }).click();

    await expect(page).toHaveURL(/#\/dashboard$/);
    await expect(page.getByRole("heading", { name: /Welcome, Playwright/i })).toBeVisible();

    await page.getByRole("link", { name: /New shipment/i }).click();
    await expect(page).toHaveURL(/#\/shipments\/new$/);

    await page.getByLabel("Sender name").fill("Playwright Sender");
    await page.getByLabel("Sender phone").fill("08111111111");
    await page.getByLabel("Pickup address").fill("Uyo, Akwa Ibom");
    await page.getByLabel("Receiver name").fill("Playwright Receiver");
    await page.getByLabel("Receiver phone").fill("08222222222");
    await page.getByLabel("Destination address").fill("Abuja, Nigeria");
    await page.getByLabel("Description").fill("E2E test package");
    await page.getByRole("button", { name: /Create shipment/i }).click();

    await expect(page).toHaveURL(/#\/shipments\//);
    const tracking = page.locator("p.text-xs.font-bold.text-teal-700").first();
    await expect(tracking).toBeVisible();
    const trackingNumber = await tracking.textContent();
    expect(trackingNumber).toMatch(/LF-/);

    await page.goto("/#/track/" + encodeURIComponent(trackingNumber.trim()));
    await expect(page.getByRole("heading", { name: /Playwright Receiver/i })).toBeVisible();
    await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: /Playwright Receiver/i })).toBeVisible();
  });
});
