"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  searchPlayersForAuction,
  getPlayerAuctionDetails,
  type PlayerSearchResult,
  type PlayerAuctionDetails,
} from "@/actions/playerLookup";
import { QuickAssignControl, type ParticipantOption } from "@/components/auction/QuickAssignControl";
import { RoleBadge } from "@/components/players/PlayersTable";

/**
 * Console per l'asta dal vivo: quando qualcuno chiama un giocatore, lo cerchi
 * qui, vedi subito quotazione/FVM/indice/storico prezzi e le alternative
 * ancora disponibili nello stesso ruolo, e lo assegni senza uscire da questa
 * pagina — pensata per essere l'unica cosa aperta durante l'asta.
 */
export function LiveAuctionPanel({ participants }: { participants: ParticipantOption[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [selected, setSelected] = useState<PlayerAuctionDetails | null>(null);
  const [isSearching, startSearch] = useTransition();
  const [isLoadingDetails, startLoadingDetails] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startSearch(async () => {
        const rows = await searchPlayersForAuction(query);
        setResults(rows);
      });
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const selectPlayer = (playerId: number) => {
    startLoadingDetails(async () => {
      const details = await getPlayerAuctionDetails(playerId);
      setSelected(details);
      setResults([]);
      setQuery("");
    });
  };

  const refreshSelected = () => {
    if (!selected) return;
    startLoadingDetails(async () => {
      const details = await getPlayerAuctionDetails(selected.id);
      setSelected(details);
      router.refresh();
    });
  };

  return (
    <div className="mb-8 rounded-lg border-2 border-brand bg-white p-4 dark:bg-zinc-900">
      <p className="mb-2 text-xs font-medium text-zinc-500">Chi stanno chiamando?</p>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca il giocatore appena chiamato…"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          autoComplete="off"
        />
        {(results.length > 0 || isSearching) && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {isSearching && <p className="p-2 text-xs text-zinc-400">Cerco…</p>}
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => selectPlayer(r.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <span className="flex items-center gap-2 truncate">
                  <RoleBadge role={r.roleClassic} />
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{r.name}</span>
                  <span className="text-zinc-400">{r.teamCode}</span>
                </span>
                {r.isAvailable ? (
                  <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">disponibile</span>
                ) : (
                  <span className="shrink-0 text-xs text-zinc-400">
                    {r.ownedByIsMe ? "mio" : r.ownedByName} ({r.pricePaid})
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoadingDetails && !selected && <p className="mt-3 text-sm text-zinc-400">Carico i dettagli…</p>}

      {selected && (
        <div className="mt-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              <RoleBadge role={selected.roleClassic} />
              <Link href={`/giocatori/${selected.slug}`} className="hover:underline">
                {selected.name}
              </Link>
              <span className="text-sm font-normal text-zinc-400">{selected.teamName}</span>
            </p>
            <button onClick={() => setSelected(null)} className="text-xs text-zinc-400 hover:text-zinc-600">
              ✕
            </button>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Quotazione" value={selected.quotCurrentClassic} />
            <Stat label="FVM" value={selected.fvmClassic} />
            <Stat label="Indice" value={selected.score != null ? `${selected.score}/100` : null} />
            <Stat label="Prezzo consigliato" value={selected.suggestedPrice} />
          </div>

          {selected.bandLabel && (
            <p className="mb-2 text-xs text-zinc-500">
              Fascia <span className="font-medium text-zinc-700 dark:text-zinc-300">{selected.bandLabel}</span>
            </p>
          )}

          {selected.tags.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {selected.tags.map((tag, i) => (
                <span
                  key={i}
                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {selected.historicalPrices.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-medium text-zinc-500">Pagato nelle tue aste passate</p>
              <div className="flex flex-wrap gap-1.5">
                {selected.historicalPrices.map((h, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    {h.season}: {h.price}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3">
            <QuickAssignControl
              playerId={selected.id}
              roleClassic={selected.roleClassic}
              isAvailable={selected.isAvailable}
              ownedByParticipantId={selected.ownedByParticipantId}
              ownedByName={selected.ownedByName}
              ownedByIsMe={selected.ownedByIsMe}
              pricePaid={selected.pricePaid}
              participants={participants}
            />
            {!selected.isAvailable && (
              <button
                onClick={refreshSelected}
                className="ml-2 text-xs text-zinc-400 underline hover:text-zinc-600"
              >
                aggiorna
              </button>
            )}
          </div>

          {selected.alternatives.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-500">
                Alternative ancora disponibili nel ruolo (se sei indeciso)
              </p>
              <ul className="space-y-1">
                {selected.alternatives.map((alt) => (
                  <li key={alt.playerId} className="flex items-center justify-between gap-2 text-xs">
                    <button
                      onClick={() => selectPlayer(alt.playerId)}
                      className="truncate text-left font-medium text-zinc-700 hover:underline dark:text-zinc-300"
                    >
                      {alt.name} <span className="font-normal text-zinc-400">({alt.teamCode})</span>
                    </button>
                    <span className="shrink-0 text-zinc-400">
                      {alt.score}/100 · {alt.bandLabel} · consigliato {alt.suggestedPrice ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-md bg-zinc-50 p-2 text-center dark:bg-zinc-800">
      <p className="text-[10px] text-zinc-400">{label}</p>
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{value ?? "—"}</p>
    </div>
  );
}
