import Link from "next/link";
import { getLatestNews } from "@/lib/queries/news";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function NotiziePage() {
  const articles = await getLatestNews(50);

  return (
    <div className="min-h-screen bg-zinc-50 p-6 font-sans dark:bg-black sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Notizie</h1>
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Dashboard
        </Link>
      </header>

      {articles.length === 0 ? (
        <p className="text-zinc-500">
          Nessuna notizia in database. Vai in{" "}
          <Link href="/impostazioni" className="underline">
            Impostazioni
          </Link>{" "}
          e aggiorna le notizie.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {articles.map((a) => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 rounded-md border border-zinc-200 bg-white p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              {a.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.imageUrl}
                  alt=""
                  className="h-16 w-24 shrink-0 rounded object-cover"
                />
              )}
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {a.title}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {a.author} · {formatDate(a.publishedAt)}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
