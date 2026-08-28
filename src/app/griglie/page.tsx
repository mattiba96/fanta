import Link from "next/link";
import { getGoalkeeperPairingGrid, getAttackerFixtureOutlook, type GoalkeeperGridEntry } from "@/lib/queries/griglie";

export const dynamic = "force-dynamic";

function DifficultyDot({ value }: { value: number }) {
  // 0-100: più basso = più facile (attacco avversario debole per i portieri,
  // difesa avversaria debole per gli attaccanti è "opportunità" già invertita
  // a monte, quindi qui il verde è sempre "buona notizia").
  const color =
    value <= 33
      ? "bg-emerald-500"
      : value <= 66
        ? "bg-amber-500"
        : "bg-red-500";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} title={`${value}/100`} />;
}

function GoalkeeperEntryCard({ entry }: { entry: GoalkeeperGridEntry }) {
  const b = entry.difficultyBreakdown;
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {entry.teams.map((t, i) => (
            <div key={t.teamId} className="flex items-center gap-3">
              {i > 0 && <span className="text-zinc-500 dark:text-zinc-400">+</span>}
              <div>
                {t.keeper ? (
                  <Link
                    href={`/giocatori/${t.keeper.slug}`}
                    className="font-semibold text-zinc-900 hover:underline dark:text-zinc-50"
                  >
                    {t.keeper.name}
                  </Link>
                ) : (
                  <span className="font-semibold text-zinc-400">—</span>
                )}
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{t.teamName}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-400">Indice</p>
          <p className="text-lg font-semibold text-brand">{entry.score}</p>
        </div>
      </div>
      {b && (
        <p className="mt-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> {b.easy} facili
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> {b.medium} medie
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> {b.hard} difficili
          </span>
        </p>
      )}
    </div>
  );
}

export default async function GrigliePage() {
  const [keeperGrid, attackerOutlook] = await Promise.all([
    getGoalkeeperPairingGrid(),
    getAttackerFixtureOutlook(),
  ]);

  const noKeeperGrid =
    keeperGrid.coppie.length === 0 && keeperGrid.coppieLowCost.length === 0 && keeperGrid.terzetti.length === 0;
  const noCalendar = attackerOutlook.matchdays.length === 0;

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <span aria-hidden>🧮</span> Griglie
        </h1>
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Dashboard
        </Link>
      </header>

      <section className="mb-10">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          <span aria-hidden>🧤</span> Griglia portieri
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          Coppie e terzetti consigliati per l&apos;alternanza tra partite facili e difficili, curati da{" "}
          <a
            href={keeperGrid.sourceUrl ?? "https://www.sosfanta.com"}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            SOS Fanta / FantaLab
          </a>{" "}
          — indice di abbinamento da 1 a 100, più alto è meglio.
          {keeperGrid.matchdays.length > 0 && (
            <>
              {" "}Il conteggio facili/medie/difficili è calcolato da noi sul calendario reale delle giornate{" "}
              {keeperGrid.matchdays[0]}–{keeperGrid.matchdays[keeperGrid.matchdays.length - 1]} (per ogni giornata
              conta l&apos;impegno più facile tra le squadre della coppia/terzetto, dato che scegli di volta in
              volta chi schierare).
            </>
          )}
        </p>

        {noKeeperGrid ? (
          <p className="text-sm text-zinc-400">
            Griglia non ancora scaricata. Vai in{" "}
            <Link href="/impostazioni" className="underline">
              Impostazioni
            </Link>{" "}
            e clicca &quot;Aggiorna tutto&quot;.
          </p>
        ) : (
          <>
            {keeperGrid.coppie.length > 0 && (
              <div className="mb-6">
                <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Coppie</p>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {keeperGrid.coppie.map((e, i) => (
                    <GoalkeeperEntryCard key={i} entry={e} />
                  ))}
                </div>
              </div>
            )}
            {keeperGrid.coppieLowCost.length > 0 && (
              <div className="mb-6">
                <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Coppie low cost</p>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {keeperGrid.coppieLowCost.map((e, i) => (
                    <GoalkeeperEntryCard key={i} entry={e} />
                  ))}
                </div>
              </div>
            )}
            {keeperGrid.terzetti.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Terzetti</p>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {keeperGrid.terzetti.map((e, i) => (
                    <GoalkeeperEntryCard key={i} entry={e} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          <span aria-hidden>⚽</span> Griglia attaccanti
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          Squadre ordinate per calendario più favorevole nelle prossime giornate (avversari con difesa
          debole = più occasioni da gol per i loro attaccanti).
        </p>

        {noCalendar ? (
          <p className="text-sm text-zinc-400">
            Calendario non ancora scaricato. Vai in{" "}
            <Link href="/impostazioni" className="underline">
              Impostazioni
            </Link>{" "}
            e clicca &quot;Aggiorna calendario&quot;.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-100 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Squadra</th>
                  <th className="px-3 py-2 font-medium">Calendario</th>
                  <th className="px-3 py-2 font-medium">Media</th>
                  <th className="px-3 py-2 font-medium">Top attaccanti</th>
                </tr>
              </thead>
              <tbody>
                {attackerOutlook.teams.map((t) => (
                  <tr key={t.team.teamId} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2 font-medium">{t.team.teamName}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {t.perMatchday.map((m) => (
                          <div key={m.matchday} className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-zinc-400">G{m.matchday}</span>
                            {/* opportunity già in scala "alto = favorevole": inverto per il pallino
                                (verde quando l'opportunità è alta, cioè difesa avversaria debole) */}
                            <DifficultyDot value={100 - m.opportunity} />
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-semibold text-brand">{t.avgOpportunity}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {t.topAttackers.map((a) => (
                          <Link
                            key={a.playerId}
                            href={`/giocatori/${a.slug}`}
                            className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 hover:underline dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            {a.name} ({a.score})
                          </Link>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
