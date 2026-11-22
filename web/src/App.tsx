import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet, type UserRead } from "./api/client";
import { EcranErreur } from "./pages/EcranErreur";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";

type Etat = "chargement" | "anonyme" | "connecte" | "erreur";

export default function App() {
  const [etat, setEtat] = useState<Etat>("chargement");
  const [utilisateur, setUtilisateur] = useState<UserRead | null>(null);
  const [messageErreur, setMessageErreur] = useState("");
  const [focusTitre, setFocusTitre] = useState(false);
  const [verification, setVerification] = useState(0);

  useEffect(() => {
    let actif = true;
    apiGet<UserRead>("/v1/auth/me")
      .then((utilisateurCharge) => {
        if (!actif) return;
        setUtilisateur(utilisateurCharge);
        setEtat("connecte");
      })
      .catch((erreur: unknown) => {
        if (!actif) return;
        if (erreur instanceof ApiError && erreur.status === 401) {
          setEtat("anonyme");
        } else {
          setMessageErreur(
            erreur instanceof ApiError ? erreur.message : "Une erreur est survenue.",
          );
          setEtat("erreur");
        }
      });
    return () => {
      actif = false;
    };
  }, [verification]);

  const reessayer = useCallback(() => {
    setEtat("chargement");
    setFocusTitre(false);
    setVerification((valeur) => valeur + 1);
  }, []);

  const gererConnexion = useCallback((utilisateurConnecte: UserRead) => {
    setUtilisateur(utilisateurConnecte);
    setFocusTitre(true);
    setEtat("connecte");
  }, []);

  const gererDeconnexion = useCallback(() => {
    setUtilisateur(null);
    setFocusTitre(true);
    setEtat("anonyme");
  }, []);

  if (etat === "chargement") {
    return (
      <main className="ecran ecran--centre" aria-busy="true">
        <p className="chargement">Chargement…</p>
      </main>
    );
  }

  if (etat === "erreur") {
    return <EcranErreur message={messageErreur} onReessayer={reessayer} />;
  }

  if (etat === "anonyme") {
    return <LoginPage onConnecte={gererConnexion} focusTitre={focusTitre} />;
  }

  return (
    <HomePage
      utilisateur={utilisateur}
      onDeconnecte={gererDeconnexion}
      focusTitre={focusTitre}
    />
  );
}
