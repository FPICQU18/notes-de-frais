import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { Check, Folder, Home, Plus, Receipt, User } from "lucide-react";

import type { UserRead } from "../api/client";

type Props = {
  utilisateur: UserRead | null;
};

function LienNavigation({
  vers,
  fin,
  etiquette,
  icone,
}: {
  vers: string;
  fin?: boolean;
  etiquette: string;
  icone: ReactNode;
}) {
  return (
    <NavLink
      to={vers}
      end={fin}
      aria-label={etiquette}
      className={({ isActive }) =>
        isActive
          ? "barre-navigation__lien barre-navigation__lien--actif"
          : "barre-navigation__lien"
      }
    >
      {icone}
    </NavLink>
  );
}

export function MiseEnPage({ utilisateur }: Props) {
  const estValideur =
    utilisateur?.role === "valideur" || utilisateur?.role === "admin";

  return (
    <div className="mise-en-page">
      <div className="mise-en-page__contenu">
        <Outlet />
      </div>
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
          />
        ) : (
          <LienNavigation
            vers="/profil"
            etiquette="Profil"
            icone={<User aria-hidden strokeWidth={2} />}
          />
        )}
      </nav>
    </div>
  );
}
