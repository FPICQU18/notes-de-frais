import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, LogOut, Users } from "lucide-react";

import { apiPost, type UserRead } from "../api/client";
import { initiales } from "../lib/format";

const LIBELLES_ROLE: Record<string, string> = {
  utilisateur: "Utilisateur",
  valideur: "Valideur",
  admin: "Admin",
};

type Props = {
  utilisateur: UserRead;
  onDeconnecte: () => void;
};

/**
 * Page Profil : avatar à initiales, nom, e-mail, rôle en pastille, lien
 * « Gérer les comptes » (admin seul) et déconnexion. Aucun appel réseau au
 * chargement : `utilisateur` vient de `GET /v1/auth/me` (AppRoutes).
 */
export function ProfilPage({ utilisateur, onDeconnecte }: Props) {
  const refTitre = useRef<HTMLHeadingElement>(null);
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

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

  const libelleRole = LIBELLES_ROLE[utilisateur.role] ?? utilisateur.role;
  const estAdmin = utilisateur.role === "admin";

  return (
    <main className="mx-auto w-full max-w-[560px] px-5 pb-28 pt-6">
      <h1
        ref={refTitre}
        tabIndex={-1}
        className="m-0 text-2xl font-extrabold tracking-[-0.01em] focus:outline-none"
      >
        Profil
      </h1>

      <section
        aria-label="Vos informations"
        className="mt-5 rounded-[24px] bg-[var(--card)] p-[26px_20px] text-center shadow-[var(--ombre-carte)]"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-[72px] w-[72px] items-center justify-center rounded-[24px] bg-[var(--accent)] text-2xl font-extrabold text-[var(--accent-foreground)]"
        >
          {initiales(utilisateur.display_name)}
        </span>
        <p className="mb-1 mt-[14px] text-xl font-extrabold">{utilisateur.display_name}</p>
        <p className="m-0 text-sm text-[var(--muted-foreground)]">{utilisateur.email}</p>
        <p className="mb-0 mt-3">
          <span className="inline-flex h-7 items-center whitespace-nowrap rounded-full bg-[var(--accent)] px-3 text-xs font-bold text-[var(--accent-foreground)]">
            {libelleRole}
          </span>
        </p>
      </section>

      {estAdmin && (
        <>
          <h2 className="mb-2 mt-6 text-[13px] font-bold text-[var(--muted-foreground)]">
            Administration
          </h2>
          <Link
            to="/admin/comptes"
            className="flex min-h-[56px] items-center gap-3 rounded-[20px] bg-[var(--card)] px-4 text-[15px] font-bold text-inherit no-underline shadow-[var(--ombre-carte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            <Users
              aria-hidden="true"
              strokeWidth={2}
              className="h-5 w-5 shrink-0 text-[var(--accent-foreground)]"
            />
            <span className="flex-1">Gérer les comptes</span>
            <ChevronRight
              aria-hidden="true"
              strokeWidth={2}
              className="h-[18px] w-[18px] shrink-0 text-[var(--muted-foreground)]"
            />
          </Link>
        </>
      )}

      {!estAdmin && (
        <p className="mb-0 mt-4 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
          Votre compte est créé et géré par un administrateur.
        </p>
      )}

      <button
        type="button"
        onClick={deconnecter}
        disabled={deconnexionEnCours}
        aria-busy={deconnexionEnCours}
        className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--card)] text-[15px] font-bold text-[var(--foreground)] shadow-[var(--ombre-carte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)]"
      >
        <LogOut aria-hidden="true" strokeWidth={2} className="h-5 w-5" />
        {deconnexionEnCours ? "Déconnexion…" : "Se déconnecter"}
      </button>
      {deconnexionEnCours && (
        <p role="status" className="mb-0 mt-[10px] text-center text-[13px] text-[var(--muted-foreground)]">
          Fermeture de la session…
        </p>
      )}
    </main>
  );
}
