"use client";

import { useRouter } from "next/navigation";

/**
 * Torna alla pagina precedente nella cronologia del browser invece di un
 * href fisso: un link fisso a "/" perde sempre i filtri applicati sulla
 * dashboard (sono nell'URL, non nello stato del server), mentre
 * router.back() ripristina esattamente la vista da cui si è arrivati.
 */
export function BackLink({ fallbackHref, label }: { fallbackHref: string; label: string }) {
  const router = useRouter();

  return (
    <button
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
    >
      {label}
    </button>
  );
}
