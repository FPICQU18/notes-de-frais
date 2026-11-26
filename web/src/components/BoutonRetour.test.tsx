import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { BoutonRetour } from "./BoutonRetour";

function PageDestination({ libelle }: { libelle: string }) {
  const location = useLocation();
  return (
    <div>
      {libelle} — {location.pathname}
    </div>
  );
}

function renderBouton(
  props: { libelleAria?: string; urlInitiale?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={["/accueil", "/profil"]} initialIndex={1}>
      <Routes>
        <Route path="/accueil" element={<PageDestination libelle="Page accueil" />} />
        <Route
          path="/profil"
          element={
            <div>
              <BoutonRetour libelleAria={props.libelleAria} />
              <PageDestination libelle="Page profil" />
            </div>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("bouton « Retour » présent avec icône ArrowLeft et libellé, cible ≥ 44 px, focus visible", () => {
  renderBouton();

  const bouton = screen.getByRole("button", { name: "Retour" });
  expect(bouton).toBeInTheDocument();
  expect(bouton).toHaveTextContent("Retour");
  // Cible tactile ≥ 44 px et anneau de focus explicite.
  expect(bouton.className).toContain("h-11");
  expect(bouton.className).toContain("min-w-11");
  expect(bouton.className).toContain("focus-visible:outline-2");
  // Icône décorative masquée aux lecteurs d'écran.
  expect(bouton.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

test("libellé accessible personnalisable (page Comptes)", () => {
  renderBouton({ libelleAria: "Retour au profil" });

  expect(screen.getByRole("button", { name: "Retour au profil" })).toBeInTheDocument();
});

test("au clic, retour à la page précédente de l'historique", async () => {
  const utilisateur = userEvent.setup();
  renderBouton();

  expect(screen.getByText(/Page profil — \/profil/)).toBeInTheDocument();

  await utilisateur.click(screen.getByRole("button", { name: "Retour" }));

  expect(await screen.findByText(/Page accueil — \/accueil/)).toBeInTheDocument();
});
