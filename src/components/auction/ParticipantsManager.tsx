"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addParticipant, renameParticipant, removeParticipant, resetRosters } from "@/actions/participants";
import type { ParticipantSummary } from "@/lib/queries/participants";

export function ParticipantsManager({ participants }: { participants: ParticipantSummary[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const onAdd = () => {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      await addParticipant(name);
      setNewName("");
      router.refresh();
    });
  };

  const onRename = (id: number, current: string) => {
    const name = window.prompt("Nuovo nome squadra", current);
    if (!name || name.trim() === current) return;
    startTransition(async () => {
      await renameParticipant(id, name);
      router.refresh();
    });
  };

  const onRemove = (id: number, name: string) => {
    if (!window.confirm(`Rimuovere "${name}"? I suoi giocatori torneranno disponibili.`)) return;
    startTransition(async () => {
      await removeParticipant(id);
      router.refresh();
    });
  };

  const onResetRosters = () => {
    if (!window.confirm("Annullare tutte le assegnazioni di tutte le squadre?")) return;
    startTransition(async () => {
      await resetRosters();
      router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {participants.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <span className="font-medium">{p.isMe ? `${p.name} (tu)` : p.name}</span>
            <span className="text-xs text-zinc-500">{p.rosterCount} giocatori</span>
            {!p.isMe && (
              <>
                <button
                  onClick={() => onRename(p.id, p.name)}
                  className="text-xs text-zinc-400 underline hover:text-zinc-600"
                >
                  rinomina
                </button>
                <button
                  onClick={() => onRemove(p.id, p.name)}
                  className="text-xs text-red-400 underline hover:text-red-600"
                >
                  rimuovi
                </button>
              </>
            )}
            {p.isMe && (
              <button
                onClick={() => onRename(p.id, p.name)}
                className="text-xs text-zinc-400 underline hover:text-zinc-600"
              >
                rinomina
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Nome nuova squadra (es. Marco)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          onClick={onAdd}
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Aggiungi squadra
        </button>
        <button
          onClick={onResetRosters}
          disabled={isPending}
          className="ml-auto rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Resetta tutte le assegnazioni
        </button>
      </div>
    </div>
  );
}
