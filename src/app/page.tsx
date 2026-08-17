import Link from "next/link";
import { getAllPlayersFull } from "@/lib/queries/players";
import { getParticipantSummaries } from "@/lib/queries/participants";
import { getWatchlistedPlayerIds } from "@/lib/queries/watchlist";
import { PlayersTable } from "@/components/players/PlayersTable";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [players, participants, watchlistedIds] = await Promise.all([
    getAllPlayersFull(),
    getParticipantSummaries(),
    getWatchlistedPlayerIds(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50 p-6 font-sans dark:bg-black sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          FantAsta
        </h1>
        <nav className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/consigli" className="hover:underline">
            Consigli
          </Link>
          <Link href="/sfoglia" className="hover:underline">
            Sfoglia
          </Link>
          <Link href="/formazioni" className="hover:underline">
            Formazioni
          </Link>
          <Link href="/notizie" className="hover:underline">
            Notizie
          </Link>
          <Link href="/obiettivi" className="hover:underline">
            Obiettivi
          </Link>
          <Link href="/asta" className="hover:underline">
            La mia asta
          </Link>
          <Link href="/impostazioni" className="hover:underline">
            Impostazioni
          </Link>
        </nav>
      </header>

      {players.length === 0 ? (
        <p className="text-zinc-500">
          Nessun giocatore in database. Vai in{" "}
          <Link href="/impostazioni" className="underline">
            Impostazioni
          </Link>{" "}
          e aggiorna listone e statistiche.
        </p>
      ) : (
        <PlayersTable players={players} participants={participants} watchlistedIds={watchlistedIds} />
      )}
    </div>
  );
}
