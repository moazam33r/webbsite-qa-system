import { test, expect } from "@playwright/test";

import { checkPages } from "../src/checks/pages";
import { checkNavigation } from "../src/checks/navigation";
import { UrlVerifier } from "../src/checks/cta";
import http from "http";
import { AddressInfo } from "net";

test("Navigation check", async ({ page }) => {

  // Webbplatsen vi testar
  const url = "https://digitalkontakt.se/";

  // Hittar automatiskt webbplatsens sidor
  const pageResult = await checkPages(
    page,
    url
  );

  // Hämtar sidorna som hittades
  const pages = pageResult.links;

  // Kör navigationskontrollen och sparar resultatet
  const result = await checkNavigation(
    page,
    url,
    pages
  );

  // Kontrollerar att resultatet innehåller
  // antal fungerande och trasiga navigationer
  expect(result).toHaveProperty("passed");
  expect(result).toHaveProperty("failed");

  // Kontrollerar att värdena är nummer
  expect(typeof result.passed).toBe("number");
  expect(typeof result.failed).toBe("number");

  // Kontrollerar att räknarna inte kan vara negativa
  expect(result.passed).toBeGreaterThanOrEqual(0);
  expect(result.failed).toBeGreaterThanOrEqual(0);

  // Minst en navigation ska ha kontrollerats
  expect(
    result.passed + result.failed
  ).toBeGreaterThan(0);

  // Ett trasigt navigationsmål ska göra testet rött
  expect(result.failed).toBe(0);
});

// =========================================================
// NAVIGATIONSVERIFIERING (lokal testserver)
// =========================================================
//   /ok       fungerar
//   /gone     riktig 404
//   /bot      403 för automatiska anrop, fungerar i webbläsare
//   /blocked  403 alltid (kan inte verifieras automatiskt)
//   /wp-login.php  får aldrig anropas

test.describe("navigationsverifiering", () => {

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

      if (path === "/") {
        return html(`
          <a href="/ok">ok</a>
          <a href="/ok#del">ok igen</a>
          <a href="/gone">borta</a>
          <a href="/bot">bot</a>
          <a href="/blocked">blockerad</a>
          <a href="/wp-login.php">login</a>
          <a href="https://extern.invalid/x">extern</a>
          <a href="mailto:a@b.se">mail</a>
          <a href="tel:0701234567">tel</a>
          <a href="javascript:void(0)">js</a>
          <a href="#topp">anchor</a>`);
      }

      if (path === "/second") {
        return html(`<a href="/ok">ok</a> <a href="/bot">bot</a> <a href="/gone">borta</a>`);
      }

      if (path === "/ok") return html("ok");

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

      res.writeHead(200);
      res.end("x");
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );

    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("fungerande, trasiga och ej verifierbara länkar skiljs åt", async ({ page }) => {

    test.setTimeout(120000);

    const result = await checkNavigation(
      page,
      `${base}/`,
      [`${base}/`, `${base}/second`],
      new UrlVerifier(page, { retryDelayMs: 100, minIntervalMs: 0 })
    );

    // /ok, /bot och startsidan (via #-länken) fungerar, /gone är
    // bekräftat trasig, /blocked kan inte verifieras. Samma länk
    // räknas en gång.
    expect(result.passed).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.unverified).toBe(1);

    expect(result.failures[0].url).toBe(`${base}/gone`);
    expect(result.failures[0].pages.length).toBe(2);
    expect(result.unverifiedLinks[0].url).toBe(`${base}/blocked`);

    // Samma adress anropas inte om och om igen.
    expect(hits["/ok"]).toBe(1);

    // Adresser som kan ha sidoeffekter anropas aldrig.
    expect(hits["/wp-login.php"]).toBeUndefined();
  });
});