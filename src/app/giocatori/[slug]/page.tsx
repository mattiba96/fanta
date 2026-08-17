import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlayerBySlug } from "@/lib/queries/players";
import { getParticipantSummaries } from "@/lib/queries/participants";
import { getTeamSetPieces } from "@/lib/queries/setPieces";
import { getPlayerLineupStatus } from "@/lib/queries/lineups";
import { getAdviceForPlayer } from "@/lib/queries/advice";
import { bandLabel } from "@/lib/advice/engine";
import { RoleBadge } from "@/components/players/PlayersTable";
import { QuickAssignControl } from "@/components/auction/QuickAssignControl";

export const dynamic = "force-dynamic";

const KIND_LABELS = {
  penalty: "Rigori",
  free_kick: "Punizioni",
  corner: "Corner",
} as const;

const LINEUP_STATUS_LABELS: Record<string, string> = {
  starter: "Titolare",
  bench: "Panchina",
  doubt: "In dubbio",
  injured: "Infortunato",
  suspended: "Squalificato",
  warned: "Diffidato",
};

const LINEUP_STATUS_COLORS: Record<string, string> = {
  starter: "text-emerald-600 dark:text-emerald-400",
  bench: "text-zinc-500",
  doubt: "text-amber-600 dark:text-amber-400",
  injured: "text-red-600 dark:text-red-400",
  suspended: "text-red-600 dark:text-red-400",
  warned: "text-amber-600 dark:text-amber-400",
};

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
  const [setPieces, lineupStatus, advice] = await Promise.all([
    getTeamSetPieces(team.id),
    getPlayerLineupStatus(player.id),
    pick ? Promise.resolve(null) : getAdviceForPlayer(player.id),
  ]);

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

      {lineupStatus.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {lineupStatus.map((ls, i) => (
            <span
              key={i}
              className={`rounded-md border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800 ${LINEUP_STATUS_COLORS[ls.status] ?? ""}`}
            >
              {LINEUP_STATUS_LABELS[ls.status] ?? ls.status}
              {ls.probability != null && ` (${ls.probability}%)`}
              {ls.note && ` — ${ls.note}`}
            </span>
          ))}
        </div>
      )}

      {advice && (
        <div className="mb-6 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-4">
            <div>
              <p className="text-xs text-zinc-500">Indice</p>
              <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {advice.score}
                <span className="text-sm font-normal text-zinc-400">/100</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Fascia</p>
              <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                {bandLabel(advice.band)}
              </p>
            </div>
            {advice.suggestedPrice != null && (
              <div>
                <p className="text-xs text-zinc-500">Prezzo consigliato</p>
                <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                  {advice.suggestedPrice}
                </p>
              </div>
            )}
          </div>
          {advice.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {advice.tags.map((tag, i) => (
                <span
                  key={i}
                  className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

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

      {setPieces.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-sm font-medium text-zinc-500">
            Calci piazzati — {team.name}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(Object.keys(KIND_LABELS) as Array<keyof typeof KIND_LABELS>).map((kind) => {
              const entries = setPieces.filter((sp) => sp.kind === kind);
              if (entries.length === 0) return null;
              return (
                <div
                  key={kind}
                  className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <p className="mb-2 text-xs text-zinc-500">{KIND_LABELS[kind]}</p>
                  <ol className="space-y-1 text-sm">
                    {entries.map((e) => (
                      <li
                        key={`${e.kind}-${e.priority}`}
                        className={
                          e.playerId === player.id
                            ? "font-semibold text-emerald-600 dark:text-emerald-400"
                            : "text-zinc-700 dark:text-zinc-300"
                        }
                      >
                        {e.priority}. {e.playerName ?? e.rawName}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        </>
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
