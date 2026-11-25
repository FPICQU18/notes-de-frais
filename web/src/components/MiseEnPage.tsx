import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Check, Folder, Home, Plus, Receipt, User } from "lucide-react";

import { ApiError, apiGet, type NoteValidation, type UserRead } from "../api/client";
import { estRouteFormulaireDepense } from "../lib/routes";

type Props = {
  utilisateur: UserRead | null;
};

/**
 * Nombre de dossiers à traiter (`statut=soumise`) affiché en pastille sur
 * l'onglet Validation. Le compteur exclut les dossiers dont l'utilisateur
 * est propriétaire (ils ne peuvent pas être validés par lui-même) et la
 * pastille disparaît à zéro. Le compteur est rechargé à chaque navigation
 * (retour sur la liste après une décision, rechargement de l'appli).
 */
function useCompteurATraiter(
  utilisateur: UserRead | null,
  onSessionExpiree: () => void,
): number | null {
  const estValideur =
    utilisateur?.role === "valideur" || utilisateur?.role === "admin";
  const location = useLocation();
  const [compteur, setCompteur] = useState<number | null>(null);

  const charger = useCallback(() => {
    if (!estValideur || utilisateur === null) {
      setCompteur(null);
      return;
    }
    apiGet<NoteValidation[]>("/v1/validation/notes?statut=soumise")
      .then((notes) => {
        setCompteur(
          notes.filter((note) => note.proprietaire.id !== utilisateur.id).length,
        );
      })
      .catch((attrape: unknown) => {
        if (attrape instanceof ApiError && attrape.status === 401) {
          onSessionExpiree();
          return;
        }
        // En cas d'erreur, on ne touche pas au compteur courant : pas de
        // pastille fantôme, pas de régression affichée.
      });
  }, [estValideur, utilisateur, onSessionExpiree]);

  useEffect(() => {
    charger();
  }, [charger, location.key]);

  return compteur;
}

function PastilleCompteur({ compteur }: { compteur: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-extrabold leading-none text-[var(--accent-foreground)]"
    >
      {compteur}
    </span>
  );
}

function LienNavigation({
  vers,
  fin,
  etiquette,
  icone,
  pastille,
}: {
  vers: string;
  fin?: boolean;
  etiquette: string;
  icone: ReactNode;
  pastille?: number | null;
}) {
  const avecPastille = pastille !== undefined && pastille !== null && pastille > 0;
  return (
    <NavLink
      to={vers}
      end={fin}
      aria-label={
        avecPastille
          ? `${etiquette}, ${pastille} dossier${pastille > 1 ? "s" : ""} à traiter`
          : etiquette
      }
      className={({ isActive }) =>
        isActive
          ? "barre-navigation__lien barre-navigation__lien--actif"
          : "barre-navigation__lien"
      }
    >
      <span className="relative inline-flex items-center justify-center">
        {icone}
        {avecPastille && <PastilleCompteur compteur={pastille} />}
      </span>
    </NavLink>
  );
}

export function MiseEnPage({
  utilisateur,
  onSessionExpiree = () => {},
}: Props & { onSessionExpiree?: () => void }) {
  const estValideur =
    utilisateur?.role === "valideur" || utilisateur?.role === "admin";
  const compteur = useCompteurATraiter(utilisateur, onSessionExpiree);
  // Sur les écrans de formulaire (saisie / modification), la barre flottante
  // masquerait le bouton « Enregistrer » : on la retire du flux.
  const { pathname } = useLocation();
  const masquerBarre = estRouteFormulaireDepense(pathname);

  return (
    <div className="mise-en-page">
      <div className="mise-en-page__contenu">
        <Outlet />
      </div>
      {!masquerBarre && (
      <nav className="barre-navigation print:hidden" aria-label="Navigation principale">
        <LienNavigation
          vers="/"
          fin
          etiquette="Accueil"
          icone={<Home aria-hidden strokeWidth={2} />}
        />
        <LienNavigation
          vers="/depenses"
          etiquette="Dépenses"
          icone={<Receipt aria-hidden strokeWidth={2} />}
        />
        <div className="barre-navigation__plus">
          <NavLink
            to="/depenses/nouvelle"
            aria-label="Ajouter une dépense"
            className="barre-navigation__lien-plus"
          >
            <Plus aria-hidden strokeWidth={2} />
          </NavLink>
        </div>
        <LienNavigation
          vers="/dossiers"
          etiquette="Dossiers"
          icone={<Folder aria-hidden strokeWidth={2} />}
        />
        {estValideur ? (
          <LienNavigation
            vers="/validation"
            etiquette="Validation"
            icone={<Check aria-hidden strokeWidth={2} />}
            pastille={compteur}
          />
        ) : (
          <LienNavigation
            vers="/profil"
            etiquette="Profil"
            icone={<User aria-hidden strokeWidth={2} />}
          />
        )}
      </nav>
      )}
    </div>
  );
}
