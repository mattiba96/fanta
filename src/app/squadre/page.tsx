import Link from "next/link";
import { getAllTeamsBasic } from "@/lib/queries/teams";

export const dynamic = "force-dynamic";

export default async function SquadrePage() {
  const teams = await getAllTeamsBasic();

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">⚽ Squadre</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Statistiche di squadra, modulo e consigli d&apos;acquisto per ogni rosa.
          </p>
        </div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Dashboard
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {teams.map((team) => (
          <Link
            key={team.teamId}
            href={`/squadre/${team.slug}`}
            className="rounded-md border border-zinc-200 bg-white p-4 text-center transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            <p className="font-medium text-zinc-900 dark:text-zinc-50">{team.teamName}</p>
            {team.formation && (
              <p className="mt-1 text-xs text-zinc-500">{team.formation}</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
