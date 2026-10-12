import { test, expect } from "@playwright/test";
import { createServer, Server } from "http";
import { checkLinks } from "../src/checks/links";

test("Links check", async ({ page }) => {
  let server: Server;

  // Startar en lokal testserver utan externa nätverksanrop.
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (req.url === "/") {
      res.statusCode = 200;
      res.end(`
        <!DOCTYPE html>
        <html lang="sv">
          <head><title>Startsida</title></head>
          <body>
            <h1>Välkommen</h1>
            <a href="/kontakt/">Kontakt</a>
            <a href="/extern/">Extern webbplats</a>
            <a href="tel:+46701234567">Ring oss</a>
            <a href="tel:070abc123">Ogiltigt telefonnummer</a>
          </body>
        </html>
      `);
      return;
    }

    if (req.url === "/kontakt/") {
      res.statusCode = 200;
      res.end(`
        <!DOCTYPE html>
        <html lang="sv">
          <head><title>Kontakt</title></head>
          <body>
            <h1>Kontakta oss</h1>
            <p>Kontakta oss via telefon eller e-post.</p>
          </body>
        </html>
      `);
      return;
    }

    if (req.url === "/extern/") {
      res.statusCode = 200;
      res.end("<html><head><title>Extern sida</title></head><body>Extern test</body></html>");
      return;
    }

    res.statusCode = 404;
    res.end("<h1>Sidan hittades inte</h1>");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Kunde inte starta den lokala testservern");
    }

    const baseUrl = `http://127.0.0.1:${address.port}/`;
    const contactUrl = `${baseUrl}kontakt/`;
    const externalUrl = `${baseUrl}extern/`;

    await page.goto(baseUrl);

    const result = await checkLinks(page, baseUrl, [
      baseUrl,
      contactUrl,
    ]);

    expect(result).toHaveProperty("internalPassed");
    expect(result).toHaveProperty("internalFailed");
    expect(result).toHaveProperty("externalPassed");
    expect(result).toHaveProperty("externalFailed");
    expect(result).toHaveProperty("linkFailures");
    expect(result).toHaveProperty("phoneLinks");
    expect(result).toHaveProperty("intentFailures");
    expect(result).toHaveProperty("intentFailed");

    // Kontaktlänken ska fungera.
    expect(result.internalPassed).toBeGreaterThan(0);
    expect(result.internalFailed).toBe(0);

    // Den externa länken testas separat i ett eget anrop.
    const externalResponse = await page.request.get(externalUrl);
    expect(externalResponse.status()).toBe(200);

    // Telefonlänkarna ska valideras.
    expect(result.phoneLinks).toHaveLength(2);
    expect(result.phoneLinks.some((phone) => phone.valid)).toBe(true);
    expect(result.phoneLinks.some((phone) => !phone.valid)).toBe(true);

    // Link Intent-resultatet ska ha en giltig struktur.
    expect(Array.isArray(result.intentFailures)).toBe(true);
    expect(result.intentFailed).toBe(result.intentFailures.length);

    console.log("\nLink check testresultat:");
    console.log(`Interna länkar godkända: ${result.internalPassed}`);
    console.log(`Interna länkar underkända: ${result.internalFailed}`);
    console.log(`Telefonlänkar kontrollerade: ${result.phoneLinks.length}`);
    console.log(`Link Intent-varningar: ${result.intentFailed}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});