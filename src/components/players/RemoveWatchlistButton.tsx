"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeFromWatchlist } from "@/actions/watchlist";

export function RemoveWatchlistButton({ playerId }: { playerId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await removeFromWatchlist(playerId);
          router.refresh();
        })
      }
      disabled={isPending}
      className="text-xs text-red-500 underline hover:text-red-600 disabled:opacity-50"
    >
      {isPending ? "…" : "rimuovi"}
    </button>
  );
}
