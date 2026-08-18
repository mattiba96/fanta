"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PlayerRow } from "@/lib/queries/players";
import type { ParticipantSummary } from "@/lib/queries/participants";
import type { WatchlistMapEntry } from "@/lib/queries/watchlist";
import { assignPlayer } from "@/actions/auction";
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
  participants,
  watchlistMap,
}: {
  players: PlayerRow[];
  participants: ParticipantSummary[];
  watchlistMap?: Map<number, WatchlistMapEntry>;
}) {
  const router = useRouter();
  const [role, setRole] = useState<(typeof ROLES)[number]["value"]>("C");
  const [sortKey, setSortKey] = useState<SortKey>("quotCurrentClassic");
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [currentPlayerId, setCurrentPlayerId] = useState<number | null>(null);
  const [price, setPrice] = useState("1");
  const [isPending, startTransition] = useTransition();

  const list = useMemo(() => {
    let rows = players.filter((p) => p.roleClassic === role);
    if (onlyAvailable) rows = rows.filter((p) => p.isAvailable);
    rows = rows.slice().sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return (bv as number) - (av as number);
    });
    return rows;
  }, [players, role, onlyAvailable, sortKey]);

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

  const doAssign = (participantId: number) => {
    if (!current) return;
    const parsed = Number(price);
    const idx = list.findIndex((p) => p.id === currentPlayerId);
    const nextId = list[idx + 1]?.id ?? null;

    startTransition(async () => {
      await assignPlayer({
        playerId: current.id,
        participantId,
        price: Number.isFinite(parsed) ? parsed : 0,
        roleSlot: current.roleClassic,
      });
      router.refresh();
      setCurrentPlayerId(nextId);
      setPrice("1");
    });
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
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
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
        <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />
          Solo disponibili
        </label>
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
              <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {current.name}
              </h2>
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

          {current.isAvailable ? (
            <div className="mt-6 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-zinc-500">Prezzo</label>
                <input
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  onClick={() => goTo(1)}
                  disabled={isPending}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Salta →
                </button>
              </div>
              <p className="text-xs text-zinc-400">
                Assegna a: clicca una squadra qui sotto
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {participants.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => doAssign(p.id)}
                    disabled={isPending}
                    className={`rounded-md border px-3 py-2 text-sm disabled:opacity-50 ${
                      p.isMe
                        ? "border-emerald-600 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-300"
                        : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="font-medium">{p.isMe ? "Io" : p.name}</span>
                    <span className="ml-2 text-xs opacity-70">{p.budgetRemaining} cr.</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-6 text-center text-sm text-zinc-400">
              Già assegnato — vai su{" "}
              <a href="/asta" className="underline">
                La mia asta
              </a>{" "}
              per modificarlo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
