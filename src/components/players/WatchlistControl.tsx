"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWatchlistEntry, removeFromWatchlist } from "@/actions/watchlist";

export type WatchlistInitial = {
  targetPrice: number | null;
  priority: number | null;
  note: string | null;
} | null;

export function WatchlistControl({
  playerId,
  initial,
}: {
  playerId: number;
  initial: WatchlistInitial;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetPrice, setTargetPrice] = useState(initial?.targetPrice?.toString() ?? "");
  const [priority, setPriority] = useState(String(initial?.priority ?? 2));
  const [note, setNote] = useState(initial?.note ?? "");
  const [isPending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      await setWatchlistEntry({
        playerId,
        targetPrice: targetPrice ? Number(targetPrice) : null,
        priority: Number(priority) || 2,
        note,
      });
      setOpen(false);
      router.refresh();
    });
  };

  const remove = () => {
    startTransition(async () => {
      await removeFromWatchlist(playerId);
      setOpen(false);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
          initial
            ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300"
            : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        {initial
          ? `★ Obiettivo${initial.targetPrice != null ? ` (max ${initial.targetPrice})` : ""}`
          : "☆ Aggiungi a obiettivi"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <label className="flex items-center gap-1 text-xs text-zinc-500">
        Prezzo max
        <input
          type="number"
          min={0}
          value={targetPrice}
          onChange={(e) => setTargetPrice(e.target.value)}
          className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
        className="rounded border border-zinc-300 px-1 py-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      >
        <option value="1">Priorità alta</option>
        <option value="2">Priorità media</option>
        <option value="3">Priorità bassa</option>
      </select>
      <input
        type="text"
        placeholder="Nota (opzionale)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="min-w-[10rem] flex-1 rounded border border-zinc-300 px-2 py-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      <button
        onClick={save}
        disabled={isPending}
        className="rounded bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Salva
      </button>
      {initial && (
        <button
          onClick={remove}
          disabled={isPending}
          className="text-xs text-red-500 underline hover:text-red-600"
        >
          rimuovi
        </button>
      )}
      <button onClick={() => setOpen(false)} className="text-xs text-zinc-400">
        ✕
      </button>
    </div>
  );
}
