import { db } from "@/db/client";
import { teams } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function Home() {
  const allTeams = await db.select().from(teams);

  return (
    <div className="min-h-screen bg-zinc-50 p-10 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        FantAsta — scaffold OK
      </h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Squadre in database: {allTeams.length}
      </p>
      <ul className="mt-4 grid grid-cols-4 gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        {allTeams.map((t) => (
          <li key={t.id}>
            {t.code} — {t.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
