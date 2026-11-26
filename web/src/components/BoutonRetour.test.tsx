import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { BoutonRetour } from "./BoutonRetour";

const { navigateEspion } = vi.hoisted(() => ({ navigateEspion: vi.fn() }));

// useNavigate est remplacé par un espion qui délègue à la vraie fonction :
// on vérifie l'argument passé (navigate("/") vs navigate(-1)) tout en
// conservant la navigation réelle du MemoryRouter.
vi.mock("react-router", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router")>();
  return {
    ...mod,
    useNavigate: () => {
      const navigateReel = mod.useNavigate();
      return ((...args: Parameters<typeof navigateReel>) => {
        navigateEspion(...args);
        return navigateReel(...args);
      }) as typeof navigateReel;
    },
  };
});

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
        <Route path="/" element={<PageDestination libelle="Page racine" />} />
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
  navigateEspion.mockClear();
  window.history.replaceState(null, "");
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

test("au clic avec une page précédente dans l'appli (idx > 0), retour à la page précédente (navigate(-1))", async () => {
  window.history.replaceState({ idx: 1 }, "");
  const utilisateur = userEvent.setup();
  renderBouton();

  expect(screen.getByText(/Page profil — \/profil/)).toBeInTheDocument();

  await utilisateur.click(screen.getByRole("button", { name: "Retour" }));

  expect(navigateEspion).toHaveBeenCalledWith(-1);
  expect(navigateEspion).not.toHaveBeenCalledWith("/");
  expect(await screen.findByText(/Page accueil — \/accueil/)).toBeInTheDocument();
});

test("ouverture directe ou rechargement (history.state.idx === 0) : le clic navigue vers / (accueil)", async () => {
  window.history.replaceState({ idx: 0 }, "");
  const utilisateur = userEvent.setup();
  renderBouton();

  await utilisateur.click(screen.getByRole("button", { name: "Retour" }));

  expect(navigateEspion).toHaveBeenCalledWith("/");
  expect(navigateEspion).not.toHaveBeenCalledWith(-1);
  expect(await screen.findByText(/^Page racine — \/$/)).toBeInTheDocument();
});

test("history.state absent (null) : le clic navigue vers / (accueil)", async () => {
  window.history.replaceState(null, "");
  const utilisateur = userEvent.setup();
  renderBouton();

  await utilisateur.click(screen.getByRole("button", { name: "Retour" }));

  expect(navigateEspion).toHaveBeenCalledWith("/");
  expect(await screen.findByText(/^Page racine — \/$/)).toBeInTheDocument();
});

test("history.state sans idx (cas défensif) : le clic navigue vers / (accueil)", async () => {
  window.history.replaceState({ autreCle: "valeur" }, "");
  const utilisateur = userEvent.setup();
  renderBouton();

  await utilisateur.click(screen.getByRole("button", { name: "Retour" }));

  expect(navigateEspion).toHaveBeenCalledWith("/");
  expect(await screen.findByText(/^Page racine — \/$/)).toBeInTheDocument();
});
