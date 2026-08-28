import { getFcpRating } from "@/lib/queries/fcpRatings";
import { getOrFetchComment } from "@/lib/scraping/sources/fcpRatings";

/**
 * Componente asincrono a sé: il fetch del commento (getOrFetchComment) può
 * dover contattare fantacalciopedia.com al volo. Isolarlo qui e avvolgerlo in
 * <Suspense> nella pagina fa sì che un sito lento ritardi solo questa sezione,
 * non l'intera scheda giocatore (partite/statistiche/formazioni restano
 * immediate anche se questo fetch impiega qualche secondo).
 */
export async function FcpSection({ playerId }: { playerId: number }) {
  const [fcpRating, fcpComment] = await Promise.all([
    getFcpRating(playerId),
    getOrFetchComment(playerId),
  ]);
  const fcpTags = fcpRating?.tags ? fcpRating.tags.split(";").filter(Boolean) : [];

  if (!fcpRating && !fcpComment) return null;

  return (
    <div className="mb-6 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">FantaCalcioPedia</p>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {fcpRating?.algScore != null && (
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Indice appetibilità</p>
            <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {fcpRating.algScore}
              <span className="text-sm font-normal text-zinc-400">/100</span>
            </p>
          </div>
        )}
        {fcpComment?.injuryResistance != null && (
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Resistenza infortuni</p>
            <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
              {fcpComment.injuryResistance}%
            </p>
          </div>
        )}
        {fcpComment?.investmentSolidity != null && (
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Solidità investimento</p>
            <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
              {fcpComment.investmentSolidity}%
            </p>
          </div>
        )}
      </div>
      {fcpTags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {fcpTags.map((tag, i) => (
            <span
              key={i}
              className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {(fcpComment?.predictedAppearances || fcpComment?.predictedGoals || fcpComment?.predictedAssists) && (
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          {fcpComment.predictedAppearances && (
            <span className="text-zinc-600 dark:text-zinc-300">
              <span className="text-zinc-400">Presenze previste </span>
              {fcpComment.predictedAppearances[0]}-{fcpComment.predictedAppearances[1]}
            </span>
          )}
          {fcpComment.predictedGoals && (
            <span className="text-zinc-600 dark:text-zinc-300">
              <span className="text-zinc-400">Gol previsti </span>
              {fcpComment.predictedGoals[0]}-{fcpComment.predictedGoals[1]}
            </span>
          )}
          {fcpComment.predictedAssists && (
            <span className="text-zinc-600 dark:text-zinc-300">
              <span className="text-zinc-400">Assist previsti </span>
              {fcpComment.predictedAssists[0]}-{fcpComment.predictedAssists[1]}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function FcpSectionSkeleton() {
  return (
    <div className="mb-6 h-24 animate-pulse rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
  );
}
