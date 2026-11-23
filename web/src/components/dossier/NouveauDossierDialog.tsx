import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router";

import { ApiError, apiPost, erreursDeDetail, type Note } from "../../api/client";

type Props = {
  onFerme: () => void;
  onSessionExpiree: () => void;
};

const MAX_LIBELLE = 200;

/** Dialogue de création d'un dossier : titre requis, 200 caractères max, POST puis navigation. */
export function NouveauDossierDialog({ onFerme, onSessionExpiree }: Props) {
  const navigate = useNavigate();
  const refTitre = useRef<HTMLInputElement>(null);
  const [titre, setTitre] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  function gererToucheClavier(evenement: KeyboardEvent<HTMLDivElement>) {
    if (evenement.key === "Escape" && !envoiEnCours) {
      onFerme();
    }
  }

  async function envoyer() {
    const libelle = titre.trim();
    if (libelle === "") {
      setErreur("Le libellé est requis.");
      refTitre.current?.focus();
      return;
    }
    if (libelle.length > MAX_LIBELLE) {
      setErreur("Le libellé est trop long (200 caractères maximum).");
      refTitre.current?.focus();
      return;
    }

    setErreur(null);
    setEnvoiEnCours(true);
    try {
      const note = await apiPost<Note>("/v1/notes", { libelle });
      navigate(`/dossiers/${note.id}`);
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      if (attrape instanceof ApiError && attrape.status === 422) {
        const entrees = erreursDeDetail(attrape.detail);
        const erreurLibelle = entrees.find((entree) => entree.champ === "libelle");
        setErreur(erreurLibelle?.message ?? attrape.message);
      } else {
        setErreur(attrape instanceof ApiError ? attrape.message : "Une erreur est survenue.");
      }
      setEnvoiEnCours(false);
    }
  }

  function gererSoumission(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    void envoyer();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(26,26,46,0.45)] sm:items-center sm:justify-center sm:px-5"
      onClick={onFerme}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-nouveau-dossier"
        className="w-full rounded-t-[26px] bg-[var(--card)] p-5 pb-8 shadow-[var(--ombre-carte)] sm:max-w-[420px] sm:rounded-[26px]"
        onClick={(evenement) => evenement.stopPropagation()}
        onKeyDown={gererToucheClavier}
      >
        <form onSubmit={gererSoumission} noValidate>
          <h2
            id="titre-nouveau-dossier"
            className="m-0 mb-4 text-[20px] font-extrabold tracking-[-0.01em]"
          >
            Nouveau dossier
          </h2>
          <label
            htmlFor="titre-dossier"
            className="mb-1.5 block text-[13px] font-bold text-[var(--foreground)]"
          >
            Titre
          </label>
          <input
            ref={refTitre}
            id="titre-dossier"
            type="text"
            autoComplete="off"
            value={titre}
            onChange={(evenement) => setTitre(evenement.target.value)}
            aria-invalid={erreur !== null}
            aria-describedby={erreur !== null ? "titre-dossier-erreur" : undefined}
            className="h-[52px] w-full rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          />
          {erreur !== null && (
            <p
              id="titre-dossier-erreur"
              role="alert"
              className="m-0 mt-1.5 text-[13px] font-semibold text-[var(--erreur-texte)]"
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
              type="submit"
              disabled={envoiEnCours}
              aria-busy={envoiEnCours}
              className="h-[52px] rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
            >
              {envoiEnCours ? "Création…" : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
