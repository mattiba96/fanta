import { getOrFetchDescription } from "@/lib/scraping/sources/playerDescription";

/**
 * Componente asincrono a sé stante, come FcpSection: isola il fetch pigro
 * (che può dover contattare fantacalcio.it al volo) così un sito lento
 * ritarda solo questa sezione dentro <Suspense>, mai l'intera scheda.
 */
export async function DescriptionSection({ playerId }: { playerId: number }) {
  const description = await getOrFetchDescription(playerId);
  if (!description) return null;

  const { generalDescription, proDescription, contraDescription } = description;
  if (!generalDescription && !proDescription && !contraDescription) return null;

  return (
    <div className="mb-6 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">Fantacalcio.it</p>
      {generalDescription && (
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">{generalDescription}</p>
      )}
      {proDescription && (
        <p className="mb-2 text-sm">
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">PRO: </span>
          <span className="text-zinc-600 dark:text-zinc-300">{proDescription}</span>
        </p>
      )}
      {contraDescription && (
        <p className="text-sm">
          <span className="font-semibold text-red-600 dark:text-red-400">CONTRO: </span>
          <span className="text-zinc-600 dark:text-zinc-300">{contraDescription}</span>
        </p>
      )}
    </div>
  );
}

export function DescriptionSectionSkeleton() {
  return (
    <div className="mb-6 h-20 animate-pulse rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
  );
}
