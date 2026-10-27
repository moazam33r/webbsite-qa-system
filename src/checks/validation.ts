import { Locator, Page, Route } from "@playwright/test";

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

  // Vilket telefontest felet kommer från.
  test?: PhoneTestName;
}

// Servern kompileras med verktyg (esbuild/tsx) som lägger till en
// hjälpfunktion, __name, i funktioner som skickas in i webbsidan.
// Sidan känner inte till den och kraschar med "__name is not defined".
// Vi definierar den därför i sidan innan något testas. Skrivs som
// text så att den inte i sin tur kompileras om.
const PAGE_HELPER = "window.__name = window.__name || function (f) { return f; };";

const preparedPages = new WeakSet<Page>();

async function preparePage(page: Page): Promise<void> {

  if (!preparedPages.has(page)) {
    preparedPages.add(page);
    await page.addInitScript(PAGE_HELPER);
  }

  // Gäller även sidan som redan är öppen.
  await page.evaluate(PAGE_HELPER).catch(() => undefined);
}

// Kontrollerar validering av formulär.
export async function checkValidation(
  page: Page,
  pages: string[],
  onProgress?: ProgressCallback,
  options: { email?: boolean; phone?: boolean } = {}
) {

  const runEmail = options.email !== false;
  const runPhone = options.phone !== false;

  await preparePage(page);

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

  // Telefontester som inte kunde genomföras eller verifieras.
  // Räknas varken som godkända eller underkända.
  let phoneInconclusive = 0;

  // Resultat för varje enskilt telefontest, med sida och fält.
  const phoneTests: PhoneTestResult[] = [];

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

  for (const pageUrl of runEmail ? pages : []) {

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

      // Hoppar över dolda, inaktiverade och skrivskyddade fält.
      if (
        !(await emailField.isVisible()) ||
        !(await emailField.isEnabled()) ||
        (await emailField.evaluate(
          (element) =>
            (element as HTMLInputElement).readOnly
        ))
      ) {
        console.log(
          `- E-postfält ${i + 1} hoppas över: dolt eller inte redigerbart`
        );
        continue;
      }

      // Hämtar information som kan identifiera fältet.
      const fieldInfo =
        await getFieldInfo(
          emailField,
          i
        );

      // Ogiltigt testvärde.
      const testValue =
        "test123";

      // Ett fält som inte går att fylla i ska inte stoppa skanningen.
      try {
        await emailField.fill(testValue, { timeout: 3000 });
      } catch {
        console.log(
          `- E-postfält ${fieldInfo.name} kunde inte testas och hoppas över`
        );
        continue;
      }

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

  for (const pageUrl of runPhone ? pages : []) {

    // Öppnar sidan och väntar in formulärskript (maskning,
    // validering) som annars inte hunnit starta.
    await page.goto(pageUrl);
    await preparePage(page);
    await settlePage(page);

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

    for (let i = 0; i < phoneCount; i++) {

      const phoneField = phoneFields.nth(i);

      // Hoppar över dolda, inaktiverade och skrivskyddade fält.
      if (
        !(await phoneField.isVisible()) ||
        !(await phoneField.isEnabled()) ||
        (await phoneField.evaluate(
          (element) =>
            (element as HTMLInputElement).readOnly
        ))
      ) {
        console.log(
          `- Telefonfält ${i + 1} hoppas över: dolt eller inte redigerbart`
        );
        continue;
      }

      const fieldInfo =
        await getFieldInfo(phoneField, i);

      // Kör manuell inmatning, kort nummer och inskick.
      const results = await testPhoneField(
        page,
        phoneField,
        {
          pageUrl,
          fieldName: fieldInfo.name,
          fieldSelector: fieldInfo.selector,
        }
      );

      for (const result of results) {

        phoneTests.push(result);

        const label = PHONE_TEST_LABELS[result.test];

        if (result.status === "passed") {

          phonePassed++;

          console.log(
            `✓ ${label} (${fieldInfo.name}): ${result.detail}`
          );

        } else if (result.status === "failed") {

          phoneFailed++;

          phoneFailures.push({
            pageUrl,
            fieldType: "phone",
            fieldName: fieldInfo.name,
            fieldSelector: fieldInfo.selector,
            testValue: result.testValue,
            test: result.test,
            error: `${label}: ${result.detail}`,
          });

          console.log(
            `⚠ ${label} (${fieldInfo.name}): ${result.detail}`
          );

        } else {

          phoneInconclusive++;

          console.log(
            `? ${label} (${fieldInfo.name}): ${result.detail}`
          );
        }
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
    `Phone validation: ${phonePassed} passed, ${phoneFailed} warnings, ${phoneInconclusive} inconclusive`
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

      console.log(
        `  ${failure.error}`
      );
    }
  }

  // Returnerar resultaten till QA-systemet.
  return {
    emailPassed,
    emailFailed,

    phonePassed,
    phoneFailed,
    phoneInconclusive,

    // Alla enskilda telefontester: godkända, underkända och
    // ej avgörbara, med sida och fält.
    phoneTests,

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


// ==============================
// HJÄLPFUNKTION: SIDLADDNING
// ==============================

// Väntar tills sidan är rimligt färdigladdad så att formulärskript
// (maskning, validering) hunnit starta innan vi testar fälten.
// Kastar aldrig fel.
async function settlePage(page: Page): Promise<void> {

  await page
    .waitForLoadState("load", { timeout: 10000 })
    .catch(() => undefined);

  await page
    .waitForLoadState("networkidle", { timeout: 4000 })
    .catch(() => undefined);
}

// ==============================
// TELEFONTESTER (inmatning, kort nummer, inskick)
// ==============================

// Testar hur ETT telefonfält faktiskt beter sig för en besökare.
//
// VIKTIGT: Ett type="tel"-fält har ingen inbyggd validering.
// webbläsarens checkValidity() ger därför "giltigt" för nästan
// allt, och det räknas INTE som ett godkänt test. Testerna här
// utgår i stället från vad som händer i fältet och på sidan.
//
// Tre tester:
//   typing = skriv "070abc123" tecken för tecken
//   short  = skriv "070123" och se om ett för kort nummer upptäcks
//            (båda räknas som godkända även om fältet tar emot värdet,
//            så länge valideringen stoppar det vid inskick)
//   submit = försök skicka formuläret med "070abc123" och se om
//            telefonvalideringen stoppar det. Alla riktiga
//            inskickningsförfrågningar blockeras av testet, så
//            inget når sajten.
//
// Varje test får ett av tre utfall:
//   passed       = testet genomfördes och fältet hanterade det rätt
//   failed       = testet genomfördes och fältet hanterade det fel
//   inconclusive = testet kunde inte genomföras eller verifieras.
//                  Det räknas varken som godkänt eller underkänt.

export type PhoneTestName = "typing" | "short" | "submit";

export type PhoneTestStatus =
  | "passed"
  | "failed"
  | "inconclusive";

export interface PhoneTestResult {
  pageUrl: string;
  fieldName: string;
  fieldSelector: string;
  test: PhoneTestName;
  status: PhoneTestStatus;
  testValue: string;

  // Värdet i fältet när det slutat ändras.
  resultingValue?: string;

  // Värdet efter att fältet lämnats (blur). Vissa formulär
  // rensar först då.
  valueAfterBlur?: string;

  // Om formuläret skickades in för att avgöra testet:
  //   accepted = formuläret skickades med det ogiltiga numret
  //   rejected = valideringen stoppade inskicket
  //   unknown  = det gick inte att avgöra
  submission?: "accepted" | "rejected" | "unknown";

  // Om fältet är obligatoriskt. Ett valfritt fält utan validering är
  // ett mindre problem eftersom besökaren kan lämna det tomt.
  required?: boolean;

  // Förklaring i klartext till rapporten.
  detail: string;
}

export const PHONE_TEST_LABELS: Record<PhoneTestName, string> = {
  typing: "Accepterar bokstäver vid inmatning",
  short: "Accepterar för kort telefonnummer",
  submit: "Accepterar bokstäver vid inskick",
};

export const LETTER_TEST_VALUE = "070abc123";
export const SHORT_TEST_VALUE = "070123";

// ---------------------------------------------------------
// RENA FUNKTIONER (testbara utan webbläsare)
// ---------------------------------------------------------

// Alla bokstäver i ett värde, utan dubbletter.
// \p{L} täcker även å, ä, ö och andra bokstäver.
export function lettersIn(value: string): string {

  const letters = value.match(/\p{L}/gu) ?? [];

  return [...new Set(letters)].join("");
}

// Avgör utfallet för ett bokstavstest (inmatning eller
// tangentbord) utifrån vad som stod i fältet.
export function classifyLetterTest(
  action: "inmatning",
  testValue: string,
  valueAfterInput: string,
  valueAfterBlur: string
): {
  status: "passed" | "failed";
  detail: string;
} {

  const lettersAfterBlur = lettersIn(valueAfterBlur);
  const lettersAfterInput = lettersIn(valueAfterInput);

  if (lettersAfterBlur.length > 0) {
    return {
      status: "failed",
      detail:
        `Bokstäver accepterades vid ${action}: ` +
        `"${testValue}" blev "${valueAfterBlur}" ` +
        `(kvarvarande bokstäver: ${lettersAfterBlur}).`,
    };
  }

  if (lettersAfterInput.length > 0) {
    return {
      status: "passed",
      detail:
        `Bokstäverna visades först (${valueAfterInput}) ` +
        `men togs bort när fältet lämnades ` +
        `("${valueAfterBlur}"). Kontrollera om det är ` +
        `avsett beteende.`,
    };
  }

  if (valueAfterInput === "") {
    return {
      status: "passed",
      detail: `Fältet avvisade hela värdet vid ${action}.`,
    };
  }

  return {
    status: "passed",
    detail:
      `Bokstäverna togs bort vid ${action}: ` +
      `"${testValue}" blev "${valueAfterInput}".`,
  };
}

// ---------------------------------------------------------
// HJÄLPFUNKTIONER MOT SIDAN
// ---------------------------------------------------------

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Läser fältets värde när det har slutat ändras.
//
// Många formulär rensar tecken asynkront (debounce, setTimeout,
// inputmask-plugins). Läser man värdet direkt efter inmatningen
// ser man därför bokstäver som en besökare aldrig ser.
async function settledValue(
  field: Locator,
  quietMs = 600,
  maxMs = 3000
): Promise<string> {

  const start = Date.now();

  let last = await field.inputValue();
  let lastChange = Date.now();

  while (Date.now() - start < maxMs) {

    await sleep(100);

    const current = await field.inputValue();

    if (current !== last) {
      last = current;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      break;
    }
  }

  return last;
}

// Ger fältet fokus på det sätt en besökare gör: ett klick.
//
// Om något täcker fältet (cookie-banner, sticky header, ett
// flerstegsformulär) kan Playwright inte klicka på det, trots att
// fältet går att fylla i. Då fokuserar vi fältet direkt i stället
// för att avbryta hela testet. Själva valideringen testas lika
// bra, eftersom tangenttryck går till det fokuserade fältet.
async function focusField(field: Locator): Promise<void> {

  try {
    await field.click({ timeout: 1500 });
  } catch {
    await field.focus({ timeout: 3000 });
  }
}

// Kortar ett Playwright-fel men behåller orsaken, t.ex. vilket
// element som ligger över fältet. Första raden ensam säger bara
// "Timeout exceeded".
function shortError(error: unknown): string {

  const lines = (
    error instanceof Error ? error.message : String(error)
  )
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const reason = lines.find((line) =>
    /intercepts pointer events|outside of the viewport|not visible|not stable|not enabled|not editable/i.test(
      line
    )
  );

  return [lines[0], reason]
    .filter(Boolean)
    .join(" – ")
    .slice(0, 300);
}

// Rensar fältet inför nästa test.
async function clearField(field: Locator): Promise<void> {

  await field.fill("", { timeout: 3000 });
  await sleep(100);
}

interface FieldState {
  valid: boolean;
  validationMessage: string;
  ariaInvalid: boolean;
  errors: string[];
}

// Läser om fältet visar något tecken på ogiltigt värde:
// webbläsarens validering, aria-invalid eller synliga
// felmeddelanden i formuläret.
async function readFieldState(
  field: Locator
): Promise<FieldState> {

  return field.evaluate((element) => {

    const input = element as HTMLInputElement;

    const selectors = [
      '[role="alert"]',
      '[aria-live="assertive"]',
      ".error",
      ".error-message",
      ".invalid-feedback",
      ".field-error",
      // Vanliga WordPress-formulärtillägg.
      ".wpcf7-not-valid-tip",
      ".gfield_validation_message",
      ".wpforms-error",
      ".forminator-error-message",
      ".elementor-message-danger",
      ".nf-error-msg",
      ".ff-el-is-error .error",
      ".f-invalid",
    ];

    const scope = input.closest("form") ?? document.body;

    const errors: string[] = [];

    scope.querySelectorAll(selectors.join(",")).forEach((item) => {

      const style = window.getComputedStyle(item);

      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        item.getClientRects().length > 0;

      const text = (item.textContent ?? "").trim();

      if (visible && text && text.length < 300) {
        errors.push(text);
      }
    });

    const className = (
      input.getAttribute("class") ?? ""
    ).toLowerCase();

    return {
      valid: input.checkValidity(),
      validationMessage: input.validationMessage,
      ariaInvalid: input.getAttribute("aria-invalid") === "true",
      errors: [
        ...errors,
        ...(/not-valid|is-invalid|has-error/.test(className)
          ? ["(fältet är markerat som ogiltigt)"]
          : []),
      ],
    };
  });
}

// ---------------------------------------------------------
// DE TRE TESTERNA
// ---------------------------------------------------------

interface TestContext {
  pageUrl: string;
  fieldName: string;
  fieldSelector: string;
}

type Outcome = Omit<
  PhoneTestResult,
  "pageUrl" | "fieldName" | "fieldSelector" | "test" | "testValue"
>;

// Test 1: skriver tecken för tecken med riktiga tangenttryck.
async function runTypingTest(field: Locator): Promise<Outcome> {

  await clearField(field);

  // Felmeddelanden som finns i utgångsläget räknas inte.
  await field.blur();
  await settledValue(field, 300, 1500);
  const baseline = (await readFieldState(field)).errors;

  await focusField(field);

  await field.pressSequentially(LETTER_TEST_VALUE, { delay: 60 });

  const valueAfterInput = await settledValue(field);

  await field.blur();

  const valueAfterBlur = await settledValue(field, 300, 1500);

  const result = classifyLetterTest(
    "inmatning",
    LETTER_TEST_VALUE,
    valueAfterInput,
    valueAfterBlur
  );

  // Bokstäverna kan skrivas in, men valideringen kan ändå reagera
  // (HTML-validering, felmeddelande eller markering). Då räknas
  // fältet som skyddat.
  if (result.status === "failed") {

    const state = await readFieldState(field);

    const evidence: string[] = [];

    if (!state.valid) {
      evidence.push(`HTML-validering: "${state.validationMessage}"`);
    }

    if (state.ariaInvalid) {
      evidence.push("fältet markerades som ogiltigt (aria-invalid)");
    }

    const newErrors = state.errors.filter((e) => !baseline.includes(e));

    if (newErrors.length > 0) {
      evidence.push(`felmeddelande: "${newErrors[0]}"`);
    }

    if (evidence.length > 0) {
      return {
        status: "passed",
        resultingValue: valueAfterInput,
        valueAfterBlur,
        detail:
          `Bokstäverna går att skriva ("${valueAfterBlur}") men ` +
          `valideringen reagerar (${evidence.join(", ")}).`,
      };
    }
  }

  return {
    ...result,
    resultingValue: valueAfterInput,
    valueAfterBlur,
  };
}

// Test 2: för kort nummer. Formuläret skickas inte här.
async function runShortTest(field: Locator): Promise<Outcome> {

  await clearField(field);

  // Lämnar det tomma fältet så att valideringen körs om och
  // felmeddelanden från de föregående testerna försvinner.
  // Annars skulle ett kvarliggande meddelande felaktigt räknas
  // som "fanns redan" och dölja ett verkligt svar.
  await field.blur();
  await settledValue(field, 300, 1500);

  // Felmeddelanden som finns i utgångsläget räknas inte.
  const baseline = (await readFieldState(field)).errors;

  await focusField(field);

  await field.pressSequentially(SHORT_TEST_VALUE, { delay: 60 });

  const valueAfterInput = await settledValue(field);
  const afterInput = await readFieldState(field);

  // Många formulär visar felet först när fältet lämnas.
  await field.blur();

  const valueAfterBlur = await settledValue(field, 300, 1500);
  const afterBlur = await readFieldState(field);

  const newErrors = [
    ...new Set([...afterInput.errors, ...afterBlur.errors]),
  ].filter((text) => !baseline.includes(text));

  // Det räcker INTE att webbläsaren godtar värdet. Vi kräver ett
  // verkligt tecken på att formuläret reagerade.
  const evidence: string[] = [];

  if (!afterInput.valid || !afterBlur.valid) {
    evidence.push(
      `HTML-validering: "${
        afterInput.validationMessage || afterBlur.validationMessage
      }"`
    );
  }

  if (afterInput.ariaInvalid || afterBlur.ariaInvalid) {
    evidence.push("fältet markerades som ogiltigt (aria-invalid)");
  }

  if (newErrors.length > 0) {
    evidence.push(`felmeddelande: "${newErrors[0]}"`);
  }

  if (evidence.length > 0) {
    return {
      status: "passed",
      resultingValue: valueAfterInput,
      valueAfterBlur,
      detail: `Det korta numret upptäcktes (${evidence.join(", ")}).`,
    };
  }

  return {
    status: "failed",
    resultingValue: valueAfterInput,
    valueAfterBlur,
    detail:
      `Det korta numret "${SHORT_TEST_VALUE}" accepterades utan ` +
      `någon synlig validering i fältet (varken HTML-validering, ` +
      `felmeddelande eller markering).`,
  };
}

// ---------------------------------------------------------
// INSKICK AV FORMULÄRET
// ---------------------------------------------------------
// Många formulär validerar först när de skickas. Testet fyller i
// övriga fält med tydlig QA-testdata och försöker skicka formuläret
// med det ogiltiga numret.
//
// SKYDD: medan testet skickar blockeras ALLA förfrågningar som inte
// är GET/HEAD/OPTIONS (POST, PUT m.fl.) innan de lämnar webbläsaren.
// Inget ärende skapas därför på sajten. Testet ser i stället om
// formuläret FÖRSÖKTE skicka numret, vilket betyder att
// valideringen inte stoppade det.

const SUCCESS_SELECTORS = [
  ".wpcf7-form.sent",
  ".wpcf7-mail-sent-ok",
  ".gform_confirmation_message",
  ".gform_confirmation_wrapper",
  ".wpforms-confirmation-container",
  ".wpforms-confirmation-container-full",
  ".elementor-message-success",
  ".forminator-response-message.forminator-success",
  ".frm_message",
  ".nf-response-msg",
  ".brxe-form .bricks-form__message.success",
  ".form-success",
  ".success-message",
  ".alert-success",
];

const SUCCESS_TEXT =
  "\\b(tack|thank you|thanks|skickat|skickades|har skickats|mottagit|mottagen|message sent|successfully)\\b";

// Fyller i övriga obligatoriska och synliga fält med testdata.
// Returnerar true om en synlig captcha hindrar automatiskt inskick.
async function prepareForm(
  form: Locator,
  phone: Locator
): Promise<{ captcha: boolean }> {

  const phoneHandle = await phone.elementHandle();

  return form.evaluate((formElement, phoneElement) => {

    const f = formElement as HTMLFormElement;

    const visible = (el: Element) =>
      (el as HTMLElement).getClientRects().length > 0;

    const setValue = (
      el: HTMLInputElement | HTMLTextAreaElement,
      value: string
    ) => {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(
        el,
        value
      );
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const radiosDone = new Set<string>();

    for (const el of Array.from(
      f.querySelectorAll<HTMLElement>("input, textarea, select")
    )) {

      if (el === phoneElement || !visible(el)) continue;

      const field = el as HTMLInputElement;
      if (field.disabled || field.readOnly) continue;

      const type = (field.getAttribute("type") || "text").toLowerCase();
      const name = (
        field.getAttribute("name") ||
        field.getAttribute("placeholder") ||
        field.id ||
        ""
      ).toLowerCase();

      if (
        ["hidden", "submit", "button", "image", "file", "reset",
         "password", "date", "time", "datetime-local", "month",
         "week", "color", "range"].includes(type)
      ) continue;

      if (type === "checkbox") {
        const required =
          field.required ||
          field.getAttribute("aria-required") === "true";
        if (required && !field.checked) field.click();
        continue;
      }

      if (type === "radio") {
        const group = field.name;
        if (radiosDone.has(group)) continue;
        radiosDone.add(group);
        const checked = f.querySelector(
          `input[type="radio"][name="${CSS.escape(group)}"]:checked`
        );
        if (!checked) field.click();
        continue;
      }

      if (el instanceof HTMLSelectElement) {
        if (!el.value) {
          const option = Array.from(el.options).find(
            (o) => o.value && !o.disabled
          );
          if (option) {
            el.value = option.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        continue;
      }

      if (field.value) continue;

      let value = "QA-test";

      if (el instanceof HTMLTextAreaElement) {
        value = "Automatiskt QA-test. Ignorera detta meddelande.";
      } else if (type === "email" || /e-?post|mail/.test(name)) {
        value = "qa-test@example.com";
      } else if (type === "tel" || /phone|telefon|mobil/.test(name)) {
        value = "0701234567";
      } else if (type === "url") {
        value = "https://example.com";
      } else if (type === "number") {
        value = field.min || "1";
      } else if (/efternamn|last|surname/.test(name)) {
        value = "Test";
      } else if (/f[oö]rnamn|first/.test(name)) {
        value = "QA";
      } else if (/namn|name/.test(name)) {
        value = "QA Test";
      } else if (/f[oö]retag|company/.test(name)) {
        value = "QA-test AB";
      } else if (/post|zip/.test(name)) {
        value = "11122";
      }

      setValue(field, value);
    }

    const captcha = Array.from(
      f.querySelectorAll(
        '.g-recaptcha:not([data-size="invisible"]), .h-captcha, .cf-turnstile'
      )
    ).some(visible);

    return { captcha };

  }, phoneHandle);
}

// Hittar det som formuläret består av och dess skicka-knapp. Oftast ett
// <form>, men en del sajter bygger formulär utan <form>-element. Då
// används den närmaste behållaren som innehåller en skicka-knapp.
// Telefonfältets landsväljare och cookie-knappar räknas aldrig som
// skicka-knapp. Resultatet markeras i sidan med data-qa-scope och
// data-qa-send.
async function findSubmitTarget(
  page: Page,
  field: Locator
): Promise<{
  scope: Locator | null;
  button: Locator | null;
  isForm: boolean;
}> {

  const found = await field.evaluate((element) => {

    document
      .querySelectorAll("[data-qa-scope], [data-qa-send]")
      .forEach((e) => {
        e.removeAttribute("data-qa-scope");
        e.removeAttribute("data-qa-send");
      });

    const SEND =
      /skicka|send|boka|begär|offert|submit|kontakta|nästa|next|fortsätt|continue/i;

    const controls = (root: Element) =>
      Array.from(
        root.querySelectorAll(
          'button, input[type="submit"], input[type="image"], [role="button"]'
        )
      ).filter(
        (b) =>
          !(() => {
            // body/html kan ha klasser som "gdpr-infobar-visible"
            // och får aldrig räknas som cookie-ruta.
            const hit = b.closest(
              '.iti, [class*="gdpr" i], [id*="cookie" i]'
            );
            return (
              !!hit &&
              hit !== document.body &&
              hit !== document.documentElement
            );
          })() &&
          (b as HTMLElement).getClientRects().length > 0
      );

    const label = (b: Element) =>
      (b as HTMLElement).innerText ||
      (b as HTMLInputElement).value ||
      b.getAttribute("aria-label") ||
      "";

    const best = (root: Element): Element | null => {
      const list = controls(root);
      return (
        list.find(
          (b) =>
            b.matches('input[type="submit"]') ||
            (b.tagName === "BUTTON" &&
              (b as HTMLButtonElement).type === "submit")
        ) ??
        list.find((b) => SEND.test(label(b))) ??
        null
      );
    };

    const form = element.closest("form");

    let scope: Element | null = null;
    let button: Element | null = null;

    if (form) {

      scope = form;
      button = best(form) ?? controls(form)[0] ?? null;

    } else {

      let node = element.parentElement;

      while (node && node !== document.body) {
        const candidate = best(node);
        if (candidate) {
          scope = node;
          button = candidate;
          break;
        }
        node = node.parentElement;
      }

      if (!scope) {

        node = element.parentElement;

        while (node && node !== document.body) {
          const list = controls(node);
          if (list.length > 0) {
            scope = node;
            button = list[0];
            break;
          }
          node = node.parentElement;
        }
      }
    }

    scope?.setAttribute("data-qa-scope", "1");
    button?.setAttribute("data-qa-send", "1");

    return {
      hasScope: !!scope,
      hasButton: !!button,
      isForm: !!form,
    };
  });

  return {
    scope: found.hasScope ? page.locator('[data-qa-scope="1"]') : null,
    button: found.hasButton ? page.locator('[data-qa-send="1"]') : null,
    isForm: found.isForm,
  };
}

// Flerstegsformulär i konversationsläge (Fluent Forms): ett fält per
// steg. Telefonfältet kan ligga i ett senare steg och går först att
// skriva i när de tidigare stegen är besvarade. Här fylls tidigare
// steg i med tydlig QA-testdata och vi går vidare tills telefonsteget
// är aktivt. Inget skickas förrän sista steget skickas, och då
// blockeras förfrågan av testet.
async function ensureConversationalStep(
  page: Page,
  field: Locator
): Promise<void> {

  const inSteps = await field.evaluate(
    (el) => !!el.closest(".q-form")
  );

  if (!inSteps) {
    return;
  }

  const isActive = () =>
    field.evaluate((el) => {
      const q = el.closest(".q-form");
      return !!q && !q.classList.contains("q-is-inactive");
    });

  const activeIndex = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".q-form")).findIndex(
        (q) => !q.classList.contains("q-is-inactive")
      )
    );

  for (let attempt = 0; attempt < 25; attempt++) {

    if (await isActive()) {
      await sleep(600);
      return;
    }

    const before = await activeIndex();

    await page.evaluate(() => {

      const step = Array.from(
        document.querySelectorAll(".q-form")
      ).find((q) => !q.classList.contains("q-is-inactive"));

      if (!step) return;

      const option = step.querySelector('li[role="option"]');

      if (option && !step.querySelector("li.f-selected")) {
        (option as HTMLElement).click();
      }

      if (step.classList.contains("field-dropdown")) return;

      step
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input, textarea"
        )
        .forEach((input) => {

          if (input.value || input.type === "hidden") return;

          const type = (input.getAttribute("type") || "text").toLowerCase();

          let value = "QA-test AB";

          if (input instanceof HTMLTextAreaElement) {
            value = "Automatiskt QA-test. Ignorera detta meddelande.";
          } else if (type === "email") {
            value = "qa-test@example.com";
          } else if (type === "url") {
            value = "https://example.com";
          } else if (type === "tel") {
            value = "0701234567";
          } else if (type === "number") {
            value = "1";
          } else if (/namn|name/i.test(input.name) && !/f[oö]retag|company/i.test(input.name)) {
            value = "QA Test";
          }

          const proto =
            input instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;

          Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(
            input,
            value
          );

          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
    });

    await sleep(300);

    await page
      .locator("a.f-next")
      .first()
      .evaluate((el) => (el as HTMLElement).click())
      .catch(() => undefined);

    const started = Date.now();

    while (
      Date.now() - started < 3000 &&
      (await activeIndex()) === before
    ) {
      await sleep(200);
    }

    if ((await activeIndex()) === before) {
      throw new Error(
        `flerstegsformulär: det gick inte att ta sig förbi steg ${before + 1} ` +
          `fram till telefonfältet`
      );
    }
  }

  throw new Error(
    "flerstegsformulär: telefonsteget kunde inte nås"
  );
}

// Synliga felmeddelanden i fältets egen ruta (t.ex. ett steg i ett
// stegformulär eller en fältgrupp). Smalare än readFieldState, så att
// varningar någon annanstans på sidan inte räknas.
async function localErrors(field: Locator): Promise<string[]> {

  return field.evaluate((element) => {

    const box =
      element.closest(
        ".q-form, .ff-el-group, .gfield, .wpforms-field, .form-group, " +
          ".wpcf7-form-control-wrap, .elementor-field-group"
      ) ?? null;

    if (!box) return [];

    const found: string[] = [];

    box
      .querySelectorAll(
        '[role="alert"], .f-invalid, .error, .error-message, ' +
          ".wpcf7-not-valid-tip, .gfield_validation_message, " +
          ".wpforms-error, .invalid-feedback"
      )
      .forEach((item) => {
        const style = window.getComputedStyle(item);
        const text = (item.textContent ?? "").trim();
        if (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          item.getClientRects().length > 0 &&
          text &&
          text.length < 300
        ) {
          found.push(text);
        }
      });

    return found;
  });
}

// Skickar in formuläret med det värde som ligger i fältet och
// avgör om det accepterades eller stoppades. Inga riktiga
// inskickningsförfrågningar lämnar webbläsaren.
async function submitAndJudge(
  page: Page,
  field: Locator,
  sent: string
): Promise<{
  verdict: "accepted" | "rejected" | "unknown";
  detail: string;
}> {

  const target = await findSubmitTarget(page, field);

  const form = target.scope;

  if (!form) {
    return {
      verdict: "unknown",
      detail: "hittade ingen skicka-knapp i närheten av fältet",
    };
  }

  const { captcha } = await prepareForm(form, field);

  if (captcha) {
    return {
      verdict: "unknown",
      detail: "en captcha hindrar automatiskt inskick",
    };
  }

  // Utgångsläge före inskicket.
  const urlBefore = new URL(page.url());
  const pageOrigin = urlBefore.origin;
  const baseline = (await readFieldState(field)).errors;

  const countSuccessText = (source: string) =>
    (document.body.innerText.match(new RegExp(source, "gi")) || [])
      .length;

  const successBefore = await page.evaluate(
    countSuccessText,
    SUCCESS_TEXT
  );

  const nativeState = await field.evaluate((element) => {
    const input = element as HTMLInputElement;
    const form = input.form;
    const others = form
      ? Array.from(
          form.querySelectorAll<HTMLInputElement>(
            "input:invalid, textarea:invalid, select:invalid"
          )
        )
          .filter((e) => e !== input)
          .map((e) => e.name || e.id || e.type)
      : [];
    return {
      phoneValid: input.checkValidity(),
      phoneMessage: input.validationMessage,
      others,
    };
  });

  // Blockerar riktiga inskickningsförfrågningar och noterar dem.
  //   strong = förfrågan innehåller testvärdet
  //   weak   = annan POST till samma sajt (kan vara inskicket)
  const attempts: { strong: boolean; url: string }[] = [];
  const encoded = encodeURIComponent(sent);

  const guard = async (route: Route) => {

    const request = route.request();
    const method = request.method();
    const url = request.url();

    const carriesValue =
      (request.postData() ?? "").includes(sent) ||
      (request.postData() ?? "").includes(encoded) ||
      url.includes(encoded);

    const isWrite = !["GET", "HEAD", "OPTIONS"].includes(method);
    const isNavigationWithValue =
      request.resourceType() === "document" && carriesValue;

    if (isWrite || isNavigationWithValue) {

      let sameOrigin = false;
      try { sameOrigin = new URL(url).origin === pageOrigin; } catch {}

      if (
        carriesValue ||
        (sameOrigin &&
          ["document", "xhr", "fetch"].includes(request.resourceType()))
      ) {
        attempts.push({ strong: carriesValue, url });
      }

      await route.abort();
      return;
    }

    await route.fallback();
  };

  await page.route("**/*", guard);

  try {

    if (target.button) {

      const submitButton = target.button;

      await submitButton
        .click({ timeout: 3000 })
        .catch(() =>
          submitButton.evaluate((b) => (b as HTMLElement).click())
        );

    } else if (target.isForm) {

      await form.evaluate((f) => (f as HTMLFormElement).requestSubmit());

    } else {

      return {
        verdict: "unknown",
        detail: "hittade ingen skicka-knapp",
      };
    }

    const started = Date.now();
    let rejection = "";
    let enterTried = false;

    while (Date.now() - started < 8000) {

      await sleep(250);

      const urlNow = new URL(page.url());

      if (
        urlNow.pathname !== urlBefore.pathname ||
        urlNow.search !== urlBefore.search
      ) {
        return {
          verdict: "accepted",
          detail: `sidan gick vidare till ${urlNow.pathname}`,
        };
      }

      for (const selector of SUCCESS_SELECTORS) {
        if (
          await page
            .locator(selector)
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          return {
            verdict: "accepted",
            detail: "formuläret visade en bekräftelse efter inskicket",
          };
        }
      }

      const successNow = await page
        .evaluate(countSuccessText, SUCCESS_TEXT)
        .catch(() => successBefore);

      if (successNow > successBefore) {
        return {
          verdict: "accepted",
          detail: "en bekräftelsetext visades efter inskicket",
        };
      }

      // Bevis på att valideringen stoppade inskicket.
      if (!nativeState.phoneValid) {
        rejection =
          `webbläsarens validering stoppade inskicket: "${nativeState.phoneMessage}"`;
      } else {
        const now = await readFieldState(field).catch(() => undefined);

        if (now) {
          const newErrors = now.errors.filter(
            (e) => !baseline.includes(e)
          );

          if (newErrors.length > 0) {
            rejection = `felmeddelande: "${newErrors[0]}"`;
          } else if (now.ariaInvalid) {
            rejection = "fältet markerades som ogiltigt";
          }
        }
      }

      // Stegformulär säger "Tryck Enter för att fortsätta". Händer inget
      // efter klicket provar vi Enter i fältet, som en besökare gör.
      if (
        !enterTried &&
        !rejection &&
        attempts.length === 0 &&
        Date.now() - started >= 3000
      ) {
        enterTried = true;
        await field.press("Enter", { timeout: 2000 }).catch(() => undefined);
      }

      // Vissa formulär visar felet redan när fältet lämnas (innan
      // inskicket) och visar det kvar när inskicket stoppas. Då finns
      // meddelandet redan i utgångsläget. Är det fortfarande synligt
      // i fältets egen ruta, utan bekräftelse och utan att något
      // skickats, har valideringen stoppat inskicket.
      if (!rejection && attempts.length === 0) {
        const stale = await localErrors(field).catch(() => []);
        if (stale.length > 0) {
          rejection =
            `felmeddelande: "${stale[0]}" (visades kvar efter inskicket)`;
        }
      }

      // Har formuläret redan försökt skicka en förfrågan har det inte
      // stoppats av klientvalideringen. Felmeddelanden som visas därefter
      // kan bero på att testet blockerade förfrågan och räknas inte.
      if (
        rejection &&
        attempts.length === 0 &&
        Date.now() - started >= 2000
      ) {
        return { verdict: "rejected", detail: rejection };
      }
    }

    if (rejection && attempts.length === 0) {
      return { verdict: "rejected", detail: rejection };
    }

    // Formuläret skickade en förfrågan som testet blockerade. Om servern
    // hade godkänt eller avvisat numret går inte att se utan att skicka
    // ett riktigt ärende, så det kan inte bedömas.
    if (attempts.length > 0) {
      return {
        verdict: "unknown",
        detail:
          "formuläret validerar troligen på servern och kunde inte " +
          "testas utan att skicka ett riktigt ärende (förfrågan " +
          "blockerades av testet, inget skickades)",
      };
    }

    if (nativeState.others.length > 0) {
      return {
        verdict: "unknown",
        detail:
          `ett annat fält (${nativeState.others.join(", ")}) stoppade ` +
          `inskicket, så telefonfältet kunde inte bedömas`,
      };
    }

    const seen = await field
      .evaluate((el) => {
        const box = el.closest(
          ".q-form, .ff-el-group, .gfield, .wpforms-field, form"
        );
        return ((box as HTMLElement | null)?.innerText ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);
      })
      .catch(() => "");

    return {
      verdict: "unknown",
      detail:
        "varken inskick eller felmeddelande kunde ses efter försöket" +
        (seen ? ` (fältets ruta visade: "${seen}")` : ""),
    };

  } finally {
    await page.unroute("**/*", guard);
  }
}

// Många sajter låter fältet ta emot vad som helst och validerar först
// vid inskick. Därför räknas ett underkänt fältresultat bara som
// underkänt om även inskicket accepterar värdet.
async function confirmBySubmitting(
  page: Page,
  field: Locator,
  pageUrl: string,
  outcome: Outcome,
  value: string
): Promise<Outcome> {

  if (outcome.status !== "failed") {
    return outcome;
  }

  await clearField(field);
  await focusField(field);
  await field.pressSequentially(value, { delay: 60 });
  await settledValue(field);
  await field.blur();

  const sent = await settledValue(field, 300, 1500);

  let result: Awaited<ReturnType<typeof submitAndJudge>>;

  try {

    result = await submitAndJudge(page, field, sent);

  } finally {

    await page.goto(pageUrl).catch(() => undefined);
    await preparePage(page).catch(() => undefined);
    await settlePage(page).catch(() => undefined);
  }

  if (result.verdict === "accepted") {
    return {
      ...outcome,
      status: "failed",
      submission: "accepted",
      detail:
        `${outcome.detail} Även vid inskick accepterades ` +
        `"${sent}": ${result.detail}.`,
    };
  }

  if (result.verdict === "rejected") {
    return {
      ...outcome,
      status: "passed",
      submission: "rejected",
      detail:
        `Fältet stoppar inte "${value}" medan man skriver, men ` +
        `valideringen stoppar det vid inskick: ${result.detail}.`,
    };
  }

  return {
    ...outcome,
    status: "inconclusive",
    submission: "unknown",
    detail:
      `${outcome.detail} Det gick inte att avgöra om valideringen ` +
      `stoppar det vid inskick: ${result.detail}.`,
  };
}

// Test 3: försöker skicka formuläret med 070abc123.
async function runSubmitTest(
  page: Page,
  field: Locator,
  pageUrl: string
): Promise<Outcome> {

  await clearField(field);
  await focusField(field);

  await field.pressSequentially(LETTER_TEST_VALUE, { delay: 60 });
  await settledValue(field);
  await field.blur();

  const sent = await settledValue(field, 300, 1500);

  // Rensar fältet bokstäverna redan kan inget ogiltigt skickas.
  if (lettersIn(sent) === "") {
    return {
      status: "passed",
      resultingValue: sent,
      detail:
        `Bokstäverna släpps inte in i fältet (blev "${sent}"), ` +
        `så ett ogiltigt nummer kan inte skickas.`,
    };
  }

  let result: Awaited<ReturnType<typeof submitAndJudge>>;

  try {

    result = await submitAndJudge(page, field, sent);

  } finally {

    // Återställer sidan så att inget testläge ligger kvar.
    await page.goto(pageUrl).catch(() => undefined);
    await preparePage(page).catch(() => undefined);
    await settlePage(page).catch(() => undefined);
  }

  if (result.verdict === "accepted") {
    return {
      status: "failed",
      submission: "accepted",
      resultingValue: sent,
      detail:
        `Formuläret accepterade "${sent}" vid inskick: ${result.detail}.`,
    };
  }

  if (result.verdict === "rejected") {
    return {
      status: "passed",
      submission: "rejected",
      resultingValue: sent,
      detail:
        `Formuläret stoppade "${sent}" vid inskick: ${result.detail}.`,
    };
  }

  return {
    status: "inconclusive",
    submission: "unknown",
    resultingValue: sent,
    detail:
      `Det gick inte att avgöra om formuläret accepterar ` +
      `"${sent}" vid inskick: ${result.detail}.`,
  };
}

// ---------------------------------------------------------
// HUVUDFUNKTION
// ---------------------------------------------------------

// Avgör om ett fält är obligatoriskt: required-attribut, aria-required
// eller en markering på fältgruppen (t.ex. Fluent Forms).
async function isRequiredField(field: Locator): Promise<boolean> {

  return field
    .evaluate((element) => {

      const input = element as HTMLInputElement;

      if (
        input.required ||
        input.getAttribute("aria-required") === "true"
      ) {
        return true;
      }

      const box = input.closest(
        ".ff-el-group, .q-form, .gfield, .wpforms-field, " +
          ".elementor-field-group, .form-group, .wpcf7-form-control-wrap"
      );

      if (!box) return false;

      if (
        box.matches(
          ".ff-el-is-required, .is-required, .gfield_contains_required, " +
            ".wpforms-field-required, .elementor-field-required, .required"
        ) ||
        box.querySelector(
          ".ff-el-is-required, .asterisk-right, .asterisk-left, " +
            ".gfield_required, .wpforms-required-label, .required"
        )
      ) {
        return true;
      }

      return false;
    })
    .catch(() => false);
}

// Kör de tre testerna på ett telefonfält. Ett test som kraschar
// stoppar aldrig övriga tester eller skanningen, utan blir
// "inconclusive" med orsaken angiven.
export async function testPhoneField(
  page: Page,
  field: Locator,
  context: TestContext
): Promise<PhoneTestResult[]> {

  await preparePage(page);

  const results: PhoneTestResult[] = [];

  const required = await isRequiredField(field);

  const run = async (
    test: PhoneTestName,
    testValue: string,
    action: () => Promise<Outcome>
  ) => {

    let outcome: Outcome;

    try {

      await ensureConversationalStep(page, field);

      outcome = await action();

    } catch (error) {

      outcome = {
        status: "inconclusive",
        detail:
          "Testet kunde inte genomföras: " +
          shortError(error),
      };
    }

    results.push({
      pageUrl: context.pageUrl,
      fieldName: context.fieldName,
      fieldSelector: context.fieldSelector,
      test,
      testValue,
      required,
      ...outcome,
    });
  };

  await run("typing", LETTER_TEST_VALUE, async () =>
    confirmBySubmitting(
      page,
      field,
      context.pageUrl,
      await runTypingTest(field),
      LETTER_TEST_VALUE
    )
  );

  await run("short", SHORT_TEST_VALUE, async () =>
    confirmBySubmitting(
      page,
      field,
      context.pageUrl,
      await runShortTest(field),
      SHORT_TEST_VALUE
    )
  );

  await run("submit", LETTER_TEST_VALUE, () =>
    runSubmitTest(page, field, context.pageUrl)
  );

  // Lämnar inte testdata kvar i fältet.
  await field.fill("", { timeout: 3000 }).catch(() => undefined);
  await field.blur().catch(() => undefined);

  return results;
}