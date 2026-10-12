import { test, expect } from "@playwright/test";

test("Playwright fungerar", async ({ page }) => {
  // Simulerar en webbplats utan externa nätverksanrop.
  await page.route("https://qa-test.local/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `
        <!DOCTYPE html>
        <html lang="sv">
          <head>
            <meta charset="UTF-8">
            <title>Testwebbplats</title>
          </head>
          <body>
            <h1>Playwright fungerar</h1>
          </body>
        </html>
      `,
    });
  });

  // Öppnar den simulerade webbplatsen.
  const response = await page.goto("https://qa-test.local/");

  // Kontrollerar att sidan svarar korrekt.
  expect(response).not.toBeNull();
  expect(response?.status()).toBe(200);

  // Kontrollerar att rätt sida öppnades.
  await expect(page).toHaveURL("https://qa-test.local/");

  // Kontrollerar sidans titel och innehåll.
  await expect(page).toHaveTitle("Testwebbplats");
  await expect(
    page.getByRole("heading", { name: "Playwright fungerar" })
  ).toBeVisible();
});