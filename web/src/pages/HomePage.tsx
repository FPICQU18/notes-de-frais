import { useCallback, useEffect, useRef, useState } from "react";

import { apiGet, apiPost, type UserRead } from "../api/client";

interface HomePageProps {
  utilisateur: UserRead | null;
  onDeconnecte: () => void;
  focusTitre: boolean;
}

export function HomePage({
  utilisateur: utilisateurInitial,
  onDeconnecte,
  focusTitre,
}: HomePageProps) {
  const [utilisateur, setUtilisateur] = useState<UserRead | null>(utilisateurInitial);
  const [echecChargement, setEchecChargement] = useState(false);
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);
  const [tentative, setTentative] = useState(0);
  const nomConnu = useRef(utilisateurInitial !== null);
  const refTitre = useRef<HTMLHeadingElement>(null);
  const aFocalise = useRef(false);

  useEffect(() => {
    let actif = true;
    apiGet<UserRead>("/v1/auth/me")
      .then((utilisateurCharge) => {
        if (!actif) return;
        setUtilisateur(utilisateurCharge);
        nomConnu.current = true;
      })
      .catch(() => {
        if (!actif) return;
        // Rafraîchissement silencieux : un nom déjà connu reste affiché.
        if (!nomConnu.current) {
          setEchecChargement(true);
        }
      });
    return () => {
      actif = false;
    };
  }, [tentative]);

  const reessayer = useCallback(() => {
    setEchecChargement(false);
    setTentative((valeur) => valeur + 1);
  }, []);

  useEffect(() => {
    if (focusTitre && !aFocalise.current && utilisateur !== null && refTitre.current) {
      refTitre.current.focus();
      aFocalise.current = true;
    }
  }, [focusTitre, utilisateur]);

  async function deconnecter() {
    if (deconnexionEnCours) return;
    setDeconnexionEnCours(true);
    try {
      await apiPost<void>("/v1/auth/logout");
    } catch {
      // L'échec de la déconnexion ne bloque pas le retour à l'écran de connexion.
    } finally {
      onDeconnecte();
    }
  }

  return (
    <main className="ecran ecran--accueil" aria-busy={utilisateur === null || undefined}>
      <header className="barre">
        <p className="marque">Notes de frais</p>
        <button
          type="button"
          className="bouton bouton--discret"
          onClick={deconnecter}
          disabled={deconnexionEnCours}
          aria-busy={deconnexionEnCours}
        >
          Se déconnecter
        </button>
      </header>
      {utilisateur !== null ? (
        <h1 className="titre" tabIndex={-1} ref={refTitre}>
          Bonjour {utilisateur.display_name}
        </h1>
      ) : echecChargement ? (
        <div className="actions">
          <p className="alerte" role="alert" aria-live="polite">
            Serveur injoignable. Vérifiez votre connexion.
          </p>
          <button type="button" className="bouton bouton--primaire" onClick={reessayer}>
            Réessayer
          </button>
        </div>
      ) : (
        <p className="chargement chargement--accueil">Chargement…</p>
      )}
    </main>
  );
}
