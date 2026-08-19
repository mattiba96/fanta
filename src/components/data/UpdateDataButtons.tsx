"use client";

import { useState, useTransition } from "react";
import { refreshAll, type RefreshAllStep } from "@/actions/data";

export function UpdateDataButtons() {
  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<RefreshAllStep[] | null>(null);

  const run = () => {
    setReport(null);
    startTransition(async () => {
      const steps = await refreshAll();
      setReport(steps);
    });
  };

  return (
    <div>
      <button
        onClick={run}
        disabled={isPending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
      >
        {isPending ? "Aggiornamento in corso… (qualche minuto)" : "Aggiorna tutto"}
      </button>

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
    </div>
  );
}
