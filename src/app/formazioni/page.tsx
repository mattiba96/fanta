import Link from "next/link";
import { getLatestMatchday, getMatchdayLineups } from "@/lib/queries/lineups";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  starter: "Titolare",
  bench: "Panchina",
  doubt: "In dubbio",
  injured: "Infortunato",
  suspended: "Squalificato",
  warned: "Diffidato",
};

const STATUS_COLORS: Record<string, string> = {
  starter: "text-zinc-900 dark:text-zinc-50",
  bench: "text-zinc-400",
  doubt: "text-amber-600 dark:text-amber-400",
  injured: "text-red-600 dark:text-red-400",
  suspended: "text-red-600 dark:text-red-400",
  warned: "text-amber-600 dark:text-amber-400",
};

export default async function FormazioniPage() {
  const matchday = await getLatestMatchday();
  const matches = matchday != null ? await getMatchdayLineups(matchday) : [];

  return (
    <div className="min-h-screen bg-zinc-50 p-6 font-sans dark:bg-black sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Probabili formazioni {matchday != null && `— giornata ${matchday}`}
        </h1>
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Dashboard
        </Link>
      </header>

      {matches.length === 0 ? (
        <p className="text-zinc-500">
          Nessuna formazione in database. Vai in{" "}
          <Link href="/impostazioni" className="underline">
            Impostazioni
          </Link>{" "}
          e aggiorna le probabili formazioni.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {matches.map((m) => (
            <div
              key={m.fixtureId}
              className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h2 className="mb-3 text-center font-medium text-zinc-900 dark:text-zinc-50">
                {m.home.teamName} — {m.away.teamName}
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <TeamColumn team={m.home} />
                <TeamColumn team={m.away} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamColumn({
  team,
}: {
  team: {
    teamName: string;
    formation: string | null;
    players: { rawName: string; status: string; probability: number | null; note: string | null }[];
  };
}) {
  const starters = team.players.filter((p) => p.status === "starter");
  const others = team.players.filter((p) => p.status !== "starter" && p.status !== "bench");

  return (
    <div>
      <p className="mb-2 text-xs text-zinc-500">
        {team.teamName} {team.formation && `(${team.formation})`}
      </p>
      <ul className="space-y-1 text-sm">
        {starters.map((p, i) => (
          <li key={i} className="flex justify-between">
            <span>{p.rawName}</span>
            {p.probability != null && (
              <span className="text-xs text-zinc-400">{p.probability}%</span>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-zinc-100 pt-2 text-xs dark:border-zinc-800">
          {others.map((p, i) => (
            <li key={i} className={STATUS_COLORS[p.status] ?? "text-zinc-500"}>
              {STATUS_LABELS[p.status] ?? p.status}: {p.rawName}
              {p.note && <span className="text-zinc-400"> — {p.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
