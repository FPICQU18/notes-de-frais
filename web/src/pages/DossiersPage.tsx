import { useEffect, useRef, useState } from "react";
import { Folder, Plus } from "lucide-react";

import type { Note } from "../api/client";
import { CarteDossier } from "../components/dossier/CarteDossier";
import { NouveauDossierDialog } from "../components/dossier/NouveauDossierDialog";
import { useApiGet } from "../lib/useApiGet";

type Props = {
  onSessionExpiree: () => void;
};

/** Liste des dossiers de l'utilisateur + création d'un nouveau dossier. */
export function DossiersPage({ onSessionExpiree }: Props) {
  const refTitre = useRef<HTMLHeadingElement>(null);
  const refNouveau = useRef<HTMLButtonElement>(null);
  const refDialogueEtaitOuvert = useRef(false);
  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const dossiers = useApiGet<Note[]>("/v1/notes", onSessionExpiree);

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
        {liste.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
            {liste.map((note) => (
              <CarteDossier key={note.id} note={note} />
            ))}
          </ul>
        )}
      </section>

      {dialogueOuvert && (
        <NouveauDossierDialog onFerme={fermerDialogue} onSessionExpiree={onSessionExpiree} />
      )}
    </main>
  );
}
