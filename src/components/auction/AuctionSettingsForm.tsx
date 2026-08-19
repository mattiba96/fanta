"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAuctionSettings } from "@/actions/auction";
import type { AuctionSettings } from "@/lib/queries/auction";

export function AuctionSettingsForm({ settings }: { settings: AuctionSettings }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    totalBudget: settings.totalBudget,
    slotsGk: settings.slotsGk,
    slotsDef: settings.slotsDef,
    slotsMid: settings.slotsMid,
    slotsFwd: settings.slotsFwd,
    mode: settings.mode as "classic" | "mantra",
    leagueName: settings.leagueName ?? "",
  });
  const [saved, setSaved] = useState(false);

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value =
        e.target.type === "number" ? Number(e.target.value) : e.target.value;
      setForm((f) => ({ ...f, [key]: value }));
      setSaved(false);
    },
  });

  const onSave = () => {
    startTransition(async () => {
      await saveAuctionSettings(form);
      setSaved(true);
      router.refresh();
    });
  };

  const inputClass =
    "w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="flex flex-wrap items-end gap-4">
      <LabeledField label="Budget totale">
        <input type="number" min={1} className={inputClass} {...field("totalBudget")} />
      </LabeledField>
      <LabeledField label="Portieri">
        <input type="number" min={0} className={inputClass} {...field("slotsGk")} />
      </LabeledField>
      <LabeledField label="Difensori">
        <input type="number" min={0} className={inputClass} {...field("slotsDef")} />
      </LabeledField>
      <LabeledField label="Centrocampisti">
        <input type="number" min={0} className={inputClass} {...field("slotsMid")} />
      </LabeledField>
      <LabeledField label="Attaccanti">
        <input type="number" min={0} className={inputClass} {...field("slotsFwd")} />
      </LabeledField>
      <LabeledField label="Modalità">
        <select className={inputClass} {...field("mode")}>
          <option value="classic">Classic</option>
          <option value="mantra">Mantra</option>
        </select>
      </LabeledField>
      <button
        onClick={onSave}
        disabled={isPending}
        className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
      >
        {isPending ? "Salvataggio…" : "Salva"}
      </button>
      {saved && !isPending && (
        <span className="text-xs text-emerald-600">Salvato</span>
      )}
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      {label}
      {children}
    </label>
  );
}
