"use client";

import { useState, useTransition } from "react";
import { getNextTargetAiAdvice } from "@/actions/aiAdvisor";
import { saveAuctionStrategy } from "@/actions/auction";

export function NextTargetAiAdvice({
  initialStrategy,
  initialAdvice,
}: {
  initialStrategy: string | null;
  initialAdvice: { text: string | null; generatedAt: string | null };
}) {
  const [isPending, startTransition] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [result, setResult] = useState<{ text: string; generatedAt: string | null } | null>(
    initialAdvice.text ? { text: initialAdvice.text, generatedAt: initialAdvice.generatedAt } : null,
  );
  const [strategy, setStrategy] = useState(initialStrategy ?? "");
  const [saved, setSaved] = useState(true);

  const run = () => {
    startTransition(async () => {
      const outcome = await getNextTargetAiAdvice();
      setResult({
        text: outcome.ok ? outcome.text : `Non disponibile: ${outcome.message}`,
        generatedAt: new Date().toISOString(),
      });
    });
  };

  const save = () => {
    startSaving(async () => {
      await saveAuctionStrategy(strategy);
      setSaved(true);
    });
  };

  return (
    <div className="mb-8 rounded-md border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-indigo-700 dark:text-indigo-400">
          Consiglio AI{" "}
          <span className="font-normal text-indigo-500 dark:text-indigo-400/70">
            — si aggiorna da solo dopo ogni assegnazione
          </span>
        </p>
        <button
          onClick={run}
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {isPending ? "Sto pensando…" : "Rigenera ora"}
        </button>
      </div>

      <label className="mb-1 block text-xs text-zinc-500">
        La tua strategia d&apos;asta (il consiglio la segue prima di ogni altro criterio)
      </label>
      <textarea
        value={strategy}
        onChange={(e) => {
          setStrategy(e.target.value);
          setSaved(false);
        }}
        onBlur={save}
        placeholder='Es. "punto tutto su 2-3 top attaccanti e risparmio in difesa", "priorità ai giovani in crescita", "niente giocatori infortunati di frequente"...'
        rows={2}
        className="mb-2 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      {!saved && (
        <p className="mb-2 text-xs text-zinc-400">
          {isSaving ? "Salvataggio…" : "Non salvata — esci dal campo per salvare automaticamente."}
        </p>
      )}

      {result ? (
        <div>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{result.text}</p>
          {result.generatedAt && (
            <p className="mt-1 text-[11px] text-zinc-400">
              Generato {new Date(result.generatedAt).toLocaleTimeString("it-IT", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          Fai la prima assegnazione (tua o di un avversario) e qui comparirà in automatico chi puntare
          dopo, incrociando strategia dichiarata, indice, fascia, storico prezzi reali, inflazione di
          mercato e slot mancanti.
        </p>
      )}
    </div>
  );
}
