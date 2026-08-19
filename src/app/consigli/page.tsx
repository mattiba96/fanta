import Link from "next/link";
import { getAllPlayersFull } from "@/lib/queries/players";
import { getAdviceForAvailablePlayers } from "@/lib/queries/advice";
import { bandLabel } from "@/lib/advice/engine";

export const dynamic = "force-dynamic";

const ROLES: { value: "P" | "D" | "C" | "A"; label: string }[] = [
  { value: "P", label: "Portieri" },
  { value: "D", label: "Difensori" },
  { value: "C", label: "Centrocampisti" },
  { value: "A", label: "Attaccanti" },
];

const TOP_N = 12;

export default async function ConsigliPage() {
  const [players, adviceMap] = await Promise.all([
    getAllPlayersFull(),
    getAdviceForAvailablePlayers(),
  ]);

  const available = players.filter((p) => p.isAvailable && adviceMap.has(p.id));

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Consigli
        </h1>
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Dashboard
        </Link>
      </header>
      <p className="mb-6 max-w-2xl text-sm text-zinc-500">
        Indice calcolato su convenienza (fantamedia per credito speso rispetto agli altri
        giocatori dello stesso ruolo), titolarità attesa e affidabilità (presenze la scorsa
        stagione). Solo giocatori ancora disponibili.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {ROLES.map(({ value, label }) => {
          const rows = available
            .filter((p) => p.roleClassic === value)
            .map((p) => ({ player: p, advice: adviceMap.get(p.id)! }))
            .sort((a, b) => b.advice.score - a.advice.score)
            .slice(0, TOP_N);

          return (
            <section key={value}>
              <h2 className="mb-2 text-sm font-medium text-zinc-500">{label}</h2>
              <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-100 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Nome</th>
                      <th className="px-3 py-2 font-medium">Qt.A</th>
                      <th className="px-3 py-2 font-medium">Fascia</th>
                      <th className="px-3 py-2 font-medium">Indice</th>
                      <th className="px-3 py-2 font-medium">Prezzo cons.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ player, advice }) => (
                      <tr key={player.id} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-3 py-2">
                          <Link href={`/giocatori/${player.slug}`} className="font-medium hover:underline">
                            {player.name}
                          </Link>
                          <span className="ml-1 text-xs text-zinc-400">{player.teamCode}</span>
                          {advice.tags.length > 0 && (
                            <div className="mt-0.5 text-xs text-zinc-400">{advice.tags[0]}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">{player.quotCurrentClassic ?? "—"}</td>
                        <td className="px-3 py-2">{bandLabel(advice.band)}</td>
                        <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50">
                          {advice.score}
                        </td>
                        <td className="px-3 py-2">{advice.suggestedPrice ?? "—"}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                          Nessun dato disponibile.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
