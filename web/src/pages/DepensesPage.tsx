import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { Check, Receipt } from "lucide-react";

import type { Depense } from "../api/client";
import { CarteDepense } from "../components/depense/CarteDepense";
import { useApiGet } from "../lib/useApiGet";

type Props = {
  onSessionExpiree: () => void;
};

/** Messages d'annonce légitimes (posés par les écrans de saisie/d'édition). */
const ANNONCES = new Set([
  "Dépense enregistrée.",
  "Dépense modifiée.",
  "Dépense supprimée.",
]);

export function DepensesPage({ onSessionExpiree }: Props) {
  const refTitre = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const depenses = useApiGet<Depense[]>("/v1/depenses", onSessionExpiree);

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  const etatNavigation = location.state as { annonce?: unknown } | null;
  const annonce =
    etatNavigation !== null && typeof etatNavigation.annonce === "string" &&
    ANNONCES.has(etatNavigation.annonce)
      ? etatNavigation.annonce
      : null;

  const liste = depenses.donnees ?? [];

  return (
    <main className="px-5 pt-6">
      <h1
        ref={refTitre}
        tabIndex={-1}
        className="m-0 mb-4 text-2xl font-extrabold tracking-[-0.01em] focus:outline-none"
      >
        Dépenses
      </h1>

      {annonce !== null && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-[16px] bg-[var(--accent)] px-4 py-3 text-[13px] font-bold text-[var(--accent-foreground)]"
        >
          <Check aria-hidden strokeWidth={2} className="mt-0.5 h-[18px] w-[18px] shrink-0" />
          <span>{annonce}</span>
        </div>
      )}

      <section aria-busy={depenses.chargement || undefined} aria-label="Dépenses">
        {depenses.chargement && <p className="chargement">Chargement…</p>}

        {!depenses.chargement && depenses.erreur !== null && (
          <div className="flex flex-col gap-3">
            <p
              role="alert"
              className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {depenses.erreur}
            </p>
            <button
              type="button"
              onClick={depenses.reessayer}
              className="h-12 w-full rounded-[18px] bg-[var(--primary)] text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              Réessayer
            </button>
          </div>
        )}

        {!depenses.chargement && depenses.erreur === null && liste.length === 0 && (
          <div className="mt-12 flex flex-col items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)]"
            >
              <Receipt strokeWidth={2} className="h-7 w-7" />
            </span>
            <p className="m-0 text-center text-[15px] text-[var(--muted-foreground)]">
              Aucune dépense pour l'instant.
            </p>
            <Link
              to="/depenses/nouvelle"
              className="inline-flex h-11 items-center rounded-[999px] bg-[var(--accent)] px-5 text-[15px] font-bold text-[var(--accent-foreground)] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              Ajouter une dépense
            </Link>
          </div>
        )}

        {!depenses.chargement && depenses.erreur === null && liste.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
            {liste.map((depense) => (
              <CarteDepense key={depense.id} depense={depense} vers={`/depenses/${depense.id}`} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
