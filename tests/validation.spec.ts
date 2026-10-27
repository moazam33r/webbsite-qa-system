import { test, expect } from "@playwright/test";
import { checkPages } from "../src/checks/pages";
import {
  checkValidation,
  classifyLetterTest,
  lettersIn,
} from "../src/checks/validation";

test("Validation check", async ({ page }) => {

  // Hela skanningen av riktig sajt tar mer än standardminuten.
  test.setTimeout(600000);

  // Webbplatsen vi testar
  const url = "https://digitalkontakt.se/";

  // Hittar automatiskt webbplatsens sidor
  const pageResult = await checkPages(page, url);

  // Hämtar sidorna som hittades
  const pages = pageResult.links;

  // Kör valideringskontrollen och sparar resultatet
  const validationResult =
    await checkValidation(page, pages);

  // Kontrollerar att resultatet innehåller
  // alla förväntade valideringsvärden.
  expect(validationResult).toHaveProperty(
    "emailPassed"
  );

  expect(validationResult).toHaveProperty(
    "emailFailed"
  );

  expect(validationResult).toHaveProperty(
    "phonePassed"
  );

  expect(validationResult).toHaveProperty(
    "phoneFailed"
  );

  // Kontrollerar att alla resultat är nummer.
  expect(typeof validationResult.emailPassed)
    .toBe("number");

  expect(typeof validationResult.emailFailed)
    .toBe("number");

  expect(typeof validationResult.phonePassed)
    .toBe("number");

  expect(typeof validationResult.phoneFailed)
    .toBe("number");

  // Kontrollerar att inga räknare kan vara negativa.
  expect(validationResult.emailPassed)
    .toBeGreaterThanOrEqual(0);

  expect(validationResult.emailFailed)
    .toBeGreaterThanOrEqual(0);

  expect(validationResult.phonePassed)
    .toBeGreaterThanOrEqual(0);

  expect(validationResult.phoneFailed)
    .toBeGreaterThanOrEqual(0);
});

// =========================================================
// TELEFONVALIDERING MOT LOKALA TESTFORMULÄR
// =========================================================
// Formulär med känt beteende. Inga riktiga webbplatser används.

const wrap = (body: string, script = "") => `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><title>Test</title></head>
<body>
<form action="#" onsubmit="event.preventDefault();var m=document.querySelector('.msg');m.className='msg sent';m.textContent='Tack! Ditt meddelande har skickats.';return false">
  ${body}
  <span class="msg"></span>
</form>
<script>${script}</script>
</body></html>`;

const OTHER_FIELDS = `
  <input type="text" name="your-name" required>
  <input type="email" name="your-email" required>
  <textarea name="your-message" required></textarea>
  <label><input type="checkbox" name="consent" required> Jag godkänner</label>`;


