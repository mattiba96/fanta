import Link from "next/link";
import { getAuctionState } from "@/lib/queries/auction";
import { getParticipantSummaries } from "@/lib/queries/participants";
import { QuickAssignControl } from "@/components/auction/QuickAssignControl";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<"P" | "D" | "C" | "A", string> = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};

export default async function AstaPage() {
  const [state, participants] = await Promise.all([
    getAuctionState(),
    getParticipantSummaries(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50 p-6 font-sans dark:bg-black sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          La mia asta
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {participants.map((p) => (
            <div
              key={p.id}
              className={`rounded-md border p-3 ${
                p.isMe
                  ? "border-zinc-900 bg-white dark:border-zinc-100 dark:bg-zinc-900"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              }`}
            >
              <p className="mb-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {p.isMe ? `${p.name} (tu)` : p.name}
              </p>
              <p className="text-xs text-zinc-500">
                Residuo <span className="font-semibold text-zinc-900 dark:text-zinc-50">{p.budgetRemaining}</span>
              </p>
              <p className="text-xs text-zinc-500">
                Punta max <span className="font-semibold text-zinc-900 dark:text-zinc-50">{p.maxBid}</span>
              </p>
              <p className="text-xs text-zinc-500">{p.rosterCount} giocatori</p>
            </div>
          ))}
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
                    <QuickAssignControl
                      playerId={entry.playerId}
                      roleClassic={entry.roleClassic}
                      isAvailable={false}
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
                  <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
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
          className="h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
