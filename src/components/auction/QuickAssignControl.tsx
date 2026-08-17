"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignPlayer, undoPick } from "@/actions/auction";

export function QuickAssignControl({
  playerId,
  roleClassic,
  isAvailable,
  ownedBy,
  pricePaid,
}: {
  playerId: number;
  roleClassic: string | null;
  isAvailable: boolean;
  ownedBy: "me" | "other" | null;
  pricePaid: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("1");
  const [isPending, startTransition] = useTransition();

  const doAssign = (owner: "me" | "other") => {
    const parsed = Number(price);
    startTransition(async () => {
      await assignPlayer({
        playerId,
        owner,
        price: Number.isFinite(parsed) ? parsed : 0,
        roleSlot: roleClassic,
      });
      setOpen(false);
      router.refresh();
    });
  };

  const doUndo = () => {
    startTransition(async () => {
      await undoPick(playerId);
      router.refresh();
    });
  };

  if (!isAvailable) {
    return (
      <div className="flex items-center gap-2">
        <span className={ownedBy === "me" ? "text-emerald-600" : "text-zinc-400"}>
          {ownedBy === "me" ? `mio (${pricePaid})` : "preso"}
        </span>
        <button
          onClick={doUndo}
          disabled={isPending}
          className="text-xs text-zinc-400 underline hover:text-zinc-600 disabled:opacity-50"
        >
          annulla
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Segna
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        className="w-14 rounded border border-zinc-300 px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        onClick={() => doAssign("me")}
        disabled={isPending}
        className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Io
      </button>
      <button
        onClick={() => doAssign("other")}
        disabled={isPending}
        className="rounded bg-zinc-500 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-400 disabled:opacity-50"
      >
        Altri
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-zinc-400">
        ✕
      </button>
    </div>
  );
}