// Stegformulär som efterliknar Fluent Forms i konversationsläge:
// ett fält per steg, telefonfältet sist, ingen <form>-tagg och
// landsväljaren är också en knapp. Telefonfältet filtrerar bara när
// dess steg är aktivt (som i verkligheten).
function conversationalForm(strict: boolean, errorOnBlur = false): string {
  return `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><title>Test</title>
<style>.q-is-inactive{opacity:.3;pointer-events:none}.f-disabled{opacity:.3}</style></head>
<body>
<div class="ff_conv_app">
  <div class="q-form field-multiplechoice" id="s0">
    <ul><li role="option" tabindex="0">SEO</li></ul>
  </div>
  <div class="q-form q-is-inactive field-text" id="s1">
    <input type="text" name="company_name" required>
  </div>
  <div class="q-form q-is-inactive field-email" id="s2">
    <input type="email" name="email" required>
  </div>
  <div class="q-form q-is-inactive field-phone" id="s3">
    <div class="iti"><button type="button" class="iti__selected-country">No country selected</button>
    <input type="tel" name="phone" id="p" class="iti__tel-input"></div>
    <button type="button" id="send" class="ff-btn o-btn-action">Skicka förfrågan</button>
    <div id="out"></div>
  </div>
  <a href="#" class="f-next f-disabled">Next step</a>
</div>
<script>
var steps=[].slice.call(document.querySelectorAll('.q-form'));
var cur=0, next=document.querySelector('.f-next'), phone=document.getElementById('p'), out=document.getElementById('out');
function ok(){var q=steps[cur]; if(cur===0) return !!q.querySelector('li.f-selected'); var i=q.querySelector('input[required]'); return !i || i.value.trim().length>0;}
function refresh(){ next.classList.toggle('f-disabled', !ok() || cur===steps.length-1); }
document.querySelector('li').addEventListener('click',function(e){e.currentTarget.classList.add('f-selected');refresh();});
[].forEach.call(document.querySelectorAll('input'),function(i){i.addEventListener('input',refresh);});
next.addEventListener('click',function(e){e.preventDefault(); if(!ok()||cur>=steps.length-1) return; steps[cur].classList.add('q-is-inactive'); cur++; steps[cur].classList.remove('q-is-inactive'); refresh();});
${strict && !errorOnBlur ? `phone.addEventListener('input',function(){ if(steps[3].classList.contains('q-is-inactive')) return; phone.value=phone.value.replace(/[^0-9+]/g,''); });` : ''}
${errorOnBlur ? `phone.addEventListener('blur',function(){ if(phone.value && phone.value.replace(/\\D/g,'').length<7 || /[a-z]/i.test(phone.value)){ out.innerHTML='<div class="f-invalid" role="alert">Phone number is not valid</div>'; } });` : ''}
document.getElementById('send').addEventListener('click',function(){
  ${strict || errorOnBlur
    ? `if(phone.value.replace(/\\D/g,'').length<7){ out.innerHTML='<div class="f-invalid" role="alert">Phone number is not valid</div>'; } else { out.textContent='Tack! Skickat.'; }`
    : `out.textContent='Tack! Skickat.';`}
});
</script>
</body></html>`;
}

