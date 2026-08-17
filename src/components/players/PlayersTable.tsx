"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PlayerRow } from "@/lib/queries/players";
import { QuickAssignControl } from "@/components/auction/QuickAssignControl";

type SortKey = "quotCurrentClassic" | "fvmClassic" | "mv" | "fm" | "goals" | "assists";

const ROLES: { value: string; label: string }[] = [
  { value: "", label: "Tutti i ruoli" },
  { value: "P", label: "Portiere" },
  { value: "D", label: "Difensore" },
  { value: "C", label: "Centrocampista" },
  { value: "A", label: "Attaccante" },
];

export function PlayersTable({ players }: { players: PlayerRow[] }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [team, setTeam] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("quotCurrentClassic");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const teamOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const p of players) set.set(p.teamCode, p.teamName);
    return [...set.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [players]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = players.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (role && p.roleClassic !== role) return false;
      if (team && p.teamCode !== team) return false;
      if (onlyAvailable && !p.isAvailable) return false;
      return true;
    });

    rows = rows.slice().sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      const diff = (av as number) - (bv as number);
      return sortDir === "asc" ? diff : -diff;
    });

    return rows;
  }, [players, search, role, team, onlyAvailable, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Cerca giocatore…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">Tutte le squadre</option>
          {teamOptions.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />
          Solo disponibili
        </label>
        <span className="ml-auto text-sm text-zinc-500">{filtered.length} giocatori</span>
      </div>

      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Ruolo</th>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Squadra</th>
              <SortableHeader label="Qt.A" sortKey="quotCurrentClassic" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortableHeader label="FVM" sortKey="fvmClassic" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortableHeader label="MV" sortKey="mv" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortableHeader label="FM" sortKey="fm" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortableHeader label="Gol" sortKey="goals" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortableHeader label="Ass." sortKey="assists" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <th className="px-3 py-2 font-medium">Stato</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <td className="px-3 py-2">
                  <RoleBadge role={p.roleClassic} />
                </td>
                <td className="px-3 py-2 font-medium">
                  <Link href={`/giocatori/${p.slug}`} className="hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-zinc-500">{p.teamCode}</td>
                <td className="px-3 py-2">{p.quotCurrentClassic ?? "—"}</td>
                <td className="px-3 py-2">{p.fvmClassic ?? "—"}</td>
                <td className="px-3 py-2">{p.mv?.toFixed(2) ?? "—"}</td>
                <td className="px-3 py-2">{p.fm?.toFixed(2) ?? "—"}</td>
                <td className="px-3 py-2">{p.goals ?? "—"}</td>
                <td className="px-3 py-2">{p.assists ?? "—"}</td>
                <td className="px-3 py-2">
                  <QuickAssignControl
                    playerId={p.id}
                    roleClassic={p.roleClassic}
                    isAvailable={p.isAvailable}
                    ownedBy={p.ownedBy}
                    pricePaid={p.pricePaid}
                  />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-zinc-400">
                  Nessun giocatore trovato. Prova ad aggiornare i dati dalla pagina Impostazioni.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  current,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  onClick: (key: SortKey) => void;
}) {
  const active = sortKey === current;
  return (
    <th
      className="cursor-pointer select-none px-3 py-2 font-medium"
      onClick={() => onClick(sortKey)}
    >
      {label} {active && (dir === "asc" ? "▲" : "▼")}
    </th>
  );
}

const ROLE_COLORS: Record<string, string> = {
  P: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  D: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  C: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  A: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

export function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-zinc-400">—</span>;
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${ROLE_COLORS[role] ?? ""}`}>
      {role}
    </span>
  );
}
