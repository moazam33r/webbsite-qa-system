import { Page } from "@playwright/test";

// Funktion som används för att rapportera progress tillbaka till scanWebsite.
type ProgressCallback = (
  percentage: number,
  message: string
) => void;

// Information om ett enskilt valideringsfel.
export interface ValidationFailure {
  pageUrl: string;
  fieldType: "email" | "phone";
  fieldName: string;
  fieldSelector: string;
  testValue: string;
  error: string;
}

// Kontrollerar validering av formulär.
export async function checkValidation(
  page: Page,
  pages: string[],
  onProgress?: ProgressCallback
) {

  // Räknar e-postfält som klarar valideringen.
  let emailPassed = 0;

  // Räknar e-postfält som inte klarar valideringen.
  let emailFailed = 0;

  // Räknar telefonfält som klarar valideringen.
  let phonePassed = 0;

  // Räknar telefonfält som inte klarar valideringen.
  // Antal telefonfält som accepterade ett ogiltigt nummer.
  // Rapporteras som WARNING (inte FAIL) i website-scanner.ts.
  let phoneFailed = 0;

  // Sparar detaljer om e-postfel.
  const emailFailures: ValidationFailure[] = [];

  // Sparar detaljer om telefonfel.
  const phoneFailures: ValidationFailure[] = [];

  // Kontrollerar obligatoriska fält.
  console.log("\nRequired field check:");

  for (const pageUrl of pages) {

    // Öppnar sidan.
    await page.goto(pageUrl);

    // Hämtar alla formulär.
    const forms = page.locator("form");

    const formCount =
      await forms.count();

    // Hoppar över sidor utan formulär.
    if (formCount === 0) {
      continue;
    }

    // Kontrollerar varje formulär.
    for (
      let i = 0;
      i < formCount;
      i++
    ) {

      const form =
        forms.nth(i);

      // Hittar obligatoriska fält.
      const requiredFields =
        form.locator(
          'input[required], textarea[required], select[required], [aria-required="true"]'
        );

      const requiredCount =
        await requiredFields.count();

      if (requiredCount > 0) {

        console.log(
          `\nObligatoriska fält: ${pageUrl}`
        );

        console.log(
          `✓ ${requiredCount} obligatoriska fält hittades`
        );
      }
    }
  }

  // Rapporterar att e-postvalideringen börjar.
  onProgress?.(
    40,
    "Testar e-postvalidering..."
  );

  // ==============================
  // E-POSTVALIDERING
  // ==============================

  console.log(
    "\nEmail validation check:"
  );

  for (const pageUrl of pages) {

    // Öppnar sidan.
    await page.goto(pageUrl);

    // Hittar e-postfält.
    const emailFields =
      page.locator(
        'input[type="email"], input[name*="email" i], input[name*="epost" i]'
      );

    const emailCount =
      await emailFields.count();

    // Hoppar över sidor utan e-postfält.
    if (emailCount === 0) {
      continue;
    }

    console.log(
      `\nE-postvalidering: ${pageUrl}`
    );

    // Testar varje e-postfält.
    for (
      let i = 0;
      i < emailCount;
      i++
    ) {

      const emailField =
        emailFields.nth(i);

      // Hämtar information som kan identifiera fältet.
      const fieldInfo =
        await getFieldInfo(
          emailField,
          i
        );

      // Ogiltigt testvärde.
      const testValue =
        "test123";

      // Fyller i en ogiltig e-postadress.
      await emailField.fill(
        testValue
      );

      // Kontrollerar webbläsarens validering.
      const isValid =
        await emailField.evaluate(
          (element) =>
            (
              element as HTMLInputElement
            ).checkValidity()
        );

      if (isValid) {

        // Räknar ett e-postfel.
        emailFailed++;

        // Sparar detaljer om felet.
        emailFailures.push({
          pageUrl,
          fieldType: "email",
          fieldName:
            fieldInfo.name,
          fieldSelector:
            fieldInfo.selector,
          testValue,
          error:
            "Ogiltig e-postadress accepterades",
        });

        console.log(
          `⚠ Ogiltig e-post accepterades: ${fieldInfo.name}`
        );

      } else {

        // Räknar ett godkänt e-posttest.
        emailPassed++;

        console.log(
          `✓ Ogiltig e-post stoppades: ${fieldInfo.name}`
        );
      }
    }
  }

  // Rapporterar att e-postvalideringen är klar.
  onProgress?.(
    45,
    "E-postvalidering klar"
  );

  // ==============================
  // TELEFONVALIDERING
  // ==============================

  // Rapporterar att telefonvalideringen börjar.
  onProgress?.(
    50,
    "Testar telefonvalidering..."
  );

  console.log(
    "\nPhone validation check:"
  );

  for (const pageUrl of pages) {

    // Öppnar sidan.
    await page.goto(pageUrl);

    // Hittar telefonfält.
    const phoneFields =
      page.locator(
        'input[type="tel"], input[name*="phone" i], input[name*="telefon" i], input[name*="mobile" i]'
      );

    const phoneCount =
      await phoneFields.count();

    // Hoppar över sidor utan telefonfält.
    if (phoneCount === 0) {
      continue;
    }

    console.log(
      `\nTelefonvalidering: ${pageUrl}`
    );

    // Testar varje telefonfält.
    for (
      let i = 0;
      i < phoneCount;
      i++
    ) {

      const phoneField =
        phoneFields.nth(i);

      // Hämtar information som kan identifiera fältet.
      const fieldInfo =
        await getFieldInfo(
          phoneField,
          i
        );

      // Ogiltigt testvärde.
      const testValue =
        "070abc123";

      // Fyller i ett ogiltigt telefonnummer.
      await phoneField.fill(
        testValue
      );

      // Kontrollerar webbläsarens validering.
      const isValid =
        await phoneField.evaluate(
          (element) =>
            (
              element as HTMLInputElement
            ).checkValidity()
        );

      if (isValid) {

        // Räknar ett telefonfel.
        phoneFailed++;

        // Sparar detaljer om felet.
        phoneFailures.push({
          pageUrl,
          fieldType: "phone",
          fieldName:
            fieldInfo.name,
          fieldSelector:
            fieldInfo.selector,
          testValue,
          error:
            "Ogiltigt telefonnummer accepterades",
        });

        console.log(
          `⚠ Ogiltigt telefonnummer accepterades: ${fieldInfo.name}`
        );

      } else {

        // Räknar ett godkänt telefonvalideringstest.
        phonePassed++;

        console.log(
          `✓ Ogiltigt telefonnummer stoppades: ${fieldInfo.name}`
        );
      }
    }
  }

  // Rapporterar att telefonvalideringen är klar.
  onProgress?.(
    55,
    "Validering klar"
  );

  // ==============================
  // SAMMANFATTNING
  // ==============================

  console.log(
    "\nValidation summary:"
  );

  console.log(
    `Email validation: ${emailPassed} passed, ${emailFailed} failed`
  );

  console.log(
    `Phone validation: ${phonePassed} passed, ${phoneFailed} warnings`
  );

  // Visar detaljer om e-postfel.
  if (
    emailFailures.length > 0
  ) {

    console.log(
      "\nE-postfel:"
    );

    for (
      const failure of
      emailFailures
    ) {

      console.log(
        `- ${failure.pageUrl}`
      );

      console.log(
        `  Fält: ${failure.fieldName}`
      );

      console.log(
        `  Testvärde: ${failure.testValue}`
      );
    }
  }

  // Visar detaljer om telefonfel.
  if (
    phoneFailures.length > 0
  ) {

    console.log(
      "\nTelefonvarningar:"
    );

    for (
      const failure of
      phoneFailures
    ) {

      console.log(
        `- ${failure.pageUrl}`
      );

      console.log(
        `  Fält: ${failure.fieldName}`
      );

      console.log(
        `  Testvärde: ${failure.testValue}`
      );
    }
  }

  // Returnerar resultaten till QA-systemet.
  return {
    emailPassed,
    emailFailed,

    phonePassed,
    phoneFailed,

    // Detaljerade fel för PDF och AI.
    emailFailures,
    phoneFailures,
  };
}


