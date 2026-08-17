import Link from "next/link";
import { getPlayerBySlug } from "@/lib/queries/players";
import { getAdviceForPlayer } from "@/lib/queries/advice";
import { getPlayerLineupStatus } from "@/lib/queries/lineups";
import { getTeamSetPieces } from "@/lib/queries/setPieces";
import { bandLabel } from "@/lib/advice/engine";
import { RoleBadge } from "@/components/players/PlayersTable";

export const dynamic = "force-dynamic";

async function loadPlayer(slug: string) {
  const data = await getPlayerBySlug(slug);
  if (!data) return null;
  const [advice, lineupStatus, setPieces] = await Promise.all([
    getAdviceForPlayer(data.player.id),
    getPlayerLineupStatus(data.player.id),
    getTeamSetPieces(data.team.id),
  ]);
  const penaltyPriority = setPieces.find(
    (sp) => sp.kind === "penalty" && sp.playerId === data.player.id,
  )?.priority;
  const latestLineup = lineupStatus[0] ?? null;
  return { ...data, advice, latestLineup, penaltyPriority };
}

type PlayerCompareData = NonNullable<Awaited<ReturnType<typeof loadPlayer>>>;

export default async function ConfrontoPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string | string[] }>;
}) {
  const params = await searchParams;
  const slugs = (Array.isArray(params.p) ? params.p : params.p ? [params.p] : []).slice(0, 4);

  const loaded = await Promise.all(slugs.map(loadPlayer));
  const players = loaded.filter((p): p is PlayerCompareData => p != null);

  return (
    <div className="min-h-screen bg-zinc-50 p-6 font-sans dark:bg-black sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Confronto</h1>
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Dashboard
        </Link>
      </header>

      {players.length === 0 ? (
        <p className="text-zinc-500">
          Nessun giocatore selezionato. Torna alla{" "}
          <Link href="/" className="underline">
            dashboard
          </Link>{" "}
          e seleziona 2-4 giocatori da confrontare.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <tbody>
              <Row label="">
                {players.map((p) => (
                  <td key={p.player.id} className="px-4 py-3 text-center">
                    <RoleBadge role={p.player.roleClassic} />
                    <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">
                      <Link href={`/giocatori/${p.player.slug}`} className="hover:underline">
                        {p.player.name}
                      </Link>
                    </p>
                    <p className="text-xs text-zinc-500">{p.team.name}</p>
                  </td>
                ))}
              </Row>
              <Row label="Quotazione (Classic)">
                {players.map((p) => (
                  <Cell key={p.player.id} value={p.player.quotCurrentClassic} />
                ))}
              </Row>
              <Row label="FVM (Classic)">
                {players.map((p) => (
                  <Cell key={p.player.id} value={p.player.fvmClassic} />
                ))}
              </Row>
              <Row label="Partite 2025/26">
                {players.map((p) => (
                  <Cell key={p.player.id} value={p.stats?.pv} />
                ))}
              </Row>
              <Row label="Media voto">
                {players.map((p) => (
                  <Cell key={p.player.id} value={p.stats?.mv} />
                ))}
              </Row>
              <Row label="Fantamedia">
                {players.map((p) => (
                  <Cell key={p.player.id} value={p.stats?.fm} />
                ))}
              </Row>
              <Row label="Gol">
                {players.map((p) => (
                  <Cell key={p.player.id} value={p.stats?.goals} />
                ))}
              </Row>
              <Row label="Assist">
                {players.map((p) => (
                  <Cell key={p.player.id} value={p.stats?.assists} />
                ))}
              </Row>
              <Row label="Indice consigli">
                {players.map((p) => (
                  <Cell key={p.player.id} value={p.advice?.score} suffix="/100" />
                ))}
              </Row>
              <Row label="Fascia">
                {players.map((p) => (
                  <Cell key={p.player.id} value={p.advice ? bandLabel(p.advice.band) : null} />
                ))}
              </Row>
              <Row label="Prezzo consigliato">
                {players.map((p) => (
                  <Cell key={p.player.id} value={p.advice?.suggestedPrice} />
                ))}
              </Row>
              <Row label="Titolarità attesa">
                {players.map((p) => (
                  <Cell
                    key={p.player.id}
                    value={
                      p.latestLineup
                        ? `${p.latestLineup.status}${p.latestLineup.probability != null ? ` (${p.latestLineup.probability}%)` : ""}`
                        : null
                    }
                  />
                ))}
              </Row>
              <Row label="Rigorista">
                {players.map((p) => (
                  <Cell
                    key={p.player.id}
                    value={p.penaltyPriority != null ? `opzione ${p.penaltyPriority}` : null}
                  />
                ))}
              </Row>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-800">
      <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-zinc-500">
        {label}
      </th>
      {children}
    </tr>
  );
}

function Cell({ value, suffix }: { value: string | number | null | undefined; suffix?: string }) {
  return (
    <td className="px-4 py-3 text-center font-medium text-zinc-900 dark:text-zinc-50">
      {value ?? "—"}
      {value != null && suffix}
    </td>
  );
}
