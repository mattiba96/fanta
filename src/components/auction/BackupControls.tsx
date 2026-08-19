"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importAuctionState } from "@/actions/backup";

export function BackupControls() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !window.confirm(
        "Importare questo backup sostituirà completamente squadre, assegnazioni e obiettivi attuali. Continuare?",
      )
    ) {
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      startTransition(async () => {
        const result = await importAuctionState(text);
        setMessage({ ok: result.ok, text: result.message });
        router.refresh();
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href="/api/export-asta"
        download
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
      >
        Esporta asta
      </a>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isPending}
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {isPending ? "Importazione…" : "Importa asta"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        onChange={onFileSelected}
        className="hidden"
      />
      {message && (
        <p className={`w-full text-xs ${message.ok ? "text-zinc-500" : "text-red-500"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
