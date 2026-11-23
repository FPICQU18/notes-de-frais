import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { apiGet, ApiError, MESSAGE_GENERIQUE, type Depense, type Note } from "../api/client";
import { EnTeteDepense, FormulaireDepense, type ValeurDepense } from "../components/depense/FormulaireDepense";

type Props = {
  onSessionExpiree: () => void;
};

type Etat =
  | { statut: "chargement" }
  | { statut: "introuvable" }
  | { statut: "erreur"; message: string }
  | { statut: "attenteStatut"; depense: Depense }
  | { statut: "pret"; depense: Depense; lectureSeule: boolean };

function valeurDepense(depense: Depense): ValeurDepense {
  return {
    libelle: depense.libelle,
    date_depense: depense.date_depense,
    montant_centimes: depense.montant_centimes,
    categorie: depense.categorie,
  };
}

export function DetailDepensePage({ onSessionExpiree }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [etat, setEtat] = useState<Etat>({ statut: "chargement" });
  const [tentative, setTentative] = useState(0);

  useEffect(() => {
    let actif = true;

    (async () => {
      let depense: Depense;
      try {
        depense = await apiGet<Depense>(`/v1/depenses/${id}`);
      } catch (attrape) {
        if (!actif) {
          return;
        }
        if (attrape instanceof ApiError && attrape.status === 401) {
          onSessionExpiree();
          return;
        }
        if (attrape instanceof ApiError && attrape.status === 404) {
          setEtat({ statut: "introuvable" });
          return;
        }
        setEtat({
          statut: "erreur",
          message: attrape instanceof ApiError ? attrape.message : MESSAGE_GENERIQUE,
        });
        return;
      }

      if (!actif) {
        return;
      }

      if (depense.note_id === null) {
        setEtat({ statut: "pret", depense, lectureSeule: false });
        return;
      }

      setEtat({ statut: "attenteStatut", depense });

      try {
        const note = await apiGet<Note>(`/v1/notes/${depense.note_id}`);
        if (actif) {
          setEtat({ statut: "pret", depense, lectureSeule: note.statut !== "brouillon" });
        }
      } catch (attrape) {
        if (!actif) {
          return;
        }
        if (attrape instanceof ApiError && attrape.status === 401) {
          onSessionExpiree();
          return;
        }
        setEtat({ statut: "pret", depense, lectureSeule: true });
      }
    })();

    return () => {
      actif = false;
    };
  }, [id, tentative, onSessionExpiree]);

  const recharger = useCallback(() => {
    setEtat({ statut: "chargement" });
    setTentative((valeur) => valeur + 1);
  }, []);
  const reussir = useCallback(
    (annonce: string | null) => navigate("/depenses", { state: annonce === null ? null : { annonce } }),
    [navigate],
  );

  if (etat.statut === "chargement") {
    return (
      <div className="min-h-[100dvh] bg-white">
        <EnTeteDepense titre="Modifier la dépense" />
        <div aria-busy="true" className="px-5 pt-2">
          <p className="chargement">Chargement…</p>
        </div>
      </div>
    );
  }

  if (etat.statut === "introuvable") {
    return (
      <div className="min-h-[100dvh] bg-white">
        <EnTeteDepense titre="Dépense introuvable." />
        <div className="px-5 pt-2">
          <Link
            to="/depenses"
            className="inline-flex h-11 items-center justify-center rounded-[18px] bg-[var(--secondary)] px-5 text-[15px] font-bold text-[var(--foreground)] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Retour aux dépenses
          </Link>
        </div>
      </div>
    );
  }

  if (etat.statut === "erreur") {
    return (
      <div className="min-h-[100dvh] bg-white">
        <EnTeteDepense titre="Modifier la dépense" />
        <div className="flex flex-col gap-3 px-5 pt-2">
          <p
            role="alert"
            className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
          >
            {etat.message}
          </p>
          <button
            type="button"
            onClick={recharger}
            className="h-12 w-full rounded-[18px] bg-[var(--primary)] text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (etat.statut === "attenteStatut") {
    return (
      <FormulaireDepense
        mode="modification"
        idDepense={etat.depense.id}
        valeurInitiale={valeurDepense(etat.depense)}
        chargementStatut
        onSessionExpiree={onSessionExpiree}
        onSucces={reussir}
        onConflit={recharger}
        onIntrouvable={() => setEtat({ statut: "introuvable" })}
      />
    );
  }

  return (
    <FormulaireDepense
      mode="modification"
      idDepense={etat.depense.id}
      valeurInitiale={valeurDepense(etat.depense)}
      lectureSeule={etat.lectureSeule}
      onSessionExpiree={onSessionExpiree}
      onSucces={reussir}
      onConflit={recharger}
      onIntrouvable={() => setEtat({ statut: "introuvable" })}
    />
  );
}
