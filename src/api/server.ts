// =========================================================
// WEBSITE QA SYSTEM API-SERVER
// =========================================================

// Express används för att skapa API-servern.
import express from "express";

// Chromium används för att köra Playwright-skanningarna.
import { chromium } from "@playwright/test";

// fs används för att kontrollera PDF-filer.
import fs from "fs";

// path används för säkra filsökvägar.
import path from "path";

// os används för att hitta operativsystemets temporära mapp.
import os from "os";

// Importerar själva QA-systemets scanner.
import { scanWebsite } from "../website-scanner";

// Importerar funktionerna som skapar PDF-rapporter.
import {
    createPDFReport,
    createCSVPDFReport,
    CSVPDFReportItem,
} from "../report/pdf-report";


// =========================================================
// SERVER
// =========================================================

// Skapar Express-applikationen.
const app = express();

// Porten som API-servern kör på.
const PORT = 3000;


// =========================================================
// JSON
// =========================================================

// Tillåter JSON-data från extensionen.
app.use(express.json());


// =========================================================
// CORS
// =========================================================

// Tillåter Chrome Extension att kommunicera med API-servern.
app.use((req, res, next) => {

    // Tillåter anrop från extensionen.
    res.header(
        "Access-Control-Allow-Origin",
        "*"
    );

    // Tillåter GET, POST och OPTIONS.
    res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );

    // Tillåter Content-Type-headern.
    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    // Hanterar CORS preflight-anrop.
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});


// =========================================================
// HEALTH CHECK
// =========================================================

app.get(
    "/api/health",
    (_req, res) => {

        // Returnerar att API-servern fungerar.
        res.json({
            status: "ok",
            message: "Website QA System API fungerar.",
        });
    }
);


// =========================================================
// VANLIG WEBBPLATSSKANNING
// =========================================================
//
// Denna endpoint behålls för kompatibilitet.
//
// Den returnerar resultatet först när hela skanningen
// och PDF-rapporten är färdiga.
//
// För progress används /api/scan-progress längre ner.
// =========================================================

app.post(
    "/api/scan",
    async (req, res) => {

        // Hämtar URL från requesten.
        const { url, tests } = req.body;

        // Kontrollerar att URL finns.
        if (
            !url ||
            typeof url !== "string"
        ) {
            return res.status(400).json({
                error: "En giltig URL måste anges.",
            });
        }

        // Tar bort onödiga mellanslag.
        const websiteUrl = url.trim();

        // Kontrollerar URL-formatet.
        if (!/^https?:\/\/.+/i.test(websiteUrl)) {
            return res.status(400).json({
                error:
                    "URL måste börja med http:// eller https://",
            });
        }

        let browser;
        let page;

        try {

            // Loggar vilken webbplats som skannas.
            console.log(
                `Startar QA-skanning: ${websiteUrl}`
            );

            // Startar Chromium.
            browser = await chromium.launch();

            // Skapar en ny sida.
            page = await browser.newPage();

            // Kör hela QA-systemet.
            const result = await scanWebsite(
                page,
                websiteUrl,
                undefined,
                { tests }
            );

            // Skapar PDF för webbplatsen.
            const pdfPath = await createPDFReport({
                websiteUrl: result.url,
                results: result.results,
                aiAnalysis: result.aiAnalysis,
                selectedTests: result.selectedTests,
                allTestsSelected: result.allTestsSelected,
            });

            // Hämtar endast PDF-filens namn.
            const pdfFilename =
                path.basename(pdfPath);

            // Skapar URL som extensionen kan använda.
            const pdfUrl =
                `http://localhost:${PORT}/api/reports/` +
                `${encodeURIComponent(pdfFilename)}`;

            // Returnerar hela resultatet.
            return res.status(200).json({
                ...result,
                pdfPath,
                pdfUrl,
            });

        } catch (error) {

            // Loggar felet i terminalen.
            console.error(
                "QA-skanning misslyckades:",
                error
            );

            // Returnerar ett API-fel.
            return res.status(500).json({
                error:
                    "QA-skanningen kunde inte genomföras.",
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
            });

        } finally {

            // Stänger sidan.
            if (page) {
                await page.close();
            }

            // Stänger browsern.
            if (browser) {
                await browser.close();
            }
        }
    }
);


