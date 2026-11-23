import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { ApiError, apiPost, MESSAGE_GENERIQUE, type Depense } from "../../api/client";
import { formatDateCourte, formatMontant } from "../../lib/format";
import { useApiGet } from "../../lib/useApiGet";

type Props = {
  idNote: number;
  onFerme: () => void;
  /** Appelé après un ajout réussi : le parent recharge le détail et ferme le panneau. */
  onAjout: () => void;
  onSessionExpiree: () => void;
};

/**
 * Panneau d'ajout de dépenses à un dossier : liste les dépenses « à classer »,
 * sélection par cases à cocher, puis un unique `POST …/depenses` (batch atomique).
 */
export function PanneauAjoutDepenses({ idNote, onFerme, onAjout, onSessionExpiree }: Props) {
  const refTitre = useRef<HTMLHeadingElement>(null);
  const aClasser = useApiGet<Depense[]>("/v1/depenses?a_classer=true", onSessionExpiree);
  const [selection, setSelection] = useState<number[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  function basculer(id: number) {
    setSelection((actuelle) =>
      actuelle.includes(id) ? actuelle.filter((valeur) => valeur !== id) : [...actuelle, id],
    );
  }

  function gererToucheClavier(evenement: KeyboardEvent<HTMLDivElement>) {
    if (evenement.key === "Escape" && !envoiEnCours) {
      onFerme();
    }
  }

  async function ajouter() {
    setEnvoiEnCours(true);
    setErreur(null);
    try {
      await apiPost(`/v1/notes/${idNote}/depenses`, { depense_ids: selection });
      onAjout();
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      setErreur(attrape instanceof ApiError ? attrape.message : MESSAGE_GENERIQUE);
      setEnvoiEnCours(false);
    }
  }

  const liste = aClasser.donnees ?? [];
  const aucune = !aClasser.chargement && aClasser.erreur === null && liste.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(26,26,46,0.45)] sm:items-center sm:justify-center sm:px-5"
      onClick={onFerme}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-ajout-depenses"
        className="w-full rounded-t-[26px] bg-[var(--card)] p-5 pb-8 shadow-[var(--ombre-carte)] sm:max-w-[420px] sm:rounded-[26px]"
        onClick={(evenement) => evenement.stopPropagation()}
        onKeyDown={gererToucheClavier}
      >
        <h2
          ref={refTitre}
          tabIndex={-1}
          id="titre-ajout-depenses"
          className="m-0 mb-4 text-[20px] font-extrabold tracking-[-0.01em] focus:outline-none"
        >
          Ajouter des dépenses
        </h2>

        <section aria-busy={aClasser.chargement || undefined} aria-label="Dépenses à classer">
          {aClasser.chargement && <p className="chargement">Chargement…</p>}

          {!aClasser.chargement && aClasser.erreur !== null && (
            <p
              role="alert"
              className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {aClasser.erreur}
            </p>
          )}

          {aucune && (
            <p className="m-0 text-[15px] text-[var(--muted-foreground)]">
              Aucune dépense à classer.
            </p>
          )}

          {!aClasser.chargement && aClasser.erreur === null && liste.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {liste.map((depense) => {
                const coche = selection.includes(depense.id);
                return (
                  <li key={depense.id}>
                    <label
                      htmlFor={`depense-${depense.id}`}
                      className="flex items-center gap-3 rounded-[18px] bg-[var(--secondary)] px-3 py-2.5"
                    >
                      <input
                        id={`depense-${depense.id}`}
                        type="checkbox"
                        checked={coche}
                        onChange={() => basculer(depense.id)}
                        className="h-5 w-5 shrink-0 accent-[var(--primary)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">
                          {depense.libelle}
                        </span>
                        <span className="block text-[13px] text-[var(--muted-foreground)]">
                          {formatDateCourte(depense.date_depense)} ·{" "}
                          {formatMontant(depense.montant_centimes)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {erreur !== null && (
          <p
            role="alert"
            className="m-0 mt-4 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
          >
            {erreur}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onFerme}
            disabled={envoiEnCours}
            className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void ajouter()}
            disabled={envoiEnCours || selection.length === 0 || aucune}
            aria-busy={envoiEnCours}
            className="h-[52px] rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
          >
            {envoiEnCours ? "Ajout…" : "Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
}
