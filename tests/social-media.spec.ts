import { test, expect } from "@playwright/test";

import { checkSocialMedia } from "../src/checks/social-media";

// Profilsidor som liknar vad plattformarna visar.
const profilePage = (title: string, body = "") => `
  <html><head><meta charset="UTF-8">
  <meta property="og:title" content="${title}">
  <title>${title}</title></head>
  <body>${body}</body></html>`;

test("Sociala medier: flera bevis styr om kontot matchar, inte bara namnet", async ({ page }) => {

  await page.route("https://qa-test.local/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `
        <html><head><meta charset="UTF-8">
        <title>Test Företag | Hantverk</title></head>
        <body>
          <a href="tel:+46701234567">Ring</a>
          <a href="mailto:info@qa-test.local">Mejla</a>

          <!-- 1. Namnet i adressen matchar -->
          <a href="https://facebook.com/testforetag">Facebook</a>

          <!-- 2. Annat kontonamn, men profilen länkar tillbaka -->
          <a href="https://instagram.com/kontoetta">Instagram</a>

          <!-- 3. Annat kontonamn, men samma telefonnummer på profilen -->
          <a href="https://tiktok.com/@kontotva">TikTok</a>

          <!-- 4. Inloggningsvägg: kan inte avgöras -->
          <a href="https://linkedin.com/company/okantforetag">LinkedIn</a>

          <!-- 5. Profilen finns inte -->
          <a href="https://youtube.com/@borttagen">YouTube</a>

          <!-- 6. Delningsknapp ska inte räknas som profil -->
          <a href="https://x.com/intent/tweet?url=https://qa-test.local/">Dela</a>
        </body></html>`,
    });
  });

  await page.route("https://instagram.com/kontoetta", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: profilePage(
        "Helt annat namn (@kontoetta) • Instagram",
        `<a href="https://l.instagram.com/?u=https%3A%2F%2Fqa-test.local%2F">länk</a>`
      ),
    })
  );

  await page.route("https://tiktok.com/@kontotva", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: profilePage("Hantverkarna", "<p>Ring 070-123 45 67</p>"),
    })
  );

  await page.route("https://linkedin.com/company/okantforetag", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: profilePage("Logga in | LinkedIn"),
    })
  );

  await page.route("https://youtube.com/@borttagen", (route) =>
    route.fulfill({
      status: 404,
      contentType: "text/html",
      body: profilePage("404"),
    })
  );

  // Övriga adresser (t.ex. facebook.com/testforetag) behöver inte öppnas.
  await page.route(
    (url) => /facebook\.com|x\.com/.test(url.hostname),
    (route) => route.abort()
  );

  const result = await checkSocialMedia(
    page,
    ["https://qa-test.local/"],
    "https://qa-test.local/"
  );

  const matched = (platform: string) =>
    result.found.find((item) => item.platform === platform);

  // 1. Namnet i adressen.
  expect(matched("Facebook")).toBeTruthy();

  // 2. Länk tillbaka.
  expect(matched("Instagram")?.reason).toMatch(/länkar till webbplatsen/);

  // 3. Samma telefonnummer.
  expect(matched("TikTok")?.reason).toMatch(/telefonnummer/);

  // 4. Inloggningsvägg: kräver manuell verifiering, inte fel.
  expect(
    result.unverified.some((item) => item.platform === "LinkedIn")
  ).toBe(true);
  expect(
    result.failed.some((item) => item.platform === "LinkedIn")
  ).toBe(false);

  // 5. Profil som inte finns är det enda som blir fel.
  expect(result.failed.map((item) => item.platform)).toEqual(["YouTube"]);

  // 6. Delningslänkar räknas inte.
  expect(
    [...result.found, ...result.failed, ...result.unverified].some(
      (item) => item.platform === "X/Twitter"
    )
  ).toBe(false);
});

test("Sociala medier: läsbar profil utan koppling kräver manuell verifiering, inte fel", async ({ page }) => {

  await page.route("https://qa-test.local/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<html><head><meta charset="UTF-8"><title>Test Företag</title></head>
        <body><a href="https://instagram.com/heltannatforetag">Instagram</a></body></html>`,
    })
  );

  await page.route("https://instagram.com/heltannatforetag", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: profilePage("Något annat (@heltannatforetag) • Instagram", "<p>Vi säljer bilar</p>"),
    })
  );

  const result = await checkSocialMedia(
    page,
    ["https://qa-test.local/"],
    "https://qa-test.local/"
  );

  expect(result.failed).toHaveLength(0);
  expect(result.found).toHaveLength(0);
  expect(result.unverified).toHaveLength(1);
  expect(result.unverified[0].message).toMatch(/länkar inte till webbplatsen/);
});