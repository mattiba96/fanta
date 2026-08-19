import Link from "next/link";
import { getAllPlayersFull } from "@/lib/queries/players";
import { getParticipantSummaries } from "@/lib/queries/participants";
import { getWatchlistMap } from "@/lib/queries/watchlist";
import { BrowsePlayers } from "@/components/players/BrowsePlayers";

export const dynamic = "force-dynamic";

export default async function SfogliaPage() {
  const [players, participants, watchlistMap] = await Promise.all([
    getAllPlayersFull(),
    getParticipantSummaries(),
    getWatchlistMap(),
  ]);

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Sfoglia giocatori
        </h1>
        <nav className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/asta" className="hover:underline">
            La mia asta
          </Link>
          <Link href="/" className="hover:underline">
            ← Dashboard
          </Link>
        </nav>
      </header>

      <BrowsePlayers players={players} participants={participants} watchlistMap={watchlistMap} />
    </div>
  );
}
