
import { Page } from "@playwright/test";

// Kontrollerar grundläggande SEO på alla sidor på webbplatsen.
// Skiljer mellan viktiga förbättringar, mindre rekommendationer
// och resultat som behöver granskas manuellt.

export async function checkSEO(
  page: Page,
  pages: string[]
) {
  // Godkända kontroller.
  const passed: string[] = [];

  // Viktiga SEO- och tillgänglighetsförbättringar.
  // Dessa bör granskas och prioriteras.
  const warnings: string[] = [];

  // Mindre rekommendationer som inte automatiskt är fel.
  const recommendations: string[] = [];

  // Fynd som inte säkert kan klassificeras som problem.
  const manualReview: string[] = [];

  // Tekniska fel där kontrollen inte kunde genomföras.
  const failed: string[] = [];

  // Undviker att samma URL kontrolleras flera gånger.
  const checkedPages = new Set<string>();

  for (const url of pages) {
    if (checkedPages.has(url)) {
      continue;
    }

    checkedPages.add(url);

    try {
      // Öppnar sidan och väntar på att HTML-dokumentet laddas.
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // -----------------------------------------------------
      // TITLE
      // -----------------------------------------------------

      const title = await page.title();

      if (title.trim()) {
        passed.push(`${url} - Title found`);
      } else {
        warnings.push(`${url} - Title missing`);
      }

      // -----------------------------------------------------
      // META DESCRIPTION
      // -----------------------------------------------------

      const descriptions = page.locator(
        'meta[name="description"]'
      );

      const descriptionCount = await descriptions.count();

      if (descriptionCount === 0) {
        recommendations.push(
          `${url} - Meta description missing`
        );
      } else {
        const description = await descriptions
          .first()
          .getAttribute("content");

        if (description?.trim()) {
          passed.push(`${url} - Meta description found`);

          // Flera meta descriptions kan skapa oklarhet.
          if (descriptionCount > 1) {
            manualReview.push(
              `${url} - Multiple meta descriptions found (${descriptionCount})`
            );
          }
        } else {
          recommendations.push(
            `${url} - Meta description is empty`
          );
        }
      }

      // -----------------------------------------------------
      // H1-RUBRIKER
      // -----------------------------------------------------

      const h1Elements = page.locator("h1");
      const h1Count = await h1Elements.count();

      if (h1Count === 0) {
        warnings.push(`${url} - H1 missing`);
      } else if (h1Count === 1) {
        const h1Text = await h1Elements.first().innerText();

        if (h1Text.trim()) {
          passed.push(`${url} - One non-empty H1 found`);
        } else {
          warnings.push(`${url} - H1 exists but is empty`);
        }
      } else {
        // Flera H1 är inte automatiskt ett fel.
        // HTML och sidans struktur behöver granskas i sitt sammanhang.
        manualReview.push(
          `${url} - Multiple H1 tags found (${h1Count}); manual review recommended`
        );
      }

      // -----------------------------------------------------
      // BILDER OCH ALT-ATTRIBUT
      // -----------------------------------------------------

      const images = page.locator("img");
      const imageCount = await images.count();

      let imagesWithoutAlt = 0;

      for (let i = 0; i < imageCount; i++) {
        const image = images.nth(i);
        const alt = await image.getAttribute("alt");

        // Ett tomt alt-attribut kan vara korrekt för dekorativa
        // bilder. Vi räknar därför bara saknade attribut.
        if (alt === null) {
          imagesWithoutAlt++;
        }
      }

      if (imagesWithoutAlt === 0) {
        passed.push(`${url} - All images have alt attributes`);
      } else {
        warnings.push(
          `${url} - ${imagesWithoutAlt} images are missing alt attributes`
        );
      }

      // -----------------------------------------------------
      // CANONICAL
      // -----------------------------------------------------

      const canonicalLinks = page.locator(
        'link[rel="canonical"]'
      );

      const canonicalCount = await canonicalLinks.count();

      if (canonicalCount === 0) {
        // Canonical behövs inte nödvändigtvis på varje sida.
        recommendations.push(
          `${url} - Canonical missing; check whether one is needed`
        );
      } else {
        const canonical = await canonicalLinks
          .first()
          .getAttribute("href");

        if (canonical?.trim()) {
          passed.push(`${url} - Canonical found`);

          if (canonicalCount > 1) {
            manualReview.push(
              `${url} - Multiple canonical links found (${canonicalCount})`
            );
          }
        } else {
          warnings.push(`${url} - Canonical exists but has no URL`);
        }
      }
    } catch (error) {
      // Ett tekniskt kontrollfel är inte samma sak som
      // ett bekräftat SEO-problem på sidan.
      failed.push(
        `${url} - SEO check could not be completed`
      );

      console.log(`SEO check error on ${url}:`, error);
    }
  }

  // -------------------------------------------------------
  // SAMMANFATTNING
  // -------------------------------------------------------

  console.log("\nSEO RESULTS");
  console.log(`Passed: ${passed.length}`);
  console.log(`Important improvements: ${warnings.length}`);
  console.log(`Recommendations: ${recommendations.length}`);
  console.log(`Manual review: ${manualReview.length}`);
  console.log(`Technical errors: ${failed.length}`);

  if (warnings.length > 0) {
    console.log("\nSEO IMPROVEMENTS:");

    warnings.forEach((warning) => {
      console.log("-", warning);
    });
  }

  if (recommendations.length > 0) {
    console.log("\nSEO RECOMMENDATIONS:");

    recommendations.forEach((recommendation) => {
      console.log("-", recommendation);
    });
  }

  if (manualReview.length > 0) {
    console.log("\nSEO NEEDS MANUAL REVIEW:");

    manualReview.forEach((item) => {
      console.log("-", item);
    });
  }

  if (failed.length > 0) {
    console.log("\nSEO TECHNICAL ERRORS:");

    failed.forEach((error) => {
      console.log("-", error);
    });
  }

  return {
    passed,
    warnings,
    recommendations,
    manualReview,
    failed,
  };
}