// =========================================================
// VANLIG WEBBPLATSSKANNING MED RIKTIG PROGRESS
// =========================================================
//
// Denna endpoint används av popupen när en enda
// webbplats ska analyseras.
//
// Progress skickas via Server-Sent Events.
//
// Viktigt:
//
// 0–95 % = själva QA-analysen
// 100 %   = QA + PDF färdiga
//
// Ingen timer används.
// Ingen slumpmässig progress används.
// All progress kommer från backend.
// =========================================================

app.post(
    "/api/scan-progress",
    async (req, res) => {

        // Hämtar URL från requesten.
        const { url, tests } = req.body;

        // =====================================================
        // VALIDERING
        // =====================================================

        // Kontrollerar att URL finns.
        if (
            !url ||
            typeof url !== "string"
        ) {
            return res.status(400).json({
                error: "En giltig URL måste anges.",
            });
        }

        // Tar bort onödiga mellanslag.
        const websiteUrl = url.trim();

        // Kontrollerar URL-formatet.
        if (!/^https?:\/\/.+/i.test(websiteUrl)) {
            return res.status(400).json({
                error:
                    "URL måste börja med http:// eller https://",
            });
        }


        // =====================================================
        // SSE-STREAM
        // =====================================================

        // Anger att svaret är Server-Sent Events.
        res.status(200);

        // Anger korrekt Content-Type.
        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );

        // Förhindrar cache.
        res.setHeader(
            "Cache-Control",
            "no-cache"
        );

        // Håller anslutningen öppen.
        res.setHeader(
            "Connection",
            "keep-alive"
        );

        // Skickar headers direkt.
        res.flushHeaders();


        // =====================================================
        // SKICKA PROGRESS
        // =====================================================

        // Skickar ett progress-event till extensionen.
        const sendProgress = (
            percentage: number,
            message: string
        ) => {

            // Säkerställer att procenten ligger mellan 0 och 100.
            const safePercentage =
                Math.max(
                    0,
                    Math.min(
                        100,
                        Math.round(percentage)
                    )
                );

            // Skickar SSE-eventet.
            res.write(
                `event: progress\n` +
                `data: ${JSON.stringify({
                    percentage: safePercentage,
                    websiteUrl,
                    message,
                })}\n\n`
            );
        };


        // =====================================================
        // START-EVENT
        // =====================================================

        // Meddelar extensionen att analysen har startat.
        res.write(
            `event: started\n` +
            `data: ${JSON.stringify({
                websiteUrl,
                percentage: 0,
                message:
                    "Startar QA-skanning...",
            })}\n\n`
        );


        // =====================================================
        // BROWSER
        // =====================================================

        let browser;
        let page;

        try {

            // Loggar vilken webbplats som analyseras.
            console.log(
                `QA progress-skanning: ${websiteUrl}`
            );

            // Startar Chromium.
            browser = await chromium.launch();

            // Skapar Playwright-sida.
            page = await browser.newPage();


            // =================================================
            // QA-SKANNING
            // =================================================

            // Kör hela QA-systemet.
            //
            // scanWebsite() skickar progress mellan 0 och 100.
            //
            // Vi använder 95 % som gräns för själva QA-delen.
            // De sista 5 % används för PDF-genereringen.
            const result = await scanWebsite(
                page,
                websiteUrl,
                (
                    sitePercentage,
                    message
                ) => {

                    // Omvandlar scanner-progress 0–100
                    // till total progress 0–95.
                    const overallPercentage =
                        Math.round(
                            (
                                sitePercentage / 100
                            ) * 95
                        );

                    // Skickar den riktiga progressen.
                    sendProgress(
                        overallPercentage,
                        message
                    );
                },
                { tests }
            );


            // =================================================
            // QA-ANALYS KLAR
            // =================================================

            // Skickar 95 % när hela QA-systemet är färdigt.
            //
            // PDF återstår fortfarande.
            sendProgress(
                95,
                "QA-analysen är klar. Skapar PDF-rapport..."
            );


            // =================================================
            // PDF
            // =================================================

            // Skapar PDF-rapporten.
            const pdfPath =
                await createPDFReport({
                    websiteUrl: result.url,
                    results: result.results,
                    aiAnalysis: result.aiAnalysis,
                    selectedTests: result.selectedTests,
                    allTestsSelected: result.allTestsSelected,
                });

            // Hämtar PDF-filens namn.
            const pdfFilename =
                path.basename(pdfPath);

            // Skapar PDF-URL.
            const pdfUrl =
                `http://localhost:${PORT}/api/reports/` +
                `${encodeURIComponent(pdfFilename)}`;


            // =================================================
            // 100 %
            // =================================================

            // Här är både QA-analysen och PDF-rapporten färdiga.
            sendProgress(
                100,
                "QA-skanning och PDF-rapport är klara."
            );


            // =================================================
            // COMPLETE
            // =================================================

            // Skickar slutresultatet.
            res.write(
                `event: complete\n` +
                `data: ${JSON.stringify({
                    ...result,
                    pdfPath,
                    pdfUrl,
                    percentage: 100,
                })}\n\n`
            );

            // Avslutar SSE-streamen.
            res.end();

        } catch (error) {

            // Loggar backend-felet.
            console.error(
                "QA progress-skanning misslyckades:",
                error
            );

            // Skickar ett riktigt fel till extensionen.
            res.write(
                `event: error\n` +
                `data: ${JSON.stringify({
                    error:
                        "QA-skanningen kunde inte genomföras.",
                    message:
                        error instanceof Error
                            ? error.message
                            : String(error),
                })}\n\n`
            );

            // Avslutar streamen.
            res.end();

        } finally {

            // Stänger sidan.
            if (page) {
                await page.close();
            }

            // Stänger Chromium.
            if (browser) {
                await browser.close();
            }
        }
    }
);


