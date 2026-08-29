"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { launchFantaAstaDesktop } from "@/actions/liveAuction";
import type { Role } from "@/lib/advice/engine";
import type { LiveAdvice, LiveAuctionSnapshot } from "@/lib/liveAuction/recommend";

const POLL_INTERVAL_MS = 4000;
const STORAGE_KEY = "fantacucciolo:myTeamIndex";

const ROLE_ORDER: Role[] = ["P", "D", "C", "A"];
const ROLE_LABELS: Record<Role, string> = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};
const ROLE_ICONS: Record<Role, string> = {
  P: "🧤",
  D: "🛡️",
  C: "🎯",
  A: "⚽",
};
const BAND_LABELS: Record<string, string> = {
  top: "Top",
  "semi-top": "Semi-top",
  centrale: "Centrale",
  scommessa: "Scommessa",
};

type ErrorSource = "fantaasta" | "internal" | "input";
type ApiResponse = LiveAuctionSnapshot | { error: string; source?: ErrorSource };

function isErrorResponse(data: unknown): data is { error: string; source?: ErrorSource } {
  return typeof data === "object" && data !== null && "error" in data && typeof (data as Record<string, unknown>).error === "string";
}

export default function AstaLivePage() {
  const [myTeamIndex, setMyTeamIndex] = useState(0);
  const [prefsReady, setPrefsReady] = useState(false);
  const [snapshot, setSnapshot] = useState<LiveAuctionSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<ErrorSource>("internal");
  const [loading, setLoading] = useState(true);
  const [justLaunched, setJustLaunched] = useState(false);
  const [launchOutcome, setLaunchOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  // Contatore per scartare risposte "vecchie" arrivate dopo una più recente
  // (rete lenta/variabile, o cambio rapido di myTeamIndex): senza questo,
  // fetch fuori ordine potrebbero sovrascrivere lo stato con dati stale.
  const requestSeqRef = useRef(0);

  // La preferenza va letta da localStorage prima del primo poll, altrimenti
  // partiremmo sempre con myTeamIndex=0 e poi "salteremmo" al valore salvato.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored != null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) setMyTeamIndex(parsed);
    }
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    window.localStorage.setItem(STORAGE_KEY, String(myTeamIndex));
  }, [myTeamIndex, prefsReady]);

  const fetchState = useCallback(async (teamIndex: number) => {
    const requestId = ++requestSeqRef.current;
    try {
      const res = await fetch(`/api/asta-live/state?myTeamIndex=${teamIndex}`, { cache: "no-store" });
      const data: ApiResponse = await res.json();
      if (requestId !== requestSeqRef.current) return; // superata da una richiesta più recente
      if (!res.ok || isErrorResponse(data)) {
        setErrorMessage(isErrorResponse(data) ? data.error : "Errore sconosciuto durante la lettura dell'asta.");
        setErrorSource(isErrorResponse(data) && data.source ? data.source : "internal");
        setSnapshot(null);
      } else {
        setSnapshot(data);
        setErrorMessage(null);
      }
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : "Errore di rete durante la lettura dell'asta.");
      setErrorSource("internal");
      setSnapshot(null);
    } finally {
      if (requestId === requestSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    fetchState(myTeamIndex);
    const id = setInterval(() => fetchState(myTeamIndex), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [prefsReady, myTeamIndex, fetchState]);

  const handleLaunch = () => {
    setJustLaunched(false);
    setLaunchOutcome(null);
    startTransition(async () => {
      const outcome = await launchFantaAstaDesktop();
      setLaunchOutcome(outcome);
      setJustLaunched(true);
    });
  };

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <span aria-hidden>🔨</span> Asta Live
        </h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            La mia squadra (indice)
            <input
              type="number"
              min={0}
              value={myTeamIndex}
              onChange={(e) => setMyTeamIndex(Math.max(0, Number(e.target.value) || 0))}
              className="w-16 rounded-md border border-zinc-200 bg-white px-2 py-1 text-center text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
          <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
            ← Dashboard
          </Link>
        </div>
      </header>

      {loading && !snapshot && !errorMessage && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Caricamento...</p>
      )}

      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/30">
          <p className="text-sm text-red-800 dark:text-red-300">
            {errorSource === "fantaasta"
              ? `FantaAsta Desktop non è raggiungibile: ${errorMessage}`
              : `Errore durante la lettura dell'asta: ${errorMessage}`}
          </p>
          {errorSource === "fantaasta" && (
            <>
              <button
                onClick={handleLaunch}
                disabled={isPending}
                className="mt-3 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {isPending ? "Avvio in corso..." : "Apri FantaAsta Desktop"}
              </button>
              {justLaunched && !isPending && launchOutcome && (
                <p
                  className={`mt-2 text-xs ${launchOutcome.ok ? "text-zinc-500 dark:text-zinc-400" : "text-red-700 dark:text-red-400"}`}
                >
                  {launchOutcome.ok
                    ? `${launchOutcome.message} Riprovo tra qualche secondo...`
                    : launchOutcome.message}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {snapshot && (
        <>
          <TeamSummary snapshot={snapshot} />
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {ROLE_ORDER.map((role) => (
              <RoleSection key={role} role={role} picks={snapshot.bestPicksByRole[role]} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TeamSummary({ snapshot }: { snapshot: LiveAuctionSnapshot }) {
  const { myTeam, settings } = snapshot;
  const budget = myTeam?.credits ?? myTeam?.budget ?? settings.startingBudget;
  const slots = myTeam?.rosterHash ?? {
    gk: settings.rosterComposition.gk,
    def: settings.rosterComposition.def,
    mid: settings.rosterComposition.mid,
    atk: settings.rosterComposition.atk,
  };

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {myTeam ? myTeam.name : "La mia squadra"}
        {!myTeam && (
          <span className="ml-2 text-xs text-zinc-400">
            (nessun acquisto registrato per questo indice squadra: valori di default)
          </span>
        )}
      </h2>
      <div className="flex flex-wrap gap-6">
        <Stat label="Crediti rimanenti" value={budget} />
        {myTeam?.maxOffer != null && <Stat label="Offerta massima" value={myTeam.maxOffer} />}
        <Stat label="Portieri da comprare" value={slots.gk} />
        <Stat label="Difensori da comprare" value={slots.def} />
        <Stat label="Centrocampisti da comprare" value={slots.mid} />
        <Stat label="Attaccanti da comprare" value={slots.atk} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  );
}

function RoleSection({ role, picks }: { role: Role; picks: LiveAdvice[] }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        <span aria-hidden>{ROLE_ICONS[role]}</span> {ROLE_LABELS[role]}
      </h2>
      {picks.length === 0 ? (
        <p className="text-sm text-zinc-400">Nessun giocatore disponibile.</p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
          {picks.map((pick) => (
            <li key={pick.player.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                  {pick.player.name}
                  <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                    {pick.player.team ?? "—"}
                  </span>
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {BAND_LABELS[pick.advice.band] ?? pick.advice.band} · punteggio {pick.advice.score}
                  {pick.advice.tags.length > 0 && ` · ${pick.advice.tags.join(", ")}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={
                    pick.affordable
                      ? "font-semibold text-zinc-900 dark:text-zinc-50"
                      : "font-semibold text-red-600 dark:text-red-400"
                  }
                >
                  {!pick.affordable && <span aria-hidden>⚠️ </span>}
                  {pick.advice.suggestedPrice ?? "—"}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">consigliato</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
