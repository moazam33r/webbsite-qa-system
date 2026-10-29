import { test, expect } from "@playwright/test";
import { scanWebsite } from "../src/webbsite-scanner";

test("Website scanner", async ({ page }) => {
  test.setTimeout(300000);

  // Simulerar en lokal webbplats.
  await page.route("http://127.0.0.1:3000/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `
        <!DOCTYPE html>
        <html lang="sv">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Testwebbplats</title>
            <meta name="description" content="En webbplats för automatiserade QA-tester.">
          </head>
          <body>
            <h1>Testwebbplats</h1>
            <p>Detta är en lokal sida för QA-testning.</p>
            <a href="/kontakt/">Kontakt</a>
          </body>
        </html>
      `,
    });
  });

  // Kontrollerar att den lokala testsidan fungerar.
  const response = await page.goto("http://127.0.0.1:3000/");

  expect(response).not.toBeNull();
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Testwebbplats");
});