// Hämtar identifierande information från ett formulärfält.
async function getFieldInfo(
  field: any,
  index: number
): Promise<{
  name: string;
  selector: string;
}> {

  // Hämtar information från HTML-elementet.
  const info =
    await field.evaluate(
      (
        element: HTMLInputElement
      ) => {

        // Hämtar name-attributet.
        const name =
          element.getAttribute(
            "name"
          );

        // Hämtar id-attributet.
        const id =
          element.getAttribute(
            "id"
          );

        // Hämtar aria-label.
        const ariaLabel =
          element.getAttribute(
            "aria-label"
          );

        // Hämtar placeholder.
        const placeholder =
          element.getAttribute(
            "placeholder"
          );

        // Försöker hitta en label
        // som hör till fältet.
        let labelText = "";

        if (id) {

          const label =
            document.querySelector(
              `label[for="${CSS.escape(id)}"]`
            );

          if (label) {

            labelText =
              label.textContent
                ?.trim() ?? "";
          }
        }

        // Väljer det mest användbara namnet.
        const fieldName =
          labelText ||
          ariaLabel ||
          placeholder ||
          name ||
          id ||
          "Okänt fält";

        // Returnerar informationen.
        return {
          name: fieldName,
          id,
          nameAttribute: name,
        };
      }
    );

  // Skapar en enkel identifierare för fältet.
  let selector =
    `fält ${index + 1}`;

  // Använder id om det finns.
  if (info.id) {

    selector =
      `#${info.id}`;

  // Annars använder vi name-attributet.
  } else if (info.nameAttribute) {

    selector =
      `[name="${info.nameAttribute}"]`;
  }

  // Returnerar informationen.
  return {
    name: info.name,
    selector,
  };
}