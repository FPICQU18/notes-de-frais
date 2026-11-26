import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Check, Folder, Home, Plus, Receipt, User } from "lucide-react";

import { ApiError, apiGet, type NoteValidation, type UserRead } from "../api/client";
import { useBureau } from "../lib/useMediaQuery";
import { estRouteFormulaireDepense } from "../lib/routes";

type Props = {
  utilisateur: UserRead | null;
};

/**
 * Nombre de dossiers à traiter (`statut=soumise`) affiché en pastille sur
 * l'onglet Validation. Comme la page Validation, on exclut les dossiers dont
 * l'utilisateur est propriétaire (il ne peut pas se valider lui-même) et la
 * pastille disparaît à zéro. Le compteur est rechargé à chaque navigation,
 * quand l'appli redevient visible (`visibilitychange`) et toutes les 60 s
 * tant qu'elle est au premier plan (US-040) : retour sur la liste après une
 * décision, rechargement de l'appli, soumission par un collègue pendant que
 * l'onglet était en arrière-plan.
 * `null` = aucune pastille (rôle `utilisateur` ou chargement en cours).
 */
const INTERVALLE_RAFRAICHISSEMENT_MS = 60_000;

function useCompteurATraiter(
  utilisateur: UserRead | null,
  onSessionExpiree: () => void,
): number | null {
  const estValideur =
    utilisateur?.role === "valideur" || utilisateur?.role === "admin";
  const location = useLocation();
  const [compteur, setCompteur] = useState<number | null>(null);

  const chargerCompteur = useCallback(() => {
    if (!estValideur || utilisateur === null) return;
    let actif = true;
    apiGet<NoteValidation[]>("/v1/validation/notes?statut=soumise")
      .then((notes) => {
        if (!actif) return;
        setCompteur(
          notes.filter((note) => note.proprietaire.id !== utilisateur.id).length,
        );
      })
      .catch((attrape: unknown) => {
        if (!actif) return;
        if (attrape instanceof ApiError && attrape.status === 401) {
          onSessionExpiree();
          return;
        }
        // Autre erreur : on garde le compteur courant (pas de pastille fantôme).
      });
    return () => {
      actif = false;
    };
  }, [estValideur, utilisateur, onSessionExpiree]);

  useEffect(() => {
    if (!estValideur) return;
    // (a) rechargement à chaque navigation.
    const nettoyerNavigation = chargerCompteur();
    // (b) rechargement quand l'appli redevient visible.
    const auChangementVisibilite = () => {
      if (document.visibilityState === "visible") chargerCompteur();
    };
    document.addEventListener("visibilitychange", auChangementVisibilite);
    // (c) rafraîchissement périodique tant que l'onglet est au premier plan.
    const intervalle = setInterval(() => {
      if (document.visibilityState === "visible") chargerCompteur();
    }, INTERVALLE_RAFRAICHISSEMENT_MS);
    return () => {
      nettoyerNavigation?.();
      document.removeEventListener("visibilitychange", auChangementVisibilite);
      clearInterval(intervalle);
    };
  }, [estValideur, chargerCompteur, location.key]);

  if (!estValideur) return null;
  return compteur;
}

/** Pastille de compteur, purement visuelle : lue via l'aria-label du lien. */
function PastilleCompteur({ compteur }: { compteur: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute -top-1.5 -right-2 flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[11px] font-extrabold leading-none text-[var(--primary-foreground)]"
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
  variante,
}: {
  vers: string;
  fin?: boolean;
  etiquette: string;
  icone: ReactNode;
  pastille?: number | null;
  /** Classe de base du lien : `barre-navigation__lien` (mobile) ou `barre-laterale__lien` (bureau). */
  variante: "barre-navigation__lien" | "barre-laterale__lien";
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
          ? `${variante} ${variante}--actif`
          : variante
      }
    >
      <span className="relative inline-flex items-center justify-center">
        {icone}
        {avecPastille && <PastilleCompteur compteur={pastille} />}
      </span>
      <span className="barre-laterale__texte">{etiquette}</span>
    </NavLink>
  );
}