const PHONE_FORMS: Record<string, string> = {

  conversationalStrict: conversationalForm(true),
  conversationalLenient: conversationalForm(false),
  conversationalErrorOnBlur: conversationalForm(false, true),


  // Fullständigt formulär utan telefonvalidering. Inskicket lyckas.
  submitAccepts: wrap(
    `${OTHER_FIELDS}
     <input type="tel" name="your-phone" id="p">
     <button type="submit">Skicka</button>`
  ),

  // Webbläsarens egen validering (pattern) stoppar inskicket.
  submitRejectsNative: wrap(
    `${OTHER_FIELDS}
     <input type="tel" name="your-phone" id="p" pattern="[0-9+\\(\\) \\-]{7,15}">
     <button type="submit">Skicka</button>`
  ),

  // Skriptvalidering vid inskick: felmeddelande, inget skickas.
  submitRejectsScript: `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><title>Test</title></head>
<body>
<form action="#" id="f">
  ${OTHER_FIELDS}
  <input type="tel" name="your-phone" id="p">
  <button type="submit">Skicka</button>
  <span class="msg"></span>
</form>
<script>
document.getElementById('f').addEventListener('submit',function(e){
  e.preventDefault();
  var v=document.getElementById('p').value;
  var m=document.querySelector('.msg');
  if(/[a-z]/i.test(v) || v.replace(/\\D/g,'').length<7){
    m.className='msg wpcf7-not-valid-tip';
    m.textContent='Ange ett giltigt telefonnummer.';
  } else {
    m.className='msg sent';
    m.textContent='Tack! Ditt meddelande har skickats.';
  }
});
</script>
</body></html>`,

  // Skickar via fetch (som t.ex. Contact Form 7). Visar bekräftelse
  // först när servern svarar. Testet blockerar förfrågan.
  submitFetch: `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><title>Test</title></head>
<body>
<form action="#" id="f">
  ${OTHER_FIELDS}
  <input type="tel" name="your-phone" id="p">
  <button type="submit">Skicka</button>
  <span class="msg"></span>
</form>
<script>
document.getElementById('f').addEventListener('submit',function(e){
  e.preventDefault();
  var m=document.querySelector('.msg');
  fetch('/send',{method:'POST',body:new FormData(e.target)})
    .then(function(){m.className='msg sent';m.textContent='Tack! Skickat.';})
    .catch(function(){m.textContent='Nätverksfel.';});
});
</script>
</body></html>`,

  // Inget <form>-element: fälten ligger i en vanlig behållare med
  // en knapp, och skriptet validerar vid klick.
  noForm: `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><title>Test</title></head>
<body>
<div id="box">
  <input type="text" name="your-name">
  <input type="email" name="your-email">
  <input type="tel" name="your-phone" id="p">
  <button type="button" id="b">Skicka</button>
  <span class="msg"></span>
</div>
<script>
document.getElementById('b').addEventListener('click',function(){
  var v=document.getElementById('p').value;
  var m=document.querySelector('.msg');
  if(/[a-z]/i.test(v) || v.replace(/\\D/g,'').length<7){
    m.className='msg wpcf7-not-valid-tip';
    m.textContent='Ange ett giltigt telefonnummer.';
  } else {
    m.className='msg sent';
    m.textContent='Tack! Skickat.';
  }
});
</script>
</body></html>`,

  // Synlig captcha: inskick går inte att göra automatiskt.
  submitCaptcha: wrap(
    `${OTHER_FIELDS}
     <input type="tel" name="your-phone" id="p">
     <div class="g-recaptcha" style="width:300px;height:80px"></div>
     <button type="submit">Skicka</button>`
  ),

  // Ingen validering alls. type="tel" tillåter allt.
  plain: wrap(`<input type="tel" name="your-phone" id="p">`),

  // Tar bort icke-siffror efter en kort fördröjning (debounce,
  // setTimeout eller en inputmask-plugin som kör asynkront).
  // Gäller både inklistring och tangentbord.
  asyncFilter: wrap(
    `<input type="tel" name="your-phone" id="p">`,
    `const el=document.getElementById('p');
     el.addEventListener('input',()=>setTimeout(()=>{
       el.value=el.value.replace(/[^0-9+ ()-]/g,'');
     },300));`
  ),

  // Efterliknar beskrivningen för Boda Alltjänst: inklistring
  // rensas men tangentbordet släpper igenom bokstaven "a".
  pasteCleanTypingLeaky: wrap(
    `<input type="tel" name="your-phone" id="p">`,
    `const el=document.getElementById('p');
     el.addEventListener('keydown',e=>{
       if(!e.ctrlKey && !e.metaKey && e.key.length===1 && /[a-z]/i.test(e.key) && e.key.toLowerCase()!=='a'){
         e.preventDefault();
       }
     });
     el.addEventListener('paste',e=>{
       e.preventDefault();
       const t=(e.clipboardData.getData('text')||'').replace(/[^0-9+ ()-]/g,'');
       el.setRangeText(t,el.selectionStart,el.selectionEnd,'end');
       el.dispatchEvent(new Event('input',{bubbles:true}));
     });`
  ),

  // Fullständig validering: bokstäver stoppas, kort nummer ger ett
  // synligt felmeddelande när fältet lämnas.
  validated: wrap(
    `<input type="tel" name="your-phone" id="p" pattern="[0-9+\\(\\) \\-]{7,15}">`,
    `const el=document.getElementById('p');
     const msg=document.querySelector('.msg');
     el.addEventListener('keydown',e=>{
       if(e.key.length===1 && !/[0-9+ ()-]/.test(e.key) && !e.ctrlKey && !e.metaKey){
         e.preventDefault();
       }
     });
     el.addEventListener('paste',e=>{
       e.preventDefault();
       const t=(e.clipboardData.getData('text')||'').replace(/[^0-9+ ()-]/g,'');
       el.setRangeText(t,el.selectionStart,el.selectionEnd,'end');
       el.dispatchEvent(new Event('input',{bubbles:true}));
     });
     el.addEventListener('blur',()=>{
       const digits=el.value.replace(/\\D/g,'');
       msg.className='msg wpcf7-not-valid-tip';
       msg.textContent = digits.length>0 && digits.length<7 ? 'Telefonnumret är för kort.' : '';
     });`
  ),

  // Ett lager (t.ex. cookie-banner) ligger över fältet så att det
  // inte går att klicka på, men fältet går att skriva i.
  coveredByOverlay: wrap(
    `<div style="position:relative;display:inline-block">
       <input type="tel" name="phone" id="p">
       <div style="position:absolute;inset:0;z-index:10"></div>
     </div>`,
    `const el=document.getElementById('p');
     el.addEventListener('input',()=>setTimeout(()=>{
       el.value=el.value.replace(/[^0-9+ ()-]/g,'');
     },300));`
  ),

  // Rensar bokstäver först när fältet lämnas.
  cleanOnBlurOnly: wrap(
    `<input type="tel" name="your-phone" id="p">`,
    `const el=document.getElementById('p');
     el.addEventListener('blur',()=>{ el.value=el.value.replace(/[^0-9+ ()-]/g,''); });`
  ),
};

