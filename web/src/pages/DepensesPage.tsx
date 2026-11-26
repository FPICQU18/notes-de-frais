import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { Check, Receipt } from "lucide-react";

import type { Depense } from "../api/client";
import { BulleCategorie } from "../components/depense/BulleCategorie";
import { CarteDepense } from "../components/depense/CarteDepense";
import { TableauTriable, type ColonneTableau } from "../components/TableauTriable";
import { useApiGet } from "../lib/useApiGet";
import { useBureau } from "../lib/useMediaQuery";
import { libelleCategorie } from "../lib/categories";
import { formatDateAnnee, formatMontant } from "../lib/format";

type Props = {
  onSessionExpiree: () => void;
};

/** Messages d'annonce légitimes (posés par les écrans de saisie/d'édition). */
const ANNONCES = new Set([
  "Dépense enregistrée.",
  "Dépense modifiée.",
  "Dépense supprimée.",
]);

/** Colonnes du tableau bureau des dépenses (US-044), dans l'ordre de la maquette. */
function colonnesDepenses(): ColonneTableau<Depense>[] {
  return [
    {
      cle: "date",
      libelle: "Date",
      triable: true,
      classe: "w-[190px]",
      valeurTri: (depense) => depense.date_depense,
      cellule: (depense) => (
        <span className="flex items-center gap-2 text-[14px] whitespace-nowrap text-[var(--muted-foreground)]">
          <BulleCategorie categorie={depense.categorie} />
          <span>{formatDateAnnee(depense.date_depense)}</span>
        </span>
      ),
    },
    {
      cle: "libelle",
      libelle: "Libellé",
      classe: "min-w-0 flex-1",
      cellule: (depense) => (
        <span className="block truncate text-[15px] font-bold">{depense.libelle}</span>
      ),
    },
    {
      cle: "categorie",
      libelle: "Catégorie",
      classe: "w-[150px]",
      cellule: (depense) => (
        <span className="text-[14px] whitespace-nowrap text-[var(--muted-foreground)]">
          {libelleCategorie(depense.categorie)}
        </span>
      ),
    },
    {
      cle: "montant",
      libelle: "Montant",
      triable: true,
      classe: "w-[130px]",
      valeurTri: (depense) => depense.montant_centimes,
      cellule: (depense) => (
        <span className="block text-right text-[15px] font-extrabold tabular-nums">
          {formatMontant(depense.montant_centimes)}
        </span>
      ),
    },
    {
      cle: "statut",
      libelle: "Statut",
      classe: "w-[130px]",
      // Rattachement dossier (maquette bureau-dépenses) : « À classer » quand
      // la dépense n'est rattachée à aucun dossier, sinon « Dossier #<id> ».
      cellule: (depense) => (
        <span className="text-[13px] font-semibold text-[var(--muted-foreground)]">
          {depense.note_id === null ? "À classer" : `Dossier n° ${depense.note_id}`}
        </span>
      ),
    },
  ];
}

export function DepensesPage({ onSessionExpiree }: Props) {
  const refTitre = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const depenses = useApiGet<Depense[]>("/v1/depenses", onSessionExpiree);
  const bureau = useBureau();

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

        {!depenses.chargement && depenses.erreur === null && liste.length > 0 &&
          (bureau ? (
            <TableauTriable
              titre="Toutes les dépenses"
              colonnes={colonnesDepenses()}
              lignes={liste}
              cleLigne={(depense) => depense.id}
              vers={(depense) => `/depenses/${depense.id}`}
              etiquetteLigne={(depense) => `Ouvrir la dépense ${depense.libelle}`}
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
              {liste.map((depense) => (
                <CarteDepense key={depense.id} depense={depense} vers={`/depenses/${depense.id}`} />
              ))}
            </ul>
          ))}
      </section>
    </main>
  );
}
