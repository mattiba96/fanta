"use client";

import { useState, useTransition } from "react";
import { refreshStatistiche, refreshListone, refreshSetPieces, type RefreshOutcome } from "@/actions/data";

type ButtonState = { pending: boolean; result: RefreshOutcome | null };

function useRefreshButton(action: () => Promise<RefreshOutcome>) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RefreshOutcome | null>(null);

  const run = () => {
    setResult(null);
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
    });
  };

  const state: ButtonState = { pending: isPending, result };
  return [state, run] as const;
}

export function UpdateDataButtons() {
  const [statsState, runStats] = useRefreshButton(refreshStatistiche);
  const [listoneState, runListone] = useRefreshButton(refreshListone);
  const [setPiecesState, runSetPieces] = useRefreshButton(refreshSetPieces);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <RefreshButton
        label="Aggiorna statistiche"
        state={statsState}
        onClick={runStats}
      />
      <RefreshButton
        label="Aggiorna listone"
        state={listoneState}
        onClick={runListone}
      />
      <RefreshButton
        label="Aggiorna rigoristi/tiratori"
        state={setPiecesState}
        onClick={runSetPieces}
      />
    </div>
  );
}

function RefreshButton({
  label,
  state,
  onClick,
}: {
  label: string;
  state: ButtonState;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onClick}
        disabled={state.pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {state.pending ? "Aggiornamento…" : label}
      </button>
      {state.result && (
        <p
          className={`max-w-xs text-xs ${
            state.result.ok
              ? "text-zinc-600 dark:text-zinc-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {state.result.message}
        </p>
      )}
    </div>
  );
}
