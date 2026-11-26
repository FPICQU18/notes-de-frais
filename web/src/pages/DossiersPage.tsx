import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { Folder, Plus } from "lucide-react";

import type { Note } from "../api/client";
import { CarteDossier } from "../components/dossier/CarteDossier";
import { NouveauDossierDialog } from "../components/dossier/NouveauDossierDialog";
import { PastilleStatut } from "../components/dossier/PastilleStatut";
import { TableauTriable, type ColonneTableau } from "../components/TableauTriable";
import { useApiGet } from "../lib/useApiGet";
import { useBureau } from "../lib/useMediaQuery";
import { formatDateAnnee, formatMontant, formatNbDepenses } from "../lib/format";

type Props = {
  onSessionExpiree: () => void;
};

/** Colonnes du tableau bureau des dossiers (US-044), dans l'ordre de la maquette. */
function colonnesDossiers(): ColonneTableau<Note>[] {
  return [
    {
      cle: "date",
      libelle: "Date",
      triable: true,
      classe: "w-[170px]",
      valeurTri: (note) => note.derniere_depense_le ?? "",
      cellule: (note) => (
        <span className="text-[14px] whitespace-nowrap text-[var(--muted-foreground)]">
          {note.derniere_depense_le === null
            ? "Aucune dépense"
            : formatDateAnnee(note.derniere_depense_le)}
        </span>
      ),
    },
    {
      cle: "libelle",
      libelle: "Libellé",
      classe: "min-w-0 flex-1",
      cellule: (note) => (
        <span className="block truncate text-[15px] font-bold">
          {note.libelle}
          <span className="ml-2 text-[13px] font-semibold whitespace-nowrap text-[var(--muted-foreground)]">
            {formatNbDepenses(note.nb_depenses)}
          </span>
        </span>
      ),
    },
    {
      cle: "categorie",
      libelle: "Catégorie",
      classe: "w-[140px]",
      // Un dossier n'a pas de catégorie propre (l'API `Note` n'en renvoie
      // pas) : colonne présente mais non applicable.
      cellule: () => <span className="text-[14px] text-[var(--muted-foreground)]">—</span>,
    },
    {
      cle: "montant",
      libelle: "Montant",
      triable: true,
      classe: "w-[130px]",
      valeurTri: (note) => note.total_centimes,
      cellule: (note) => (
        <span className="block text-right text-[15px] font-extrabold tabular-nums">
          {formatMontant(note.total_centimes)}
        </span>
      ),
    },
    {
      cle: "statut",
      libelle: "Statut",
      classe: "w-[130px]",
      cellule: (note) => <PastilleStatut statut={note.statut} />,
    },
  ];
}

/** Liste des dossiers de l'utilisateur + création d'un nouveau dossier. */
export function DossiersPage({ onSessionExpiree }: Props) {
  const refTitre = useRef<HTMLHeadingElement>(null);
  const refNouveau = useRef<HTMLButtonElement>(null);
  const refDialogueEtaitOuvert = useRef(false);
  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const dossiers = useApiGet<Note[]>("/v1/notes", onSessionExpiree);
  const bureau = useBureau();

  const location = useLocation();
  const annonce = (location.state as { annonce?: string } | null)?.annonce ?? null;

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  useEffect(() => {
    if (dialogueOuvert) {
      refDialogueEtaitOuvert.current = true;
    } else if (refDialogueEtaitOuvert.current) {
      refNouveau.current?.focus();
      refDialogueEtaitOuvert.current = false;
    }
  }, [dialogueOuvert]);

  const liste = dossiers.donnees ?? [];
  const estVide = !dossiers.chargement && dossiers.erreur === null && liste.length === 0;

  function ouvrirDialogue() {
    setDialogueOuvert(true);
  }

  function fermerDialogue() {
    setDialogueOuvert(false);
  }

  return (
    <main className="mx-auto w-full max-w-[560px] px-5 pb-28 pt-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1
          ref={refTitre}
          tabIndex={-1}
          className="m-0 text-2xl font-extrabold tracking-[-0.01em] focus:outline-none"
        >
          Dossiers
        </h1>
        {!estVide && (
          <button
            type="button"
            ref={refNouveau}
            onClick={ouvrirDialogue}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--primary)] px-5 text-[15px] font-bold text-[var(--primary-foreground)] shadow-[var(--ombre-bouton-flottant)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:w-auto"
          >
            <Plus aria-hidden strokeWidth={2} className="h-[18px] w-[18px]" />
            Nouveau dossier
          </button>
        )}
      </header>

      {annonce !== null && (
        <p
          role="status"
          className="m-0 mb-4 rounded-[16px] bg-[var(--accent)] p-4 text-[13px] font-semibold text-[var(--accent-foreground)]"
        >
          {annonce}
        </p>
      )}

      <section aria-busy={dossiers.chargement || undefined} aria-label="Dossiers">
        {dossiers.chargement && <p className="chargement">Chargement…</p>}

        {!dossiers.chargement && dossiers.erreur !== null && (
          <div className="flex flex-col gap-3">
            <p
              role="alert"
              className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {dossiers.erreur}
            </p>
            <button
              type="button"
              onClick={dossiers.reessayer}
              className="h-12 w-full rounded-[18px] bg-[var(--primary)] text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              Réessayer
            </button>
          </div>
        )}

        {estVide && (
          <div className="mt-12 flex flex-col items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)]"
            >
              <Folder strokeWidth={2} className="h-7 w-7" />
            </span>
            <p className="m-0 text-center text-[15px] text-[var(--muted-foreground)]">
              Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.
            </p>
            <button
              type="button"
              ref={refNouveau}
              onClick={ouvrirDialogue}
              className="inline-flex h-11 items-center rounded-[999px] bg-[var(--accent)] px-5 text-[15px] font-bold text-[var(--accent-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              Nouveau dossier
            </button>
          </div>
        )}

        {/* La liste est pilotée par la seule présence de données : une erreur
            (ou un rechargement) survenant alors que des dossiers sont déjà
            affichés ne les fait pas disparaître. */}
        {liste.length > 0 &&
          (bureau ? (
            <TableauTriable
              titre="Tous les dossiers"
              colonnes={colonnesDossiers()}
              lignes={liste}
              cleLigne={(note) => note.id}
              vers={(note) => `/dossiers/${note.id}`}
              etiquetteLigne={(note) => `Ouvrir le dossier ${note.libelle}`}
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
              {liste.map((note) => (
                <CarteDossier key={note.id} note={note} />
              ))}
            </ul>
          ))}
      </section>

      {dialogueOuvert && (
        <NouveauDossierDialog onFerme={fermerDialogue} onSessionExpiree={onSessionExpiree} />
      )}
    </main>
  );
}
