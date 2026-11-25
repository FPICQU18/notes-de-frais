import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import type { UserRead } from "../api/client";
import { initiales } from "../lib/format";
import { ProfilPage } from "./ProfilPage";

const UTILISATEUR: UserRead = {
  id: 1,
  email: "camille@example.com",
  display_name: "Camille Martin",
  role: "utilisateur",
};

const VALIDEUR: UserRead = {
  id: 2,
  email: "valideur@example.com",
  display_name: "Victor Valideur",
  role: "valideur",
};

const ADMIN: UserRead = {
  id: 3,
  email: "admin@example.com",
  display_name: "Admin",
  role: "admin",
};

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

interface PropsRendu {
  utilisateur?: UserRead;
  onDeconnecte?: () => void;
}

function renderProfil(props: PropsRendu = {}) {
  return render(
    <MemoryRouter initialEntries={["/profil"]}>
      <Routes>
        <Route
          path="/profil"
          element={
            <ProfilPage
              utilisateur={props.utilisateur ?? UTILISATEUR}
              onDeconnecte={props.onDeconnecte ?? (() => {})}
            />
          }
        />
        <Route path="/admin/comptes" element={<div>Page comptes</div>} />
        <Route path="/connexion" element={<div>Écran de connexion</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Pastille de rôle : le seul `span.rounded-full` de la page. */
function pastilleRole(container: HTMLElement, libelle: string): HTMLElement {
  const pastille = container.querySelector("span.rounded-full");
  expect(pastille).not.toBeNull();
  expect(pastille).toHaveTextContent(libelle);
  return pastille as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

test.each([
  [UTILISATEUR, "Utilisateur"],
  [VALIDEUR, "Valideur"],
  [ADMIN, "Admin"],
])(
  "profil rendu pour le rôle %s : avatar, nom, e-mail, pastille « %s » et bouton « Se déconnecter »",
  async (utilisateur, libelleRole) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { container } = renderProfil({ utilisateur });

    const titre = await screen.findByRole("heading", { name: "Profil" });
    expect(titre).toHaveFocus();
    expect(titre).toHaveAttribute("tabindex", "-1");

    const attendu = utilisateur as UserRead;
    expect(
      screen.getByText((_, element) => element?.textContent === initiales(attendu.display_name)),
    ).toBeInTheDocument();
    // Nom affiché (paragraphe dédié, distinct de la pastille de rôle).
    const nom = container.querySelector("p.text-xl");
    expect(nom).toHaveTextContent(attendu.display_name);
    expect(screen.getByText(attendu.email)).toBeInTheDocument();
    pastilleRole(container, String(libelleRole));
    expect(
      screen.getByRole("button", { name: "Se déconnecter" }),
    ).toBeInTheDocument();

    // Aucun appel réseau au chargement de la page.
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test("bouton « Retour » présent en haut de la page Profil, au clic retour à la page précédente", async () => {
  const utilisateur = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/", "/profil"]} initialIndex={1}>
      <Routes>
        <Route path="/" element={<div>Page accueil</div>} />
        <Route
          path="/profil"
          element={
            <ProfilPage utilisateur={UTILISATEUR} onDeconnecte={() => {}} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

  const bouton = await screen.findByRole("button", { name: "Retour" });
  expect(bouton).toHaveTextContent("Retour");
  // Cible ≥ 44 px, focus visible.
  expect(bouton.className).toContain("h-11");
  expect(bouton.className).toContain("min-w-11");
  expect(bouton.className).toContain("focus-visible:outline-2");

  await utilisateur.click(bouton);
  expect(await screen.findByText("Page accueil")).toBeInTheDocument();
});

test("admin : le lien « Gérer les comptes » mène à /admin/comptes", async () => {
  renderProfil({ utilisateur: ADMIN });

  const lien = await screen.findByRole("link", { name: "Gérer les comptes" });
  expect(lien).toHaveAttribute("href", "/admin/comptes");
});

test.each([
  ["utilisateur", UTILISATEUR],
  ["valideur", VALIDEUR],
])("rôle %s : le lien « Gérer les comptes » est absent", async (_role, utilisateur) => {
  renderProfil({ utilisateur });

  await screen.findByRole("heading", { name: "Profil" });
  expect(screen.queryByRole("link", { name: "Gérer les comptes" })).not.toBeInTheDocument();
});

test("« Gérer les comptes » mène bien à /admin/comptes au clic", async () => {
  renderProfil({ utilisateur: ADMIN });
  const utilisateur = userEvent.setup();

  await utilisateur.click(await screen.findByRole("link", { name: "Gérer les comptes" }));

  expect(await screen.findByText("Page comptes")).toBeInTheDocument();
});

test("déconnexion : POST /v1/auth/logout appelé une seule fois puis onDeconnecte, même double clic", async () => {
  let resolveLogout!: (reponse: Response) => void;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((entree, init) => {
    const url = String(entree);
    if (url === "/api/v1/auth/logout" && init?.method === "POST") {
      return new Promise<Response>((resoudre) => {
        resolveLogout = resoudre;
      });
    }
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
  const onDeconnecte = vi.fn();
  const utilisateur = userEvent.setup();
  renderProfil({ onDeconnecte });

  const bouton = await screen.findByRole("button", { name: "Se déconnecter" });
  await utilisateur.click(bouton);

  // Pendant l'appel : bouton désactivé et aria-busy.
  expect(bouton).toBeDisabled();
  expect(bouton).toHaveAttribute("aria-busy", "true");
  expect(bouton).toHaveTextContent("Déconnexion…");
  expect(screen.getByRole("status")).toHaveTextContent("Fermeture de la session…");

  // Un second clic pendant l'appel ne relance rien (bouton désactivé).
  bouton.click();
  expect(bouton).toBeDisabled();

  resolveLogout(new Response(null, { status: 204 }));

  await waitFor(() => expect(onDeconnecte).toHaveBeenCalledTimes(1));
  const appelsLogout = fetchMock.mock.calls.filter(
    ([entree, init]) =>
      String(entree) === "/api/v1/auth/logout" && (init as RequestInit | undefined)?.method === "POST",
  );
  expect(appelsLogout).toHaveLength(1);
});

test("échec du POST logout : onDeconnecte est quand même appelé (retour à la connexion)", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation((entree, init) => {
    const url = String(entree);
    if (url === "/api/v1/auth/logout" && init?.method === "POST") {
      return Promise.resolve(jsonResponse({ detail: "Erreur interne" }, 500));
    }
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
  const onDeconnecte = vi.fn();
  const utilisateur = userEvent.setup();
  renderProfil({ onDeconnecte });

  await utilisateur.click(await screen.findByRole("button", { name: "Se déconnecter" }));

  await waitFor(() => expect(onDeconnecte).toHaveBeenCalledTimes(1));
});
