"use client";

import { useState, useTransition } from "react";
import { refreshAll, refreshCalendario, type RefreshAllStep, type RefreshOutcome } from "@/actions/data";

export function UpdateDataButtons() {
  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<RefreshAllStep[] | null>(null);
  const [isCalendarPending, startCalendarTransition] = useTransition();
  const [calendarResult, setCalendarResult] = useState<RefreshOutcome | null>(null);

  const run = () => {
    setReport(null);
    startTransition(async () => {
      const steps = await refreshAll();
      setReport(steps);
    });
  };

  const runCalendar = () => {
    setCalendarResult(null);
    startCalendarTransition(async () => {
      const outcome = await refreshCalendario();
      setCalendarResult(outcome);
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={run}
          disabled={isPending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {isPending ? "Aggiornamento in corso… (qualche minuto)" : "Aggiorna tutto"}
        </button>
        <button
          onClick={runCalendar}
          disabled={isCalendarPending}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {isCalendarPending ? "Scarico il calendario… (fino a 2 minuti)" : "Aggiorna calendario"}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-zinc-400">
        Il calendario (38 giornate) serve alla griglia portieri/attaccanti — cambia raramente, quindi ha un
        bottone separato.
      </p>

      {report && (
        <div className="mt-3 max-w-md rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-medium text-zinc-500">Report aggiornamento</p>
          <ul className="space-y-1.5">
            {report.map((step, i) => (
              <li key={i} className="text-sm">
                <span
                  className={
                    step.outcome.ok
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }
                >
                  {step.outcome.ok ? "✓" : "✕"}
                </span>{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{step.label}:</span>{" "}
                <span className="text-zinc-600 dark:text-zinc-400">{step.outcome.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {calendarResult && (
        <div className="mt-3 max-w-md rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm">
            <span
              className={
                calendarResult.ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }
            >
              {calendarResult.ok ? "✓" : "✕"}
            </span>{" "}
            <span className="text-zinc-600 dark:text-zinc-400">{calendarResult.message}</span>
          </p>
        </div>
      )}
    </div>
  );
}