// Kör hela telefonvalideringen mot lokala testformulär med känt
// beteende. Inga riktiga webbplatser används.
const ORIGIN = "https://fixture.test";

// Antal skrivande förfrågningar (POST m.fl.) som nådde "servern".
// Ska alltid vara 0: testet blockerar dem innan de skickas.
let writesReachingServer = 0;

async function runOn(page: any, formName: string) {

  writesReachingServer = 0;

  await page.route(`${ORIGIN}/**`, (route: any) => {

    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      writesReachingServer++;
    }

    return route.fulfill({
      contentType: "text/html",
      body: PHONE_FORMS[formName],
    });
  });

  return checkValidation(page, [`${ORIGIN}/${formName}`]);
}

const statusOf = (
  result: Awaited<ReturnType<typeof checkValidation>>,
  test: string
) => result.phoneTests.find((t) => t.test === test)?.status;

const testOf = (
  result: Awaited<ReturnType<typeof checkValidation>>,
  test: string
) => result.phoneTests.find((t) => t.test === test);

test("utan validering: alla tre testerna underkänns", async ({ page }) => {

  const result = await runOn(page, "plain");

  expect(statusOf(result, "typing")).toBe("failed");
  expect(statusOf(result, "short")).toBe("failed");
  expect(statusOf(result, "submit")).toBe("failed");
  expect(result.phoneFailed).toBe(3);
  expect(result.phoneTests.length).toBe(3);
  expect(writesReachingServer).toBe(0);
});

test("det finns inget inklistringstest", async ({ page }) => {

  const result = await runOn(page, "plain");

  expect(result.phoneTests.map((t) => t.test)).toEqual([
    "typing",
    "short",
    "submit",
  ]);
});

test("bokstäver som rensas med fördröjning godkänns (inte läsning för tidigt)", async ({ page }) => {

  const result = await runOn(page, "asyncFilter");

  expect(statusOf(result, "typing")).toBe("passed");
  expect(statusOf(result, "submit")).toBe("passed");
});

test("tangentbordet släpper igenom en bokstav", async ({ page }) => {

  const result = await runOn(page, "pasteCleanTypingLeaky");

  expect(statusOf(result, "typing")).toBe("failed");
  expect(testOf(result, "typing")?.resultingValue).toBe("070a123");

  // Bokstaven följer med till inskicket, som accepteras.
  expect(statusOf(result, "submit")).toBe("failed");
  expect(testOf(result, "submit")?.resultingValue).toBe("070a123");
});

test("fullständig validering godkänns i alla tre testerna", async ({ page }) => {

  const result = await runOn(page, "validated");

  expect(statusOf(result, "typing")).toBe("passed");
  expect(statusOf(result, "short")).toBe("passed");
  expect(statusOf(result, "submit")).toBe("passed");
  expect(result.phoneFailed).toBe(0);
});

test("rensning först vid blur godkänns men flaggas i detaljen", async ({ page }) => {

  const result = await runOn(page, "cleanOnBlurOnly");

  const typing = testOf(result, "typing");

  expect(typing?.status).toBe("passed");
  expect(typing?.detail).toContain("när fältet lämnades");
});

test("underkända tester rapporteras med sida och fält", async ({ page }) => {

  const result = await runOn(page, "plain");

  expect(result.phoneFailures.length).toBe(3);

  for (const failure of result.phoneFailures) {
    expect(failure.pageUrl).toBe(`${ORIGIN}/plain`);
    expect(failure.fieldType).toBe("phone");
    expect(failure.test).toBeTruthy();
  }
});

test("fält som något täcker går ändå att testa (inte 'kunde inte avgöras')", async ({ page }) => {

  const result = await runOn(page, "coveredByOverlay");

  expect(result.phoneInconclusive).toBe(0);
  expect(statusOf(result, "typing")).toBe("passed");
  expect(statusOf(result, "submit")).toBe("passed");
});

// Rena funktioner

