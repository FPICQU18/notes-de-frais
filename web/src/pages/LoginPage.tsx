import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";

import { ApiError, apiPost, type UserRead } from "../api/client";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

interface LoginPageProps {
  onConnecte: (utilisateur: UserRead) => void;
  focusTitre: boolean;
}

export function LoginPage({ onConnecte, focusTitre }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);
  // Champ visé par l'erreur : « password » si le détail 422 le désigne,
  // « email » si le détail 422 désigne l'e-mail, `null` sinon (focus sur l'alerte).
  const [champEnErreur, setChampEnErreur] = useState<"email" | "password" | null>(null);
  const refTitre = useRef<HTMLHeadingElement>(null);
  const refErreur = useRef<HTMLParagraphElement>(null);
  const refEmail = useRef<HTMLInputElement>(null);
  const refMotDePasse = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusTitre) {
      refTitre.current?.focus();
    }
  }, [focusTitre]);

  useEffect(() => {
    if (erreur === null) return;
    // Focus sur le champ concerné quand l'erreur le désigne précisément
    // (détail 422 avec loc), sinon sur l'alerte elle-même.
    if (champEnErreur === "password") {
      refMotDePasse.current?.focus();
    } else if (champEnErreur === "email") {
      refEmail.current?.focus();
    } else {
      refErreur.current?.focus();
    }
  }, [erreur, champEnErreur]);

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
      let champ: "email" | "password" | null = null;
      if (erreurAttrapee instanceof ApiError) {
        setErreur(erreurAttrapee.message);
        const detail = erreurAttrapee.detail;
        if (Array.isArray(detail)) {
          const dernier = detail[detail.length - 1] as { loc?: unknown } | undefined;
          const loc = dernier !== null && dernier !== undefined ? dernier.loc : undefined;
          if (Array.isArray(loc)) {
            const nom = loc[loc.length - 1];
            if (nom === "password") champ = "password";
            else if (nom === "email") champ = "email";
          }
        }
      } else {
        setErreur("Une erreur est survenue.");
      }
      setChampEnErreur(champ);
      setEnvoiEnCours(false);
    }
  }

  return (
    <main className="flex min-h-svh w-full flex-col items-center justify-center px-5 py-8">
      <Card
        className="carte-connexion w-full max-w-sm gap-6 rounded-[28px] border-0 bg-white px-6 py-8 shadow-[0_6px_18px_rgba(40,30,120,0.06)]"
        data-testid="carte-connexion"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[#5B3DF5] text-white"
          >
            <LogIn aria-hidden strokeWidth={2} size={28} />
          </span>
          <h1 ref={refTitre} tabIndex={-1} className="text-2xl font-semibold text-[var(--foreground)] focus:outline-none">
            Notes de frais
          </h1>
          <p className="-mt-2 text-sm text-[var(--muted-foreground)]">
            Connectez-vous pour accéder à vos notes de frais.
          </p>
        </div>
        <form className="flex flex-col gap-4" onSubmit={gererSoumission} noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email" className="text-[13px] font-bold">
              Adresse e-mail
            </Label>
            <Input
              ref={refEmail}
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="prenom@exemple.fr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={erreur !== null ? true : undefined}
              aria-describedby={erreur !== null ? "erreur-connexion" : undefined}
              className="h-[52px] w-full rounded-[18px] border-0 bg-[var(--secondary)] px-4 text-[15px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] aria-invalid:outline-2 aria-invalid:outline-[var(--erreur-texte)]"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password" className="text-[13px] font-bold">
              Mot de passe
            </Label>
            <div className="relative">
              <Input
                ref={refMotDePasse}
                id="password"
                name="password"
                type={motDePasseVisible ? "text" : "password"}
                autoComplete="current-password"
                inputMode="numeric"
                placeholder="Votre mot de passe"
                required
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
                aria-invalid={erreur !== null ? true : undefined}
                aria-describedby={erreur !== null ? "erreur-connexion" : undefined}
                className="h-[52px] w-full rounded-[18px] border-0 bg-[var(--secondary)] px-4 pr-12 text-[15px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] aria-invalid:outline-2 aria-invalid:outline-[var(--erreur-texte)]"
              />
              <button
                type="button"
                onClick={() => setMotDePasseVisible((v) => !v)}
                aria-label={
                  motDePasseVisible
                    ? "Masquer le mot de passe"
                    : "Afficher le mot de passe"
                }
                aria-pressed={motDePasseVisible}
                className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-[14px] text-[var(--muted-foreground)] hover:bg-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                {motDePasseVisible ? (
                  <EyeOff aria-hidden strokeWidth={2} size={20} />
                ) : (
                  <Eye aria-hidden strokeWidth={2} size={20} />
                )}
              </button>
            </div>
          </div>
          <Button
            type="submit"
            className="h-14 w-full rounded-[18px] text-base font-bold"
            disabled={envoiEnCours}
            aria-busy={envoiEnCours}
          >
            {envoiEnCours ? "Connexion…" : "Se connecter"}
          </Button>
        </form>
        {erreur !== null && (
          <p
            className="-mt-2 rounded-[16px] bg-[var(--erreur-fond)] px-4 py-3 text-sm text-[var(--erreur-texte)] focus:outline-2 focus:outline-[var(--erreur-texte)]"
            role="alert"
            aria-live="polite"
            id="erreur-connexion"
            tabIndex={-1}
            ref={refErreur}
          >
            {erreur}
          </p>
        )}
      </Card>
    </main>
  );
}
