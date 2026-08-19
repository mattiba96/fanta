import Link from "next/link";
import { getAuctionState, getMarketInflation } from "@/lib/queries/auction";
import {
  getParticipantSummaries,
  getAllParticipantRosters,
  budgetByRole,
  type ParticipantRosterEntry,
} from "@/lib/queries/participants";
import { getNextTargetSuggestions } from "@/lib/queries/nextTargets";
import { QuickAssignControl } from "@/components/auction/QuickAssignControl";
import { NextTargetAiAdvice } from "@/components/auction/NextTargetAiAdvice";
import { getStoredAiAdvice } from "@/actions/aiAdvisor";
import { RoleBadge } from "@/components/players/PlayersTable";
import { LiveAuctionPanel } from "@/components/auction/LiveAuctionPanel";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<"P" | "D" | "C" | "A", string> = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};

const ROLE_BAR_COLORS: Record<"P" | "D" | "C" | "A", string> = {
  P: "bg-amber-400",
  D: "bg-emerald-500",
  C: "bg-sky-500",
  A: "bg-rose-500",
};

export default async function AstaPage() {
  const [state, participants, marketInflation, nextTargets, storedAdvice, rostersByParticipant] =
    await Promise.all([
      getAuctionState(),
      getParticipantSummaries(),
      getMarketInflation(),
      getNextTargetSuggestions(),
      getStoredAiAdvice(),
      getAllParticipantRosters(),
    ]);

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Asta
        </h1>
        <nav className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/sfoglia" className="hover:underline">
            Sfoglia giocatori
          </Link>
          <Link href="/" className="hover:underline">
            ← Dashboard
          </Link>
        </nav>
      </header>

      <LiveAuctionPanel participants={participants} />

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Budget totale" value={state.settings.totalBudget} />
        <StatCard label="Speso" value={state.budgetSpent} />
        <StatCard
          label="Residuo"
          value={state.budgetRemaining}
          highlight={state.budgetRemaining < 0 ? "danger" : "ok"}
        />
        <StatCard label="Giocatori presi" value={state.roster.length} />
      </div>

      {marketInflation.picksConsidered > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-zinc-500">
            Indice di mercato (prezzi reali vs FVM)
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <InflationCard label="Generale" pct={marketInflation.overall} />
            {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((role) => (
              <InflationCard key={role} label={ROLE_LABELS[role]} pct={marketInflation.byRole[role]} />
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Basato su {marketInflation.picksConsidered} giocatori già assegnati con FVM noto. Positivo =
            in quest&apos;asta si sta pagando sopra l&apos;FVM ufficiale.
          </p>
        </section>
      )}

      <NextTargetAiAdvice
        initialStrategy={state.settings.auctionStrategy}
        initialAdvice={storedAdvice}
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Prossimo obiettivo consigliato</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((role) => {
            const suggestions = nextTargets.byRole[role];
            if (state.slotsFilled[role] >= state.slotsTotal[role]) return null;
            return (
              <div
                key={role}
                className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <p className="mb-2 text-xs text-zinc-500">{ROLE_LABELS[role]}</p>
                {suggestions.length === 0 ? (
                  <p className="text-sm text-zinc-400">Nessun disponibile con dati sufficienti.</p>
                ) : (
                  <ul className="space-y-2">
                    {suggestions.map((s) => (
                      <li key={s.playerId} className="text-sm">
                        <Link
                          href={`/giocatori/${s.slug}`}
                          className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                        >
                          {s.name}
                        </Link>
                        <span className="text-zinc-400"> ({s.teamCode})</span>
                        <br />
                        <span className="text-xs text-zinc-500">
                          Indice {s.score}/100 · {s.bandLabel} · consigliato {s.suggestedPrice ?? "—"}
                          {s.historicalPrices.length > 0 &&
                            ` · ultima volta pagato ${s.historicalPrices[0].price} (${s.historicalPrices[0].season})`}
                        </span>
                        {!s.affordable && (
                          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                            fuori dal tuo budget attuale
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Slot per ruolo</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((role) => (
            <SlotBar
              key={role}
              label={ROLE_LABELS[role]}
              filled={state.slotsFilled[role]}
              total={state.slotsTotal[role]}
            />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Tutte le squadre</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {participants.map((p) => {
            const roster = rostersByParticipant.get(p.id) ?? [];
            const roles = budgetByRole(roster, state.settings.totalBudget);
            return (
              <div
                key={p.id}
                className={`rounded-lg border p-4 ${
                  p.isMe
                    ? "border-brand bg-white dark:bg-zinc-900"
                    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                }`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {p.isMe ? `${p.name} (tu)` : p.name}
                  </p>
                  <span className="text-xs text-zinc-400">
                    {p.rosterCount}/{p.totalSlots} giocatori
                  </span>
                </div>

                <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-zinc-50 py-1.5 dark:bg-zinc-800">
                    <p className="text-[10px] text-zinc-400">Speso</p>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{p.budgetSpent}</p>
                  </div>
                  <div className="rounded-md bg-zinc-50 py-1.5 dark:bg-zinc-800">
                    <p className="text-[10px] text-zinc-400">Residuo</p>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{p.budgetRemaining}</p>
                  </div>
                  <div className="rounded-md bg-zinc-50 py-1.5 dark:bg-zinc-800">
                    <p className="text-[10px] text-zinc-400">Punta max</p>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{p.maxBid}</p>
                  </div>
                </div>

                <MiniBar label="Budget speso" pct={p.pctBudgetSpent} />
                <MiniBar label="Slot riempiti" pct={p.pctSlotsFilled} />

                {!p.isMe && p.rosterCount > 0 && Math.abs(p.spendPace) >= 15 && (
                  <p
                    className={`mt-1 text-xs ${
                      p.spendPace > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {p.spendPace > 0
                      ? "Spende veloce: rischia di restare senza budget"
                      : "Procede economico: ha margine per rilanciare"}
                  </p>
                )}

                {p.rosterCount > 0 && (
                  <>
                    <p className="mt-3 mb-1.5 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
                      Budget per reparto
                    </p>
                    <div className="mb-1 flex h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      {roles.map((r) => (
                        <div
                          key={r.role}
                          title={`${ROLE_LABELS[r.role]}: ${r.spent} cr. (${r.pct}%)`}
                          className={ROLE_BAR_COLORS[r.role]}
                          style={{ width: `${r.pct}%` }}
                        />
                      ))}
                    </div>
                    <div className="mb-3 grid grid-cols-4 gap-1 text-center">
                      {roles.map((r) => (
                        <div key={r.role} className="text-[10px]">
                          <RoleBadge role={r.role} />
                          <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">
                            {r.spent} <span className="text-zinc-400">({r.pct}%)</span>
                          </p>
                        </div>
                      ))}
                    </div>

                    <details>
                      <summary className="cursor-pointer text-xs text-zinc-500 hover:underline">
                        Vedi rosa ({p.rosterCount})
                      </summary>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-left text-zinc-400">
                            <tr>
                              <th className="pb-1 font-medium"></th>
                              <th className="pb-1 font-medium">Nome</th>
                              <th className="pb-1 font-medium">Prezzo</th>
                              <th className="pb-1 font-medium">% budget</th>
                              <th className="pb-1 font-medium">vs FVM</th>
                              <th className="pb-1 font-medium"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {roster.map((entry) => (
                              <RosterRow
                                key={entry.pickId}
                                entry={entry}
                                totalBudget={state.settings.totalBudget}
                                participantId={p.id}
                                participantName={p.name}
                                isMe={p.isMe}
                                participants={participants}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Gestisci le squadre (aggiungi/rinomina) in{" "}
          <Link href="/impostazioni" className="underline">
            Impostazioni
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">La mia rosa</h2>
        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">Ruolo</th>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Squadra</th>
                <th className="px-3 py-2 font-medium">Prezzo</th>
                <th className="px-3 py-2 font-medium">vs FVM</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {state.roster.map((entry) => (
                <tr key={entry.pickId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2">{entry.roleClassic ?? "—"}</td>
                  <td className="px-3 py-2 font-medium">{entry.name}</td>
                  <td className="px-3 py-2 text-zinc-500">{entry.teamCode}</td>
                  <td className="px-3 py-2">{entry.price}</td>
                  <td className="px-3 py-2">
                    {entry.pctVsFvm != null ? (
                      <span
                        className={
                          entry.pctVsFvm > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : entry.pctVsFvm < 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-zinc-500"
                        }
                      >
                        {entry.pctVsFvm > 0 ? "+" : ""}
                        {entry.pctVsFvm}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <QuickAssignControl
                      playerId={entry.playerId}
                      roleClassic={entry.roleClassic}
                      isAvailable={false}
                      ownedByParticipantId={participants.find((p) => p.isMe)?.id ?? null}
                      ownedByName={null}
                      ownedByIsMe={true}
                      pricePaid={entry.price}
                      participants={participants}
                    />
                  </td>
                </tr>
              ))}
              {state.roster.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">
                    Nessun giocatore ancora acquistato.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "ok" | "danger";
}) {
  const color =
    highlight === "danger"
      ? "text-red-600 dark:text-red-400"
      : highlight === "ok"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function InflationCard({ label, pct }: { label: string; pct: number | null }) {
  const color =
    pct == null
      ? "text-zinc-400"
      : pct > 0
        ? "text-amber-600 dark:text-amber-400"
        : pct < 0
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>
        {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`}
      </p>
    </div>
  );
}

function MiniBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between text-[10px] text-zinc-400">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-1 rounded-full bg-brand"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function SlotBar({ label, filled, total }: { label: string; filled: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (filled / total) * 100) : 0;
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-1 text-xs text-zinc-500">{label}</p>
      <p className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
        {filled} / {total}
      </p>
      <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-1.5 rounded-full bg-brand"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function RosterRow({
  entry,
  totalBudget,
  participantId,
  participantName,
  isMe,
  participants,
}: {
  entry: ParticipantRosterEntry;
  totalBudget: number;
  participantId: number;
  participantName: string;
  isMe: boolean;
  participants: Array<{ id: number; name: string; isMe: boolean }>;
}) {
  const pctBudget = totalBudget > 0 ? Math.round((entry.price / totalBudget) * 100) : 0;
  const pctVsFvm =
    entry.fvmClassic != null && entry.fvmClassic > 0
      ? Math.round(((entry.price - entry.fvmClassic) / entry.fvmClassic) * 100)
      : null;

  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-800">
      <td className="py-1 pr-1">
        <RoleBadge role={entry.roleClassic} />
      </td>
      <td className="py-1 pr-2 font-medium text-zinc-700 dark:text-zinc-300">{entry.name}</td>
      <td className="py-1 pr-2 text-zinc-600 dark:text-zinc-300">{entry.price}</td>
      <td className="py-1 pr-2 text-zinc-400">{pctBudget}%</td>
      <td className="py-1 pr-2">
        {pctVsFvm != null ? (
          <span
            className={
              pctVsFvm > 0
                ? "text-amber-600 dark:text-amber-400"
                : pctVsFvm < 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-zinc-500"
            }
          >
            {pctVsFvm > 0 ? "+" : ""}
            {pctVsFvm}%
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="py-1">
        <QuickAssignControl
          playerId={entry.playerId}
          roleClassic={entry.roleClassic}
          isAvailable={false}
          ownedByParticipantId={participantId}
          ownedByName={isMe ? null : participantName}
          ownedByIsMe={isMe}
          pricePaid={entry.price}
          participants={participants}
        />
      </td>
    </tr>
  );
}