/** Entrées de navigation communes à la barre mobile et à la barre latérale. */
function entreesNavigation(
  estValideur: boolean,
  compteur: number | null,
): {
  vers: string;
  fin?: boolean;
  etiquette: string;
  icone: ReactNode;
  pastille?: number | null;
}[] {
  return [
    { vers: "/", fin: true, etiquette: "Accueil", icone: <Home aria-hidden strokeWidth={2} /> },
    { vers: "/depenses", etiquette: "Dépenses", icone: <Receipt aria-hidden strokeWidth={2} /> },
    { vers: "/dossiers", etiquette: "Dossiers", icone: <Folder aria-hidden strokeWidth={2} /> },
    estValideur
      ? {
          vers: "/validation",
          etiquette: "Validation",
          icone: <Check aria-hidden strokeWidth={2} />,
          pastille: compteur,
        }
      : { vers: "/profil", etiquette: "Profil", icone: <User aria-hidden strokeWidth={2} /> },
  ];
}

/** Barre latérale fixe (≥ 1024 px, US-042) : mêmes entrées que la barre mobile. */
function BarreLaterale({
  estValideur,
  compteur,
}: {
  estValideur: boolean;
  compteur: number | null;
}) {
  const entrees = entreesNavigation(estValideur, compteur);
  return (
    <nav
      className="barre-laterale print:hidden"
      aria-label="Navigation principale"
    >
      <NavLink
        to="/depenses/nouvelle"
        aria-label="Nouvelle dépense"
        className="barre-laterale__lien-plus"
      >
        <Plus aria-hidden strokeWidth={2.4} />
        <span className="barre-laterale__texte">Nouvelle dépense</span>
      </NavLink>
      {entrees.map((entree) => (
        <LienNavigation
          key={entree.vers}
          vers={entree.vers}
          fin={entree.fin}
          etiquette={entree.etiquette}
          icone={entree.icone}
          pastille={entree.pastille}
          variante="barre-laterale__lien"
        />
      ))}
    </nav>
  );
}

export function MiseEnPage({
  utilisateur,
  onSessionExpiree = () => {},
}: Props & { onSessionExpiree?: () => void }) {
  const estValideur =
    utilisateur?.role === "valideur" || utilisateur?.role === "admin";
  const compteur = useCompteurATraiter(utilisateur, onSessionExpiree);
  // À partir de 1024 px, la barre latérale fixe remplace la barre flottante :
  // elle ne chevauche plus le bouton « Enregistrer », donc on la garde même
  // sur les formulaires de dépense. En dessous, comportement inchangé.
  const bureau = useBureau();
  const { pathname } = useLocation();
  const masquerBarre = !bureau && estRouteFormulaireDepense(pathname);

  const entrees = entreesNavigation(estValideur, compteur);

  return (
    <div className="mise-en-page">
      {bureau && <BarreLaterale estValideur={estValideur} compteur={compteur} />}
      <div className="mise-en-page__contenu">
        <Outlet />
      </div>
      {!bureau && !masquerBarre && (
      <nav className="barre-navigation print:hidden" aria-label="Navigation principale">
        {entrees.slice(0, 2).map((entree) => (
          <LienNavigation
            key={entree.vers}
            vers={entree.vers}
            fin={entree.fin}
            etiquette={entree.etiquette}
            icone={entree.icone}
            pastille={entree.pastille}
            variante="barre-navigation__lien"
          />
        ))}
        <div className="barre-navigation__plus">
          <NavLink
            to="/depenses/nouvelle"
            aria-label="Ajouter une dépense"
            className="barre-navigation__lien-plus"
          >
            <Plus aria-hidden strokeWidth={2} />
          </NavLink>
        </div>
        {entrees.slice(2).map((entree) => (
          <LienNavigation
            key={entree.vers}
            vers={entree.vers}
            fin={entree.fin}
            etiquette={entree.etiquette}
            icone={entree.icone}
            pastille={entree.pastille}
            variante="barre-navigation__lien"
          />
        ))}
      </nav>
      )}
    </div>
  );
}
