"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { PlayerRow } from "@/lib/queries/players";
import type { WatchlistMapEntry } from "@/lib/queries/watchlist";
import { RoleBadge } from "@/components/players/PlayersTable";
import { getPlayerImageUrl } from "@/lib/playerImage";

const ROLES = [
  { value: "P", label: "Portieri" },
  { value: "D", label: "Difensori" },
  { value: "C", label: "Centrocampisti" },
  { value: "A", label: "Attaccanti" },
] as const;

type SortKey = "quotCurrentClassic" | "fvmClassic" | "fm" | "mv";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "quotCurrentClassic", label: "Quotazione" },
  { value: "fvmClassic", label: "FVM" },
  { value: "fm", label: "Fantamedia" },
  { value: "mv", label: "Media voto" },
];

export function BrowsePlayers({
  players,
  watchlistMap,
}: {
  players: PlayerRow[];
  watchlistMap?: Map<number, WatchlistMapEntry>;
}) {
  const [role, setRole] = useState<(typeof ROLES)[number]["value"]>("C");
  const [sortKey, setSortKey] = useState<SortKey>("quotCurrentClassic");
  const [currentPlayerId, setCurrentPlayerId] = useState<number | null>(null);

  const list = useMemo(() => {
    const rows = players.filter((p) => p.roleClassic === role);
    return rows.slice().sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return (bv as number) - (av as number);
    });
  }, [players, role, sortKey]);

  useEffect(() => {
    if (currentPlayerId == null || !list.some((p) => p.id === currentPlayerId)) {
      setCurrentPlayerId(list[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const currentIndex = list.findIndex((p) => p.id === currentPlayerId);
  const current = currentIndex >= 0 ? list[currentIndex] : null;

  const goTo = (delta: number) => {
    const idx = list.findIndex((p) => p.id === currentPlayerId);
    const next = list[idx + delta];
    setCurrentPlayerId(next?.id ?? null);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ROLES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRole(r.value)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              role === r.value
                ? "bg-brand text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {r.label}
          </button>
        ))}
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              Ordina per {s.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-sm text-zinc-500">
          {list.length > 0 ? `${currentIndex + 1} / ${list.length}` : "0 / 0"}
        </span>
      </div>

      {!current ? (
        <p className="rounded-md border border-zinc-200 bg-white p-8 text-center text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
          Nessun giocatore da mostrare con questi filtri.
        </p>
      ) : (
        <div className="rounded-md border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={() => goTo(-1)}
              disabled={currentIndex <= 0}
              className="rounded-full border border-zinc-300 px-3 py-2 text-sm disabled:opacity-30 dark:border-zinc-700"
            >
              ‹
            </button>

            <div className="flex flex-1 flex-col items-center gap-1 text-center">
              {getPlayerImageUrl(current.externalId) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getPlayerImageUrl(current.externalId)!}
                  alt=""
                  width={90}
                  height={120}
                  className="mb-2 h-[120px] w-[90px] rounded-md border border-zinc-200 object-contain dark:border-zinc-800"
                />
              )}
              <RoleBadge role={current.roleClassic} />
              <Link
                href={`/giocatori/${current.slug}`}
                className="text-2xl font-semibold text-zinc-900 hover:underline dark:text-zinc-50"
              >
                {current.name}
              </Link>
              <p className="text-zinc-500">{current.teamName}</p>
              <p className="mt-2 text-lg">
                <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {current.quotCurrentClassic ?? "—"}
                </span>{" "}
                <span className="text-sm text-zinc-500">quotazione</span>
                {" · "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {current.fvmClassic ?? "—"}
                </span>{" "}
                <span className="text-sm text-zinc-500">FVM</span>
              </p>
              <p className="text-sm text-zinc-500">
                MV {current.mv?.toFixed(2) ?? "—"} · FM {current.fm?.toFixed(2) ?? "—"} · Gol{" "}
                {current.goals ?? "—"} · Ass. {current.assists ?? "—"}
              </p>
              {watchlistMap?.has(current.id) && (
                <p className="mt-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  ★ Obiettivo
                  {watchlistMap.get(current.id)?.targetPrice != null &&
                    ` — max ${watchlistMap.get(current.id)?.targetPrice}`}
                </p>
              )}
            </div>

            <button
              onClick={() => goTo(1)}
              disabled={currentIndex >= list.length - 1}
              className="rounded-full border border-zinc-300 px-3 py-2 text-sm disabled:opacity-30 dark:border-zinc-700"
            >
              ›
            </button>
          </div>

          <div className="mt-6 flex justify-center">
            <Link
              href={`/giocatori/${current.slug}`}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              Vedi scheda completa
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