test("lettersIn hittar även å, ä och ö", () => {

  expect(lettersIn("070abc123")).toBe("abc");
  expect(lettersIn("070åäö")).toBe("åäö");
  expect(lettersIn("+46 70 123 45 67")).toBe("");
});

test("tomt värde räknas inte som att bokstäver finns kvar", () => {

  const r = classifyLetterTest("inmatning", "070abc123", "", "");

  expect(r.status).toBe("passed");
});

// Inskick

test("inskick: formuläret accepterar bokstäver och inget når servern", async ({ page }) => {

  const result = await runOn(page, "submitAccepts");

  expect(statusOf(result, "typing")).toBe("failed");
  expect(statusOf(result, "short")).toBe("failed");

  const submit = testOf(result, "submit");

  expect(submit?.status).toBe("failed");
  expect(submit?.submission).toBe("accepted");
  expect(writesReachingServer).toBe(0);
});

test("inskick via fetch: servervalidering kan inte bedömas", async ({ page }) => {

  const result = await runOn(page, "submitFetch");

  const submit = testOf(result, "submit");

  expect(submit?.status).toBe("inconclusive");
  expect(submit?.detail).toContain("blockerades av testet");

  // Beviset: ingen skrivande förfrågan nådde "servern".
  expect(writesReachingServer).toBe(0);
});

test("inskick: webbläsarens validering stoppar ogiltiga nummer", async ({ page }) => {

  const result = await runOn(page, "submitRejectsNative");

  expect(statusOf(result, "typing")).toBe("passed");
  expect(statusOf(result, "short")).toBe("passed");

  const submit = testOf(result, "submit");

  expect(submit?.status).toBe("passed");
  expect(submit?.submission).toBe("rejected");
  expect(result.phoneFailed).toBe(0);
  expect(writesReachingServer).toBe(0);
});

test("validering först vid inskick räknas som godkänd i alla tre testerna", async ({ page }) => {

  const result = await runOn(page, "submitRejectsScript");

  // Fältet tar emot bokstäver och kort nummer, men inskicket stoppas.
  expect(statusOf(result, "typing")).toBe("passed");
  expect(statusOf(result, "short")).toBe("passed");
  expect(statusOf(result, "submit")).toBe("passed");
  expect(result.phoneFailed).toBe(0);
  expect(testOf(result, "typing")?.detail).toContain("vid inskick");
  expect(writesReachingServer).toBe(0);
});

test("formulär utan <form>-element kan ändå testas", async ({ page }) => {

  const result = await runOn(page, "noForm");

  expect(statusOf(result, "typing")).toBe("passed");
  expect(statusOf(result, "short")).toBe("passed");
  expect(statusOf(result, "submit")).toBe("passed");
  expect(result.phoneInconclusive).toBe(0);
});

test("inskick: captcha ger 'kunde inte avgöras', inte godkänt", async ({ page }) => {

  const result = await runOn(page, "submitCaptcha");

  expect(statusOf(result, "submit")).toBe("inconclusive");
  expect(writesReachingServer).toBe(0);
});

// Flerstegsformulär

test("stegformulär: telefonsteget nås och valideringen godkänns", async ({ page }) => {

  const result = await runOn(page, "conversationalStrict");

  expect(result.phoneInconclusive).toBe(0);
  expect(statusOf(result, "typing")).toBe("passed");
  expect(statusOf(result, "short")).toBe("passed");
  expect(statusOf(result, "submit")).toBe("passed");
  expect(testOf(result, "short")?.detail).toContain("Phone number is not valid");
  expect(writesReachingServer).toBe(0);
});

test("stegformulär utan validering underkänns", async ({ page }) => {

  const result = await runOn(page, "conversationalLenient");

  expect(result.phoneInconclusive).toBe(0);
  expect(statusOf(result, "typing")).toBe("failed");
  expect(statusOf(result, "short")).toBe("failed");
  expect(statusOf(result, "submit")).toBe("failed");
});

test("stegformulär som visar felet redan vid blur: inskicket stoppas", async ({ page }) => {

  const result = await runOn(page, "conversationalErrorOnBlur");

  expect(statusOf(result, "submit")).toBe("passed");
  expect(testOf(result, "submit")?.submission).toBe("rejected");
  expect(writesReachingServer).toBe(0);
});