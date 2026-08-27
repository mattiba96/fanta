import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeamBySlug, type TeamRosterPlayer } from "@/lib/queries/teams";
import { getTypicalLineupForTeam } from "@/lib/queries/formazioneTipo";
import { getPlayerImageUrl } from "@/lib/playerImage";
import { bandLabel } from "@/lib/advice/engine";
import { RoleBadge } from "@/components/players/PlayersTable";

export const dynamic = "force-dynamic";

const ROLE_LABELS = { P: "Portieri", D: "Difensori", C: "Centrocampisti", A: "Attaccanti" } as const;
const TYPICAL_ROLE_LABELS = { P: "Portiere", D: "Difensori", C: "Centrocampisti", A: "Attaccanti" } as const;

export default async function SquadraPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) notFound();

  const typicalLineup = await getTypicalLineupForTeam(team.teamId);

  const allPlayers = (Object.keys(team.byRole) as Array<keyof typeof team.byRole>).flatMap(
    (role) => team.byRole[role],
  );
  const consigliati = allPlayers.filter((p) => p.recommendation === "consigliato");
  const daEvitare = allPlayers.filter((p) => p.recommendation === "da_evitare");

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <Link href="/squadre" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← Squadre
      </Link>

      <header className="mt-4 mb-6 flex items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <span aria-hidden>⚽</span> {team.teamName}
        </h1>
        {team.formation && (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-soft-fg">
            {team.formation}
          </span>
        )}
      </header>

      <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-500">
        <span aria-hidden>📋</span> Formazione tipo
      </h2>
      {typicalLineup ? (
        <div className="mb-8 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {(Object.keys(TYPICAL_ROLE_LABELS) as Array<keyof typeof TYPICAL_ROLE_LABELS>).map((role) => (
              <div key={role}>
                <p className="text-xs text-zinc-400">{TYPICAL_ROLE_LABELS[role]}</p>
                <ul className="space-y-1">
                  {typicalLineup.byRole[role].map((p) => {
                    const img = getPlayerImageUrl(p.externalId);
                    return (
                      <li key={p.playerId} className="flex items-center gap-2 text-sm">
                        {img && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img}
                            alt=""
                            width={20}
                            height={27}
                            className="h-7 w-5 shrink-0 rounded object-contain"
                          />
                        )}
                        <Link
                          href={`/giocatori/${p.slug}`}
                          className="text-zinc-700 hover:underline dark:text-zinc-300"
                        >
                          {p.name}
                        </Link>
                      </li>
                    );
                  })}
                  {typicalLineup.byRole[role].length === 0 && (
                    <li className="text-sm text-zinc-400">—</li>
                  )}
                </ul>
                {typicalLineup.ballottaggi[role].length > 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Ballottaggio:{" "}
                    {typicalLineup.ballottaggi[role].map((p, i) => (
                      <span key={p.playerId}>
                        {i > 0 && ", "}
                        <Link href={`/giocatori/${p.slug}`} className="hover:underline">
                          {p.name}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mb-8 text-sm text-zinc-400">
          Nessun dato disponibile. Vai in{" "}
          <Link href="/impostazioni" className="underline">
            Impostazioni
          </Link>{" "}
          e aggiorna l&apos;indice appetibilità.
        </p>
      )}

      <h2 className="mb-2 text-sm font-medium text-zinc-500">Statistiche di squadra</h2>
      <div className="mb-8 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Stagione</th>
              <th className="px-3 py-2 font-medium">Gol fatti</th>
              <th className="px-3 py-2 font-medium">Assist</th>
              <th className="px-3 py-2 font-medium">Gol subiti</th>
              <th className="px-3 py-2 font-medium">Fantamedia rosa</th>
            </tr>
          </thead>
          <tbody>
            {team.seasons.map((s) => (
              <tr key={s.season} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-2 font-medium">{s.season.replace("-", "/")}</td>
                <td className="px-3 py-2">{s.goals}</td>
                <td className="px-3 py-2">{s.assists}</td>
                <td className="px-3 py-2">{s.goalsConceded}</td>
                <td className="px-3 py-2">{s.avgFantamedia ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(consigliati.length > 0 || daEvitare.length > 0) && (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {consigliati.length > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="mb-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Consigliati
              </p>
              <ul className="space-y-1">
                {consigliati.map((p) => (
                  <PlayerLine key={p.playerId} player={p} />
                ))}
              </ul>
            </div>
          )}
          {daEvitare.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
              <p className="mb-2 text-xs font-medium text-red-700 dark:text-red-400">Da evitare</p>
              <ul className="space-y-1">
                {daEvitare.map((p) => (
                  <PlayerLine key={p.playerId} player={p} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <h2 className="mb-2 text-sm font-medium text-zinc-500">Rosa</h2>
      {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((role) => (
        <div key={role} className="mb-6">
          <p className="mb-2 text-xs text-zinc-400">{ROLE_LABELS[role]}</p>
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-100 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Giocatore</th>
                  <th className="px-3 py-2 font-medium">Quot.</th>
                  <th className="px-3 py-2 font-medium">Fantamedia</th>
                  <th className="px-3 py-2 font-medium">Indice</th>
                  <th className="px-3 py-2 font-medium">Fascia</th>
                  <th className="px-3 py-2 font-medium">Stato</th>
                </tr>
              </thead>
              <tbody>
                {team.byRole[role].map((p) => {
                  const img = getPlayerImageUrl(p.externalId);
                  return (
                    <tr key={p.playerId} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {img && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={img}
                              alt=""
                              width={20}
                              height={27}
                              className="h-7 w-5 shrink-0 rounded object-contain"
                            />
                          )}
                          <RoleBadge role={p.roleClassic} />
                          <Link
                            href={`/giocatori/${p.slug}`}
                            className="text-zinc-700 hover:underline dark:text-zinc-300"
                          >
                            {p.name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-3 py-2">{p.quotCurrentClassic ?? "—"}</td>
                      <td className="px-3 py-2">{p.fm ?? "—"}</td>
                      <td className="px-3 py-2 font-medium text-brand">
                        {p.advice ? `${p.advice.score}/100` : "—"}
                      </td>
                      <td className="px-3 py-2">{p.advice ? bandLabel(p.advice.band) : "—"}</td>
                      <td className="px-3 py-2">
                        {p.recommendation === "consigliato" ? (
                          <span className="text-emerald-600 dark:text-emerald-400">Consigliato</span>
                        ) : p.recommendation === "da_evitare" ? (
                          <span className="text-red-600 dark:text-red-400">Da evitare</span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {team.byRole[role].length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-2 text-zinc-400">
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayerLine({ player }: { player: TeamRosterPlayer }) {
  return (
    <li className="text-sm">
      <Link href={`/giocatori/${player.slug}`} className="text-zinc-700 hover:underline dark:text-zinc-300">
        {player.name}
      </Link>
      <span className="text-zinc-400"> — indice {player.advice?.score}/100</span>
    </li>
  );
}
