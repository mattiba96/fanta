import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlayerBySlug } from "@/lib/queries/players";
import { getParticipantSummaries } from "@/lib/queries/participants";
import { RoleBadge } from "@/components/players/PlayersTable";
import { QuickAssignControl } from "@/components/auction/QuickAssignControl";

export const dynamic = "force-dynamic";

export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [data, participants] = await Promise.all([
    getPlayerBySlug(slug),
    getParticipantSummaries(),
  ]);
  if (!data) notFound();

  const { player, team, stats, pick } = data;

  return (
    <div className="min-h-screen bg-zinc-50 p-6 font-sans dark:bg-black sm:p-10">
      <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← Dashboard
      </Link>

      <header className="mt-4 mb-6 flex items-center gap-3">
        <RoleBadge role={player.roleClassic} />
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {player.name}
        </h1>
        <span className="text-zinc-500">{team.name}</span>
      </header>

      <div className="mb-6">
        <QuickAssignControl
          playerId={player.id}
          roleClassic={player.roleClassic}
          isAvailable={!pick}
          ownedByName={pick?.participantName ?? null}
          ownedByIsMe={pick?.participantIsMe === 1}
          pricePaid={pick?.price ?? null}
          participants={participants}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Quotazione (Classic)" value={player.quotCurrentClassic} />
        <Stat label="FVM (Classic)" value={player.fvmClassic} />
        <Stat label="Quotazione (Mantra)" value={player.quotCurrentMantra} />
        <Stat label="FVM (Mantra)" value={player.fvmMantra} />
      </div>

      <h2 className="mt-8 mb-2 text-sm font-medium text-zinc-500">
        Statistiche stagione 2025/26
      </h2>
      {stats ? (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          <Stat label="Partite" value={stats.pv} />
          <Stat label="Media voto" value={stats.mv} />
          <Stat label="Fantamedia" value={stats.fm} />
          <Stat label="Gol" value={stats.goals} />
          <Stat label="Assist" value={stats.assists} />
          <Stat
            label="Rigori"
            value={
              stats.penaltiesScored != null
                ? `${stats.penaltiesScored}/${stats.penaltiesTaken ?? 0}`
                : null
            }
          />
        </div>
      ) : (
        <p className="text-zinc-400">Nessuna statistica disponibile per la stagione 2025/26.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {value ?? "—"}
      </p>
    </div>
  );
}
