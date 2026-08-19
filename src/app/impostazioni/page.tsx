import Link from "next/link";
import { db } from "@/db/client";
import { scrapeRuns } from "@/db/schema";
import { desc } from "drizzle-orm";
import { UpdateDataButtons } from "@/components/data/UpdateDataButtons";
import { AuctionSettingsForm } from "@/components/auction/AuctionSettingsForm";
import { ParticipantsManager } from "@/components/auction/ParticipantsManager";
import { BackupControls } from "@/components/auction/BackupControls";
import { getAuctionSettings } from "@/lib/queries/auction";
import { getParticipantSummaries } from "@/lib/queries/participants";

export const dynamic = "force-dynamic";

export default async function ImpostazioniPage() {
  const [runs, settings, participants] = await Promise.all([
    db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.startedAt)).limit(10),
    getAuctionSettings(),
    getParticipantSummaries(),
  ]);

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Impostazioni
        </h1>
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Dashboard
        </Link>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Asta: budget e slot</h2>
        <AuctionSettingsForm settings={settings} />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Squadre in lega</h2>
        <ParticipantsManager participants={participants} />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Aggiornamento dati</h2>
        <UpdateDataButtons />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Backup asta</h2>
        <BackupControls />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Ultimi aggiornamenti</h2>
        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">Fonte</th>
                <th className="px-3 py-2 font-medium">Stato</th>
                <th className="px-3 py-2 font-medium">Avviato</th>
                <th className="px-3 py-2 font-medium">Dettagli</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">{run.source}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={run.status} />
                  </td>
                  <td className="px-3 py-2 text-zinc-500">
                    {new Date(run.startedAt).toLocaleString("it-IT")}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{run.message ?? "—"}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                    Nessun aggiornamento ancora eseguito.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    running: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${styles[status] ?? ""}`}>
      {status}
    </span>
  );
}