// =========================================================
// CSV-SKANNING
// =========================================================
//
// Den vanliga CSV-endpointen lämnas kvar.
//
// Den används som fallback och påverkas inte av
// den nya progresslösningen.
// =========================================================

app.post(
    "/api/scan-csv",
    async (req, res) => {

        // Hämtar URL-listan.
        const { urls, tests } = req.body;

        // Kontrollerar att urls är en array.
        if (!Array.isArray(urls)) {
            return res.status(400).json({
                error: "urls måste vara en array.",
            });
        }

        // Kontrollerar att minst en URL finns.
        if (urls.length === 0) {
            return res.status(400).json({
                error:
                    "Minst en URL måste anges.",
            });
        }

        // Kontrollerar alla URL:er.
        const invalidUrls =
            urls.filter(
                (url) =>
                    typeof url !== "string" ||
                    !/^https?:\/\/.+/i.test(
                        url.trim()
                    )
            );

        // Returnerar fel om någon URL är ogiltig.
        if (invalidUrls.length > 0) {
            return res.status(400).json({
                error:
                    "En eller flera URL:er är ogiltiga.",
                invalidUrls,
            });
        }

        // Här samlar vi resultaten.
        const results: CSVPDFReportItem[] = [];

        // Startar EN Chromium-browser.
        const browser =
            await chromium.launch();

        try {

            // Skannar varje webbplats.
            for (const url of urls) {

                // Rensar URL.
                const websiteUrl =
                    url.trim();

                console.log(
                    `CSV QA-skanning: ${websiteUrl}`
                );

                // Skapar en ny sida.
                const page =
                    await browser.newPage();

                try {

                    // Kör QA-systemet.
                    const result =
                        await scanWebsite(
                            page,
                            websiteUrl,
                            undefined,
                            { tests }
                        );

                    // Sparar resultatet.
                    results.push({
                        success: true,
                        websiteUrl:
                            result.url,
                        results:
                            result.results,
                        aiAnalysis:
                            result.aiAnalysis,
                        selectedTests:
                            result.selectedTests,
                        allTestsSelected:
                            result.allTestsSelected,
                    });

                } catch (error) {

                    // Sparar även misslyckade webbplatser.
                    results.push({
                        success: false,
                        websiteUrl,
                        results: [],
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });

                } finally {

                    // Stänger sidan.
                    await page.close();
                }
            }


            // =================================================
            // GEMENSAM PDF
            // =================================================

            // Skapar EN PDF för alla webbplatser.
            const pdfPath =
                await createCSVPDFReport(
                    results
                );

            // Hämtar PDF-filens namn.
            const pdfFilename =
                path.basename(pdfPath);

            // Skapar PDF-URL.
            const pdfUrl =
                `http://localhost:${PORT}/api/reports/` +
                `${encodeURIComponent(pdfFilename)}`;

            // Räknar lyckade webbplatser.
            const completed =
                results.filter(
                    (result) =>
                        result.success
                ).length;

            // Räknar misslyckade webbplatser.
            const failed =
                results.filter(
                    (result) =>
                        !result.success
                ).length;

            // Returnerar resultatet.
            return res.status(200).json({
                total: urls.length,
                completed,
                failed,
                results,
                pdfPath,
                pdfUrl,
            });

        } catch (error) {

            // Loggar CSV-felet.
            console.error(
                "CSV-skanning misslyckades:",
                error
            );

            // Returnerar API-fel.
            return res.status(500).json({
                error:
                    "CSV-skanningen kunde inte genomföras.",
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
            });

        } finally {

            // Stänger Chromium.
            await browser.close();
        }
    }
);


