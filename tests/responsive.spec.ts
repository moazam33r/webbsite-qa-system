import { test, expect } from "@playwright/test";
import { checkResponsive } from "../src/checks/responsive";

test("Responsive check", async ({ page }) => {
  // Simulerar en webbplats för testet.
  await page.route("https://qa-test.local/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `
        <!DOCTYPE html>
        <html lang="sv">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Responsiv testwebbplats</title>
            <style>
              * {
                box-sizing: border-box;
              }

              body {
                margin: 0;
                font-family: Arial, sans-serif;
              }

              main {
                width: 100%;
                max-width: 900px;
                margin: 0 auto;
                padding: 16px;
              }

              img {
                max-width: 100%;
                height: auto;
              }
            </style>
          </head>
          <body>
            <main>
              <h1>Responsiv testwebbplats</h1>
              <p>Den här sidan används för att testa mobilvyn.</p>
            </main>
          </body>
        </html>
      `,
    });
  });

  // Kör responsivitetskontrollen på den simulerade sidan.
  const result = await checkResponsive(page, [
    "https://qa-test.local/",
  ]);

  // Kontrollerar att resultatet har rätt struktur.
  expect(result).toHaveProperty("passed");
  expect(result).toHaveProperty("failed");

  expect(typeof result.passed).toBe("number");
  expect(typeof result.failed).toBe("number");

  // Säkerställer att räknarna inte är negativa.
  expect(result.passed).toBeGreaterThanOrEqual(0);
  expect(result.failed).toBeGreaterThanOrEqual(0);

  // Minst en sida ska ha kontrollerats.
  expect(result.passed + result.failed).toBeGreaterThan(0);

  // Testet ska misslyckas om sidan har responsivitetsproblem.
  expect(result.failed).toBe(0);
});