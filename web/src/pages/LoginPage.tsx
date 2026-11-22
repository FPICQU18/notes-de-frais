import { useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError, apiPost, type UserRead } from "../api/client";

interface LoginPageProps {
  onConnecte: (utilisateur: UserRead) => void;
  focusTitre: boolean;
}

export function LoginPage({ onConnecte, focusTitre }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const refTitre = useRef<HTMLHeadingElement>(null);
  const refErreur = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (focusTitre) {
      refTitre.current?.focus();
    }
  }, [focusTitre]);

  useEffect(() => {
    if (erreur !== null) {
      refErreur.current?.focus();
    }
  }, [erreur]);

  async function gererSoumission(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (envoiEnCours) return;
    setEnvoiEnCours(true);
    setErreur(null);
    try {
      const utilisateur = await apiPost<UserRead>("/v1/auth/login", {
        email,
        password: motDePasse,
      });
      onConnecte(utilisateur);
    } catch (erreurAttrapee: unknown) {
      setErreur(
        erreurAttrapee instanceof ApiError
          ? erreurAttrapee.message
          : "Une erreur est survenue.",
      );
      setEnvoiEnCours(false);
    }
  }

  return (
    <main className="ecran ecran--connexion">
      <p className="marque">Notes de frais</p>
      <h1 className="titre" tabIndex={-1} ref={refTitre}>
        Connexion
      </h1>
      <p className="intro">Connectez-vous pour accéder à vos notes de frais.</p>
      {erreur !== null && (
        <p
          className="alerte"
          role="alert"
          aria-live="polite"
          id="erreur-connexion"
          tabIndex={-1}
          ref={refErreur}
        >
          {erreur}
        </p>
      )}
      <form className="formulaire" onSubmit={gererSoumission} noValidate>
        <div className="champ">
          <label htmlFor="email">Adresse e-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={erreur !== null ? true : undefined}
            aria-describedby={erreur !== null ? "erreur-connexion" : undefined}
          />
        </div>
        <div className="champ">
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            aria-invalid={erreur !== null ? true : undefined}
            aria-describedby={erreur !== null ? "erreur-connexion" : undefined}
          />
        </div>
        <button
          type="submit"
          className="bouton bouton--primaire"
          disabled={envoiEnCours}
          aria-busy={envoiEnCours}
        >
          {envoiEnCours ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </main>
  );
}