// =========================================================
// CSV-SKANNING MED RIKTIG PROGRESS
// =========================================================
//
// Varje webbplats har sin egen 0–100%-progress.
//
// Total CSV-progress räknas ut från aktuell webbplats.
//
// 0–95 % = QA-analyser
// 100 %   = QA + gemensam PDF klar
//
// Ingen timer används.
// =========================================================

app.post(
    "/api/scan-csv-progress",
    async (req, res) => {

        // Hämtar URL-listan.
        const { urls, tests } = req.body;


        // =====================================================
        // VALIDERING
        // =====================================================

        // Kontrollerar array.
        if (!Array.isArray(urls)) {
            return res.status(400).json({
                error: "urls måste vara en array.",
            });
        }

        // Kontrollerar att minst en URL finns.
        if (urls.length === 0) {
            return res.status(400).json({
                error:
                    "Minst en URL måste anges.",
            });
        }

        // Kontrollerar alla URL:er.
        const invalidUrls =
            urls.filter(
                (url) =>
                    typeof url !== "string" ||
                    !/^https?:\/\/.+/i.test(
                        url.trim()
                    )
            );

        // Stoppar om någon URL är ogiltig.
        if (invalidUrls.length > 0) {
            return res.status(400).json({
                error:
                    "En eller flera URL:er är ogiltiga.",
                invalidUrls,
            });
        }


        // =====================================================
        // SSE
        // =====================================================

        // Anger Server-Sent Events.
        res.status(200);

        // Anger korrekt MIME-type.
        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );

        // Förhindrar cache.
        res.setHeader(
            "Cache-Control",
            "no-cache"
        );

        // Håller anslutningen öppen.
        res.setHeader(
            "Connection",
            "keep-alive"
        );

        // Skickar headers direkt.
        res.flushHeaders();


        // =====================================================
        // SKICKA CSV-PROGRESS
        // =====================================================

        const sendSiteProgress = (
            completed: number,
            total: number,
            websiteUrl: string,
            sitePercentage: number,
            message: string
        ) => {

            // Begränsar aktuell webbplats till 0–100.
            const safeSitePercentage =
                Math.max(
                    0,
                    Math.min(
                        100,
                        Math.round(sitePercentage)
                    )
                );

            // Varje webbplats representerar lika stor
            // del av den totala progressen.
            const websiteWeight =
                100 / total;

            // Räknar hur mycket tidigare webbplatser
            // representerar.
            const completedPercentage =
                completed * websiteWeight;

            // Räknar total progress.
            const rawOverallPercentage =
                completedPercentage +
                (
                    safeSitePercentage / 100
                ) * websiteWeight;

            // QA-progress får maximalt nå 95 %.
            //
            // De sista 5 % används när PDF-rapporten skapas.
            const overallPercentage =
                Math.min(
                    95,
                    Math.round(
                        rawOverallPercentage
                    )
                );

            // Skickar progress-event.
            res.write(
                `event: progress\n` +
                `data: ${JSON.stringify({
                    completed,
                    total,
                    websiteUrl,
                    sitePercentage:
                        safeSitePercentage,
                    percentage:
                        overallPercentage,
                    message,
                })}\n\n`
            );
        };


        // =====================================================
        // WEBBPLATS STARTAR
        // =====================================================

        const sendWebsiteStart = (
            completed: number,
            total: number,
            websiteUrl: string
        ) => {

            // Den nya webbplatsen börjar på 0 %.
            const sitePercentage = 0;

            // Varje webbplats har samma vikt.
            const websiteWeight =
                100 / total;

            // Räknar tidigare färdig progress.
            const overallPercentage =
                Math.min(
                    95,
                    Math.round(
                        completed *
                        websiteWeight
                    )
                );

            // Skickar start-event.
            res.write(
                `event: website-start\n` +
                `data: ${JSON.stringify({
                    completed,
                    total,
                    websiteUrl,
                    sitePercentage,
                    percentage:
                        overallPercentage,
                    message:
                        `Startar analys av ${websiteUrl}...`,
                })}\n\n`
            );
        };


        // =====================================================
        // START
        // =====================================================

        // Meddelar popupen att CSV-analysen börjar.
        res.write(
            `event: started\n` +
            `data: ${JSON.stringify({
                total: urls.length,
                percentage: 0,
                message:
                    "Startar QA-analys...",
            })}\n\n`
        );


        // =====================================================
        // RESULTAT
        // =====================================================

        // Samlar resultat från alla webbplatser.
        const results: CSVPDFReportItem[] = [];


        // =====================================================
        // BROWSER
        // =====================================================

        // Startar EN Chromium-browser.
        const browser =
            await chromium.launch();

        try {

            // Räknare för färdiga webbplatser.
            let completedCount = 0;


            // =================================================
            // SKANNA WEBBPLATSERNA
            // =================================================

            for (const url of urls) {

                // Rensar URL.
                const websiteUrl =
                    url.trim();

                console.log(
                    `CSV QA-skanning med progress: ${websiteUrl}`
                );


                // -------------------------------------------------
                // STARTA WEBBPLATS
                // -------------------------------------------------

                sendWebsiteStart(
                    completedCount,
                    urls.length,
                    websiteUrl
                );


                // Skapar Playwright-sida.
                const page =
                    await browser.newPage();

                try {

                    // Kör hela QA-systemet.
                    const result =
                        await scanWebsite(
                            page,
                            websiteUrl,

                            // Tar emot riktig progress.
                            (
                                sitePercentage,
                                message
                            ) => {

                                // Skickar progress vidare.
                                sendSiteProgress(
                                    completedCount,
                                    urls.length,
                                    websiteUrl,
                                    sitePercentage,
                                    message
                                );
                            },
                            { tests }
                        );


                    // Sparar lyckat resultat.
                    results.push({
                        success: true,
                        websiteUrl:
                            result.url,
                        results:
                            result.results,
                        aiAnalysis:
                            result.aiAnalysis,
                        selectedTests:
                            result.selectedTests,
                        allTestsSelected:
                            result.allTestsSelected,
                    });

                } catch (error) {

                    // Sparar även misslyckad webbplats.
                    results.push({
                        success: false,
                        websiteUrl,
                        results: [],
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });

                } finally {

                    // Stänger sidan.
                    await page.close();

                    // Webbplatsen är nu färdig.
                    completedCount++;

                    // Markerar aktuell webbplats som 100 %.
                    //
                    // Total progress är fortfarande maximalt 95 %.
                    sendSiteProgress(
                        completedCount - 1,
                        urls.length,
                        websiteUrl,
                        100,
                        `Analys klar för ${websiteUrl}.`
                    );
                }
            }


            // =================================================
            // ALLA WEBBPLATSER KLARA
            // =================================================

            // Meddelar att QA-delen är färdig.
            //
            // PDF återstår.
            res.write(
                `event: progress\n` +
                `data: ${JSON.stringify({
                    completed: completedCount,
                    total: urls.length,
                    percentage: 95,
                    sitePercentage: 100,
                    message:
                        "Alla webbplatser är analyserade. Skapar PDF-rapport...",
                })}\n\n`
            );


            // =================================================
            // GEMENSAM PDF
            // =================================================

            // Skapar gemensam PDF.
            const pdfPath =
                await createCSVPDFReport(
                    results
                );


            // PDF är nu färdig.
            const pdfFilename =
                path.basename(pdfPath);


            // Skapar PDF-URL.
            const pdfUrl =
                `http://localhost:${PORT}/api/reports/` +
                `${encodeURIComponent(pdfFilename)}`;


            // Räknar lyckade webbplatser.
            const completed =
                results.filter(
                    (result) =>
                        result.success
                ).length;


            // Räknar misslyckade webbplatser.
            const failed =
                results.filter(
                    (result) =>
                        !result.success
                ).length;


            // =================================================
            // 100 %
            // =================================================

            // Nu är både QA och PDF färdiga.
            res.write(
                `event: pdf\n` +
                `data: ${JSON.stringify({
                    percentage: 100,
                    message:
                        "PDF-rapporten är skapad.",
                })}\n\n`
            );


            // =================================================
            // COMPLETE
            // =================================================

            // Skickar slutresultatet.
            res.write(
                `event: complete\n` +
                `data: ${JSON.stringify({
                    total: urls.length,
                    completed,
                    failed,
                    results,
                    pdfPath,
                    pdfUrl,
                    percentage: 100,
                })}\n\n`
            );

            // Avslutar streamen.
            res.end();

        } catch (error) {

            // Loggar felet.
            console.error(
                "CSV progress-skanning misslyckades:",
                error
            );

            // Skickar felet till extensionen.
            res.write(
                `event: error\n` +
                `data: ${JSON.stringify({
                    error:
                        "CSV-skanningen kunde inte genomföras.",
                    message:
                        error instanceof Error
                            ? error.message
                            : String(error),
                })}\n\n`
            );

            // Avslutar streamen.
            res.end();

        } finally {

            // Stänger Chromium.
            await browser.close();
        }
    }
);


