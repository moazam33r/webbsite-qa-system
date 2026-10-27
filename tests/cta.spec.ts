import { test, expect } from "@playwright/test";

import { checkCTA } from "../src/checks/cta";
import http from "http";
import { AddressInfo } from "net";
import { UrlVerifier, isSafeToRequest } from "../src/checks/cta";

test("CTA-test hittar fungerande och trasiga CTA-länkar", async ({ page }) => {

  // Mockar startsidan så att testet inte behöver använda en riktig webbplats.
  await page.route(
    "https://qa-test.local/",
    async (route) => {

      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `
          <html>
            <body>

              <a
                class="button"
                href="/fungerar/"
              >
                Kontakta oss
              </a>

              <a href="/vanlig-lank/">
                Vanlig länk
              </a>

              <a
                class="cta"
                href="/trasig/"
              >
                Begar offert
              </a>

            </body>
          </html>
        `,
      });
    }
  );

  // Sparar den riktiga GET-funktionen så att
  // övriga anrop kan hanteras normalt.
  const originalGet = page.request.get.bind(
    page.request
  );

  // Mockar HTTP-svaren för CTA-länkarna.
  page.request.get = async (url: string) => {

    // Fungerande CTA.
    if (url.includes("/fungerar/")) {

      return {
        status: () => 200,
      } as any;
    }

    // Trasig CTA.
    if (url.includes("/trasig/")) {

      return {
        status: () => 404,
      } as any;
    }

    // Övriga länkar använder den riktiga funktionen.
    return originalGet(url);
  };

  // Kör CTA-kontrollen och sparar resultatet.
  const result = await checkCTA(
    page,
    ["https://qa-test.local/"]
  );

  // Kontrollerar att resultatet innehåller
  // antal fungerande och trasiga CTA-länkar.
  expect(result).toHaveProperty("passed");
  expect(result).toHaveProperty("failed");

  // Kontrollerar att värdena är nummer.
  expect(typeof result.passed).toBe("number");
  expect(typeof result.failed).toBe("number");

  // Kontrollerar att räknarna inte kan vara negativa.
  expect(result.passed).toBeGreaterThanOrEqual(0);
  expect(result.failed).toBeGreaterThanOrEqual(0);

  // Testet ska hitta exakt en fungerande CTA
  // och exakt en trasig CTA i vår mockade sida.
  expect(result.passed).toBe(1);
  expect(result.failed).toBe(1);
});

// =========================================================
// LÄNKVERIFIERING I CTA-KONTROLLEN (lokal testserver)
// =========================================================

// Lokal webbserver som beter sig som riktiga sajter:
//   /ok       fungerar
//   /gone     riktig 404
//   /bot      403 för automatiska anrop, fungerar i webbläsare
//   /blocked  403 alltid (kan inte verifieras automatiskt)
//   /rate     429 de två första gångerna, sedan 200
//   /hits     räknar hur många gånger den anropas
//   /wp-login.php  får aldrig anropas
let server: http.Server;
let base = "";
const hits: Record<string, number> = {};

