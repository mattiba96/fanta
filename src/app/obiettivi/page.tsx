import Link from "next/link";
import { getWatchlist } from "@/lib/queries/watchlist";
import { RoleBadge } from "@/components/players/PlayersTable";
import { RemoveWatchlistButton } from "@/components/players/RemoveWatchlistButton";

export const dynamic = "force-dynamic";

const PRIORITY_LABELS: Record<number, string> = { 1: "Alta", 2: "Media", 3: "Bassa" };

export default async function ObiettiviPage() {
  const entries = await getWatchlist();

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <span aria-hidden>⭐</span> I miei obiettivi
        </h1>
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Dashboard
        </Link>
      </header>

      {entries.length === 0 ? (
        <p className="text-zinc-500">
          Nessun obiettivo ancora segnato. Vai sulla scheda di un giocatore e clicca{" "}
          <span className="font-medium">&quot;Aggiungi a obiettivi&quot;</span>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">Priorità</th>
                <th className="px-3 py-2 font-medium">Ruolo</th>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Squadra</th>
                <th className="px-3 py-2 font-medium">Qt.A</th>
                <th className="px-3 py-2 font-medium">Prezzo max</th>
                <th className="px-3 py-2 font-medium">Nota</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.playerId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2">{e.priority != null ? PRIORITY_LABELS[e.priority] : "—"}</td>
                  <td className="px-3 py-2">
                    <RoleBadge role={e.roleClassic} />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/giocatori/${e.slug}`} className="hover:underline">
                      {e.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{e.teamCode}</td>
                  <td className="px-3 py-2">{e.quotCurrentClassic ?? "—"}</td>
                  <td className="px-3 py-2 font-semibold">{e.targetPrice ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-500">{e.note ?? "—"}</td>
                  <td className="px-3 py-2">
                    <RemoveWatchlistButton playerId={e.playerId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