// =========================================================
// HÄMTA PDF
// =========================================================

app.get(
    "/api/reports/:filename",
    (req, res) => {

        // Hämtar filnamnet.
        const filename =
            req.params.filename;

        // Endast PDF-filer får hämtas.
        if (
            !filename
                .toLowerCase()
                .endsWith(".pdf")
        ) {
            return res.status(400).json({
                error:
                    "Endast PDF-filer kan hämtas.",
            });
        }

        // Förhindrar ogiltiga sökvägar.
        if (
            path.basename(filename) !== filename
        ) {
            return res.status(400).json({
                error:
                    "Ogiltigt filnamn.",
            });
        }

        // PDF-filerna hämtas från systemets temporära mapp.
        const reportsDirectory =
            path.join(
                os.tmpdir(),
                "website-qa-system"
            );

        // Skapar komplett sökväg.
        const pdfPath =
            path.join(
                reportsDirectory,
                filename
            );

        // Kontrollerar att PDF-filen finns.
        if (!fs.existsSync(pdfPath)) {
            return res.status(404).json({
                error:
                    "PDF-rapporten kunde inte hittas.",
            });
        }

        // Skickar PDF-filen till extensionen.
        return res.sendFile(pdfPath);
    }
);


// =========================================================
// STARTA SERVERN
// =========================================================

app.listen(
    PORT,
    () => {

        // Visar serveradress.
        console.log(
            `API-server körs på http://localhost:${PORT}`
        );

        // Visar health endpoint.
        console.log(
            `Health check: http://localhost:${PORT}/api/health`
        );

        // Visar vanlig scan endpoint.
        console.log(
            `Scan endpoint: http://localhost:${PORT}/api/scan`
        );

        // Visar nya progress-endpointen.
        console.log(
            `Scan progress endpoint: http://localhost:${PORT}/api/scan-progress`
        );

        // Visar vanlig CSV-endpoint.
        console.log(
            `CSV endpoint: http://localhost:${PORT}/api/scan-csv`
        );

        // Visar CSV progress-endpoint.
        console.log(
            `CSV progress endpoint: http://localhost:${PORT}/api/scan-csv-progress`
        );

        // Visar PDF-endpoint.
        console.log(
            `PDF endpoint: http://localhost:${PORT}/api/reports/:filename`
        );
    }
);