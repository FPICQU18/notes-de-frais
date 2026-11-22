import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { ApiError, apiGet, type UserRead } from "./api/client";
import { MiseEnPage } from "./components/MiseEnPage";
import { PageBientotDisponible } from "./components/PageBientotDisponible";
import { EcranErreur } from "./pages/EcranErreur";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";

type Etat = "chargement" | "anonyme" | "connecte" | "erreur";

export function AppRoutes() {
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
    return (
      <Routes>
        <Route
          path="/connexion"
          element={<LoginPage onConnecte={gererConnexion} focusTitre={focusTitre} />}
        />
        <Route path="*" element={<Navigate to="/connexion" replace />} />
      </Routes>
    );
  }

  const estValideur =
    utilisateur?.role === "valideur" || utilisateur?.role === "admin";

  return (
    <Routes>
      <Route element={<MiseEnPage utilisateur={utilisateur} />}>
        <Route
          path="/"
          element={
            <HomePage
              utilisateur={utilisateur}
              onDeconnecte={gererDeconnexion}
              focusTitre={focusTitre}
            />
          }
        />
        <Route
          path="/depenses"
          element={<PageBientotDisponible titre="Dépenses" />}
        />
        <Route
          path="/depenses/nouvelle"
          element={<PageBientotDisponible titre="Saisie d'un ticket" />}
        />
        <Route path="/dossiers" element={<PageBientotDisponible titre="Dossiers" />} />
        <Route
          path="/validation"
          element={
            estValideur ? (
              <PageBientotDisponible titre="Validation" />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/profil"
          element={
            estValideur ? (
              <Navigate to="/" replace />
            ) : (
              <PageBientotDisponible titre="Profil" />
            )
          }
        />
        <Route path="/connexion" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
