"use server";

import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCallback);

export type LaunchOutcome = {
  ok: boolean;
  message: string;
};

export async function launchFantaAstaDesktop(): Promise<LaunchOutcome> {
  try {
    await exec('open -a "FantaAsta Desktop" --args --remote-debugging-port=9222');
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
