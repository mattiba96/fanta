import Link from "next/link";
import { Suspense } from "react";
import { getAllPlayersFull } from "@/lib/queries/players";
import { getWatchlistedPlayerIds } from "@/lib/queries/watchlist";
import { PlayersTable } from "@/components/players/PlayersTable";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [players, watchlistedIds] = await Promise.all([
    getAllPlayersFull(),
    getWatchlistedPlayerIds(),
  ]);

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <span aria-hidden>🐶</span> Fantacucciolo
        </h1>
        <nav className="flex flex-wrap items-center gap-1.5 text-sm">
          <NavPill href="/consigli" icon="💡" label="Consigli" />
          <NavPill href="/sfoglia" icon="🔍" label="Sfoglia" />
          <NavPill href="/squadre" icon="⚽" label="Squadre" />
          <NavPill href="/formazione-tipo" icon="📋" label="Formazione tipo" />
          <NavPill href="/notizie" icon="📰" label="Notizie" />
          <NavPill href="/obiettivi" icon="⭐" label="Obiettivi" />
          <NavPill href="/griglie" icon="🧮" label="Griglie" />
          <NavPill href="/impostazioni" icon="⚙️" label="Impostazioni" />
        </nav>
      </header>

      {players.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          Nessun giocatore in database. Vai in{" "}
          <Link href="/impostazioni" className="underline">
            Impostazioni
          </Link>{" "}
          e aggiorna listone e statistiche.
        </p>
      ) : (
        <Suspense fallback={null}>
          <PlayersTable players={players} watchlistedIds={watchlistedIds} />
        </Suspense>
      )}
    </div>
  );
}

function NavPill({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium text-zinc-600 transition-colors hover:bg-brand-soft hover:text-brand-soft-fg dark:text-zinc-300"
    >
      <span aria-hidden>{icon}</span>
      {label}
    </Link>
  );
}
