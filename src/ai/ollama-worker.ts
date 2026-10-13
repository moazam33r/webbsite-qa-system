
import http from "http";
import https from "https";

import {
  getOllamaUrl,
  OLLAMA_MODEL,
  OLLAMA_TIMEOUT_MS,
} from "./ollama-config";

const ollamaUrl = getOllamaUrl("/api/chat");

const httpClient =
  ollamaUrl.protocol === "https:" ? https : http;

const prompt = process.argv.slice(2).join(" ");

if (!prompt) {
  console.error("Ingen prompt skickades till Ollama.");
  process.exit(1);
}

function checkOllamaConnection(): Promise<void> {
  return new Promise((resolve, reject) => {
    const tagsUrl = getOllamaUrl("/api/tags");
    const client = tagsUrl.protocol === "https:" ? https : http;

    const request = client.get(tagsUrl, (response) => {
      response.resume();

      if (response.statusCode === 200) {
        resolve();
      } else {
        reject(
          new Error(
            `Ollama svarade med HTTP ${response.statusCode}.`
          )
        );
      }
    });

    request.on("error", () => {
      reject(
        new Error(
          `Kunde inte ansluta till Ollama på ${tagsUrl.origin}. ` +
            "Kontrollera att Ollama är installerat och körs."
        )
      );
    });

    request.setTimeout(OLLAMA_TIMEOUT_MS, () => {
      request.destroy();
      reject(
        new Error("Timeout när Ollama-servern kontrollerades.")
      );
    });
  });
}

function checkOllamaModel(): Promise<void> {
  return new Promise((resolve, reject) => {
    const tagsUrl = getOllamaUrl("/api/tags");
    const client = tagsUrl.protocol === "https:" ? https : http;

    const request = client.get(tagsUrl, (response) => {
      let responseBody = "";

      response.on("data", (chunk) => {
        responseBody += chunk.toString();
      });

      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(
            new Error(
              `Kunde inte läsa Ollamas modeller. ` +
                `HTTP ${response.statusCode}.`
            )
          );
          return;
        }

        try {
          const data = JSON.parse(responseBody);

          const installedModels: string[] = Array.isArray(
            data.models
          )
            ? data.models
                .map((model: { name?: string }) => model.name)
                .filter(
                  (name: string | undefined): name is string =>
                    typeof name === "string"
                )
            : [];

          const modelIsInstalled = OLLAMA_MODEL.includes(":")
            ? installedModels.includes(OLLAMA_MODEL)
            : installedModels.some(
                (name) => name.split(":")[0] === OLLAMA_MODEL
              );

          if (!modelIsInstalled) {
            reject(
              new Error(
                `Modellen "${OLLAMA_MODEL}" är inte installerad. ` +
                  `Kör: ollama pull ${OLLAMA_MODEL}`
              )
            );
            return;
          }

          resolve();
        } catch (error) {
          reject(
            new Error(
              `Kunde inte läsa Ollamas modellsvar: ${error}`
            )
          );
        }
      });
    });

    request.on("error", (error) => {
      reject(
        new Error(
          `Kunde inte kontrollera Ollamas modell: ${error.message}`
        )
      );
    });

    request.setTimeout(OLLAMA_TIMEOUT_MS, () => {
      request.destroy();
      reject(
        new Error("Timeout när Ollamas modell kontrollerades.")
      );
    });
  });
}

// Används för att hålla AI-granskningens svar korta och strukturerade.
const isTextReview = prompt.includes("LIKELY_SPELLING");

const body = JSON.stringify({
  model: OLLAMA_MODEL,
  messages: [
    {
      role: "system",
      content: isTextReview
        ? [
            "Du är en svensk korrekturläsare.",
            "Granska varje ord utifrån sammanhanget.",
            "Bedöm svenska fackord och sammansättningar försiktigt.",
            "Följ exakt JSON-formatet som anges i instruktionen.",
            "Skriv ingen analys eller text utanför JSON.",
            "Använd endast LIKELY_SPELLING, LIKELY_CORRECT eller REVIEW.",
            "Returnera ett resultat för varje id.",
          ].join(" ")
        : [
            "Du är en svensk QA-analysassistent.",
            "Svara endast på svenska.",
            "Skriv den färdiga QA-analysen utan resonemang.",
            "Börja med '1. Vad fungerar bra'.",
          ].join(" "),
    },
    {
      role: "user",
      content: prompt,
    },
  ],
  stream: false,
  think: false,
  ...(isTextReview ? { format: "json" } : {}),
  options: {
    num_predict: isTextReview ? 2600 : 350,
    temperature: 0.1,
  },
});

async function run(): Promise<void> {
  try {
    await checkOllamaConnection();
    await checkOllamaModel();

    await new Promise<void>((resolve, reject) => {
      const request = httpClient.request(
        {
          hostname: ollamaUrl.hostname,
          port: ollamaUrl.port
            ? Number(ollamaUrl.port)
            : ollamaUrl.protocol === "https:"
              ? 443
              : 80,
          path: `${ollamaUrl.pathname}${ollamaUrl.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: OLLAMA_TIMEOUT_MS,
        },
        (response) => {
          let responseBody = "";

          response.on("data", (chunk) => {
            responseBody += chunk.toString();
          });

          response.on("end", () => {
            if (response.statusCode !== 200) {
              reject(
                new Error(
                  `Ollama status: ${response.statusCode}. ` +
                    responseBody.slice(0, 1000)
                )
              );
              return;
            }

            try {
              const data = JSON.parse(responseBody);
              let answer = data.message?.content ?? "";

              if (typeof answer !== "string" || !answer.trim()) {
                reject(new Error("Ollama skickade ett tomt svar."));
                return;
              }

              
              answer = answer
                .replace(/<think>[\s\S]*?<\/think>/gi, "")
                .trim();

              console.log(answer);
              resolve();
            } catch (error) {
              reject(
                new Error(
                  `Kunde inte läsa Ollama-svaret: ${error}`
                )
              );
            }
          });
        }
      );

      request.on("error", (error) => {
        reject(new Error(`Ollama-fel: ${error.message}`));
      });

      request.on("timeout", () => {
        request.destroy(
          new Error(
            `Ollama timeout efter ${OLLAMA_TIMEOUT_MS} ms.`
          )
        );
      });

      request.write(body);
      request.end();
    });
  } catch (error) {
    console.error(
      "Ollama-anropet misslyckades:",
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  }
}

run();