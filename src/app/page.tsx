import Link from "next/link";
import { getAllPlayersFull } from "@/lib/queries/players";
import { PlayersTable } from "@/components/players/PlayersTable";

export const dynamic = "force-dynamic";

export default async function Home() {
  const players = await getAllPlayersFull();

  return (
    <div className="min-h-screen bg-zinc-50 p-6 font-sans dark:bg-black sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          FantAsta
        </h1>
        <Link
          href="/impostazioni"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          Impostazioni →
        </Link>
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
        <PlayersTable players={players} />
      )}
    </div>
  );
}
