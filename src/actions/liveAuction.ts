"use server";

import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { isLocalEnvironment } from "@/lib/liveAuction/fantaAstaReader";

const exec = promisify(execCallback);

export type LaunchOutcome = {
  ok: boolean;
  message: string;
};

export async function launchFantaAstaDesktop(): Promise<LaunchOutcome> {
  if (!isLocalEnvironment()) {
    return {
      ok: false,
      message:
        "Questo pulsante apre un'app sul Mac dell'utente: non ha effetto dal sito online, il server remoto non può lanciare programmi sul tuo computer. Usa Fantacucciolo in locale (npm run dev).",
    };
  }

  try {
    // Percorso assoluto invece di affidarsi al PATH: il processo Next.js può
    // girare in un ambiente (es. avviato da un tool esterno) il cui PATH non
    // include /usr/bin, dove "open" altrimenti risulterebbe "not found" pur
    // essendo sempre presente su macOS a questo percorso fisso.
    await exec('/usr/bin/open -a "FantaAsta Desktop" --args --remote-debugging-port=9222');
    return {
      ok: true,
      message: "FantaAsta Desktop avviata con il debug remoto attivo.",
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Impossibile avviare FantaAsta Desktop: verifica che l'app sia installata in /Applications. Dettagli: ${detail}`,
    };
  }
}