test.beforeAll(async () => {

  server = http.createServer((req, res) => {

    const path = (req.url ?? "/").split("?")[0];
    hits[path] = (hits[path] ?? 0) + 1;

    const html = (body: string) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html><body>${body}</body></html>`);
    };

    if (path === "/ok" || path === "/hits") return html("ok");

    if (path === "/gone") {
      res.writeHead(404);
      return res.end("not found");
    }

    if (path === "/bot") {
      if (req.headers["sec-fetch-dest"] === "document") return html("bot ok");
      res.writeHead(403);
      return res.end("forbidden");
    }

    if (path === "/blocked") {
      res.writeHead(403);
      return res.end("forbidden");
    }

    if (path === "/rate") {
      if (hits[path] <= 2) {
        res.writeHead(429, { "Retry-After": "0" });
        return res.end("slow down");
      }
      return html("rate ok");
    }

    if (path === "/start") {
      return html(`
        <nav>
          <a href="/ok">Ok</a>
          <a href="/gone">Gone</a>
          <a href="/bot">Bot</a>
          <a href="/blocked">Blocked</a>
          <a href="/rate">Rate</a>
          <a href="/hits">Hits</a>
          <a href="/hits#x">Hits igen</a>
          <a href="/wp-login.php">Login</a>
          <a href="mailto:a@b.se">Mail</a>
          <a href="tel:0812345678">Tel</a>
          <a href="http://[bad">Ogiltig</a>
        </nav>
        <a class="btn" href="/ok">Kontakta oss</a>
        <a class="btn" href="/gone">Trasig knapp</a>
        <a class="cta" href="/blocked">Skyddad knapp</a>
      `);
    }

    if (path === "/start2") {
      return html(`<a class="btn" href="/gone">Trasig knapp</a><a class="btn" href="/ok">Kontakta oss</a>`);
    }

    return html("start");
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve)
  );

  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server.close();
});

test.beforeEach(() => {
  for (const key of Object.keys(hits)) delete hits[key];
});

const fast = { retryDelayMs: 30, minIntervalMs: 0 };

test("verifierare: fungerande länk är ok", async ({ page }) => {
  const v = new UrlVerifier(page, fast);
  expect((await v.verify(`${base}/ok`)).verdict).toBe("ok");
});

test("verifierare: riktig 404 bekräftas som trasig", async ({ page }) => {

  const v = new UrlVerifier(page, fast);
  const r = await v.verify(`${base}/gone`);

  expect(r.verdict).toBe("broken");
  expect(r.status).toBe(404);
  // Bekräftas med ett andra anrop.
  expect(hits["/gone"]).toBeGreaterThanOrEqual(2);
});

test("verifierare: 403 för bots men ok i webbläsare räknas som fungerande", async ({ page }) => {

  const v = new UrlVerifier(page, fast);
  const r = await v.verify(`${base}/bot`);

  expect(r.verdict).toBe("ok");
  expect(r.reason).toContain("webbläsare");
});

test("verifierare: 403 överallt är 'unverified', inte trasig", async ({ page }) => {

  const v = new UrlVerifier(page, fast);
  const r = await v.verify(`${base}/blocked`);

  expect(r.verdict).toBe("unverified");
  expect(r.status).toBe(403);
});

test("verifierare: tillfällig 429 klaras med nytt försök", async ({ page }) => {

  const v = new UrlVerifier(page, fast);
  const r = await v.verify(`${base}/rate`);

  expect(r.verdict).toBe("ok");
});

test("verifierare: samma adress anropas bara en gång", async ({ page }) => {

  const v = new UrlVerifier(page, fast);

  await v.verify(`${base}/hits`);
  await v.verify(`${base}/hits`);
  await v.verify(`${base}/hits#annat`);

  expect(hits["/hits"]).toBe(1);
});

test("verifierare: farliga länkar anropas aldrig", async ({ page }) => {

  const v = new UrlVerifier(page, fast);
  const r = await v.verify(`${base}/wp-login.php`);

  expect(r.verdict).toBe("skipped");
  expect(hits["/wp-login.php"]).toBeUndefined();

  expect(isSafeToRequest("https://x.se/?add-to-cart=5").safe).toBe(false);
  expect(isSafeToRequest("https://x.se/logout/").safe).toBe(false);
  expect(isSafeToRequest("https://x.se/kontakt/").safe).toBe(true);
});

test("verifierare: domän som inte finns är trasig", async ({ page }) => {

  const v = new UrlVerifier(page, fast);
  const r = await v.verify("http://detta-finns-inte.invalid/");

  expect(r.verdict).toBe("broken");
});

test("CTA: samma destination på flera sidor räknas och kontrolleras en gång", async ({ page }) => {

  const v = new UrlVerifier(page, fast);

  const result = await checkCTA(
    page,
    [`${base}/start`, `${base}/start2`],
    v
  );

  expect(result.failed).toBe(1);
  expect(result.failures[0].url).toBe(`${base}/gone`);
  expect(result.failures[0].pages.length).toBe(2);

  expect(result.unverified).toBe(1);
  expect(result.passed).toBe(1);
});