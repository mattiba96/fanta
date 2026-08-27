import Link from "next/link";
import { getTypicalLineups } from "@/lib/queries/formazioneTipo";
import { getPlayerImageUrl } from "@/lib/playerImage";

export const dynamic = "force-dynamic";

const ROLE_LABELS = { P: "Portiere", D: "Difensori", C: "Centrocampisti", A: "Attaccanti" } as const;

export default async function FormazioneTipoPage() {
  const teams = await getTypicalLineups();

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            <span aria-hidden>📋</span> Formazione tipo
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Gli 11 titolari attesi per continuità durante la stagione secondo il modulo di
            ogni squadra, con i ballottaggi per chi è vicino al posto da titolare.
          </p>
        </div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Dashboard
        </Link>
      </header>

      {teams.length === 0 ? (
        <p className="text-zinc-500">
          Nessun dato disponibile. Vai in{" "}
          <Link href="/impostazioni" className="underline">
            Impostazioni
          </Link>{" "}
          e aggiorna l&apos;indice appetibilità.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <div
              key={team.teamId}
              className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h2 className="mb-3 flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-50">
                {team.teamName}
                {team.formation && (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-normal text-brand-soft-fg">
                    {team.formation}
                  </span>
                )}
              </h2>
              {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((role) => (
                <div key={role} className="mb-2">
                  <p className="text-xs text-zinc-400">{ROLE_LABELS[role]}</p>
                  <ul className="space-y-1">
                    {team.byRole[role].map((p) => {
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
                    {team.byRole[role].length === 0 && (
                      <li className="text-sm text-zinc-400">—</li>
                    )}
                  </ul>
                  {team.ballottaggi[role].length > 0 && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Ballottaggio:{" "}
                      {team.ballottaggi[role].map((p, i) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
