import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { ApiError, apiGet, type UserRead } from "./api/client";
import { MiseEnPage } from "./components/MiseEnPage";
import { ComptesPage } from "./pages/ComptesPage";
import { DepensesPage } from "./pages/DepensesPage";
import { DetailDepensePage } from "./pages/DetailDepensePage";
import { DossierDetailPage } from "./pages/DossierDetailPage";
import { DossiersPage } from "./pages/DossiersPage";
import { EcranErreur } from "./pages/EcranErreur";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NouvelleDepensePage } from "./pages/NouvelleDepensePage";
import { ProfilPage } from "./pages/ProfilPage";
import { ValidationDetailPage } from "./pages/ValidationDetailPage";
import { ValidationPage } from "./pages/ValidationPage";

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

  // L'état « connecte » n'est atteint qu'avec un utilisateur chargé ; on
  // resserre le type pour le reste du rendu.
  if (utilisateur === null) {
    return null;
  }

  const estValideur =
    utilisateur.role === "valideur" || utilisateur.role === "admin";

  return (
    <Routes>
      <Route element={<MiseEnPage utilisateur={utilisateur} />}>
        <Route
          path="/"
          element={
            <HomePage
              utilisateur={utilisateur}
              onDeconnecte={gererDeconnexion}
              onSessionExpiree={gererDeconnexion}
              focusTitre={focusTitre}
            />
          }
        />
        <Route
          path="/depenses"
          element={<DepensesPage onSessionExpiree={gererDeconnexion} />}
        />
        <Route
          path="/depenses/nouvelle"
          element={<NouvelleDepensePage onSessionExpiree={gererDeconnexion} />}
        />
        <Route
          path="/depenses/:id"
          element={<DetailDepensePage onSessionExpiree={gererDeconnexion} />}
        />
        <Route
          path="/dossiers"
          element={<DossiersPage onSessionExpiree={gererDeconnexion} />}
        />
        <Route
          path="/dossiers/:id"
          element={<DossierDetailPage onSessionExpiree={gererDeconnexion} />}
        />
        <Route
          path="/validation"
          element={
            estValideur ? (
              <ValidationPage
                utilisateur={utilisateur}
                onSessionExpiree={gererDeconnexion}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/validation/:id"
          element={
            estValideur ? (
              <ValidationDetailPage
                utilisateur={utilisateur}
                onSessionExpiree={gererDeconnexion}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/profil"
          element={<ProfilPage utilisateur={utilisateur} onDeconnecte={gererDeconnexion} />}
        />
        <Route
          path="/admin/comptes"
          element={
            utilisateur.role === "admin" ? (
              <ComptesPage
                utilisateur={utilisateur}
                onSessionExpiree={gererDeconnexion}
              />
            ) : (
              <Navigate to="/" replace />
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
