import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Link, Route, Routes } from "react-router";

import type { NoteValidation, UserRead } from "../api/client";
import { MiseEnPage } from "./MiseEnPage";

const UTILISATEUR: UserRead = {
  id: 1,
  email: "camille@example.com",
  display_name: "Camille",
  role: "utilisateur",
};

const VALIDEUR: UserRead = {
  id: 2,
  email: "valideur@example.com",
  display_name: "Victor",
  role: "valideur",
};

const ADMIN: UserRead = {
  id: 3,
  email: "admin@example.com",
  display_name: "Alice",
  role: "admin",
};

function note(id: number, proprietaireId: number): NoteValidation {
  return {
    id,
    libelle: `Dossier ${id}`,
    statut: "soumise",
    total_centimes: 1000,
    nb_depenses: 1,
    soumise_at: "2026-11-20T10:00:00Z",
    proprietaire: { id: proprietaireId, display_name: `Proprio ${proprietaireId}` },
  };
}

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * fetch simulé : seule la file de validation est servie, avec une liste
 * mutable (`notesCourantes`) pour simuler une décision entre deux navigation.
 */
function mockValidation(notesInitiales: NoteValidation[]) {
  const notesCourantes = { liste: notesInitiales };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((entree, init) => {
    const url = String(entree);
    const methode = init?.method ?? "GET";
    if (url === "/api/v1/validation/notes?statut=soumise" && methode === "GET") {
      return Promise.resolve(jsonResponse(notesCourantes.liste));
    }
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
  return { fetchMock, notesCourantes };
}

function renderMiseEnPage(
  utilisateur: UserRead,
  props: { onSessionExpiree?: () => void; url?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={[props.url ?? "/"]}>
      <Routes>
        <Route
          element={
            <MiseEnPage
              utilisateur={utilisateur}
              onSessionExpiree={props.onSessionExpiree ?? (() => {})}
            />
          }
        >
          <Route path="/" element={<div>Page accueil</div>} />
          <Route
            path="/validation"
            element={
              <div>
                Page validation <Link to="/validation/5">Détail 5</Link>
              </div>
            }
          />
          <Route
            path="/validation/:id"
            element={
              <div>
                Détail <Link to="/validation">Retour à la liste</Link>
              </div>
            }
          />
          <Route path="/profil" element={<div>Page profil</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("valideur : pastille avec le nombre de dossiers à traiter, hors dossiers dont il est propriétaire", async () => {
  const { fetchMock } = mockValidation([note(1, 1), note(2, 2), note(3, 1)]);
  renderMiseEnPage(VALIDEUR);

  const lien = await screen.findByRole("link", { name: "Validation, 2 dossiers à traiter" });
  expect(within(lien).getByText("2")).toBeInTheDocument();
  // La pastille est purement visuelle : masquée aux lecteurs d'écran.
  expect(within(lien).getByText("2")).toHaveAttribute("aria-hidden", "true");
  // Le lien garde la classe de la barre (hauteur 52 px ≥ 44 px, focus visible en CSS).
  expect(lien.className).toContain("barre-navigation__lien");
  // Un seul appel à la file « soumise » au chargement.
  const appels = fetchMock.mock.calls.filter(([entree]) =>
    String(entree).includes("/api/v1/validation/notes?statut=soumise"),
  );
  expect(appels).toHaveLength(1);
});

test("admin : pastille au singulier pour 1 dossier à traiter", async () => {
  mockValidation([note(1, 1)]);
  renderMiseEnPage(ADMIN);

  const lien = await screen.findByRole("link", { name: "Validation, 1 dossier à traiter" });
  expect(within(lien).getByText("1")).toBeInTheDocument();
});

test("liste vide : aucune pastille (rien ne s'affiche à zéro)", async () => {
  mockValidation([]);
  renderMiseEnPage(VALIDEUR);

  const lien = await screen.findByRole("link", { name: "Validation" });
  expect(within(lien).queryByText(/^\d+$/)).not.toBeInTheDocument();
});

test("rôle utilisateur : aucun appel à l'API de validation, aucune pastille, onglet Profil à la place", async () => {
  const { fetchMock } = mockValidation([note(1, 2)]);
  renderMiseEnPage(UTILISATEUR);

  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  expect(within(nav).getByRole("link", { name: "Profil" })).toBeInTheDocument();
  expect(within(nav).queryByRole("link", { name: /^Validation/ })).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([entree]) => String(entree).includes("/api/v1/validation/notes")),
  ).toHaveLength(0);
});

test("décision prise depuis le détail : au retour sur la liste, la pastille est rafraîchie", async () => {
  const { fetchMock, notesCourantes } = mockValidation([note(1, 1), note(2, 1)]);
  const utilisateur = userEvent.setup();
  renderMiseEnPage(VALIDEUR);

  // Deux dossiers à traiter au chargement.
  expect(await screen.findByRole("link", { name: "Validation, 2 dossiers à traiter" })).toBeInTheDocument();

  // Navigation vers la liste, puis le détail d'un dossier.
  await utilisateur.click(screen.getByRole("link", { name: /^Validation/ }));
  await utilisateur.click(await screen.findByRole("link", { name: "Détail 5" }));

  // Pendant ce temps, le dossier 2 a été traité ailleurs : la liste ne renvoie plus qu'un dossier.
  notesCourantes.liste = [note(1, 1)];

  // Retour à la liste : nouvel appel API, pastille mise à jour.
  await utilisateur.click(await screen.findByRole("link", { name: "Retour à la liste" }));
  expect(await screen.findByRole("link", { name: "Validation, 1 dossier à traiter" })).toBeInTheDocument();

  const appels = fetchMock.mock.calls.filter(([entree]) =>
    String(entree).includes("/api/v1/validation/notes?statut=soumise"),
  );
  expect(appels.length).toBeGreaterThanOrEqual(3); // chargement + chaque navigation
});

test("liste ramenée à zéro après une décision : la pastille disparaît", async () => {
  const { notesCourantes } = mockValidation([note(1, 1)]);
  const utilisateur = userEvent.setup();
  renderMiseEnPage(VALIDEUR, { url: "/validation" });

  expect(await screen.findByRole("link", { name: "Validation, 1 dossier à traiter" })).toBeInTheDocument();

  notesCourantes.liste = [];
  await utilisateur.click(screen.getByRole("link", { name: "Détail 5" }));
  await utilisateur.click(await screen.findByRole("link", { name: "Retour à la liste" }));

  const lien = await screen.findByRole("link", { name: "Validation" });
  expect(within(lien).queryByText(/^\d+$/)).not.toBeInTheDocument();
});

test("401 sur la file de validation : onSessionExpiree est appelé", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation((entree) => {
    const url = String(entree);
    if (url.includes("/api/v1/validation/notes")) {
      return Promise.resolve(jsonResponse({ detail: "Session expirée." }, 401));
    }
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
  const onSessionExpiree = vi.fn();
  renderMiseEnPage(VALIDEUR, { onSessionExpiree });

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalledTimes(1));
});

test("erreur réseau sur la file : pas de pastille fantôme, pas de crash", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau"));
  renderMiseEnPage(VALIDEUR);

  const lien = await screen.findByRole("link", { name: "Validation" });
  expect(within(lien).queryByText(/^\d+$/)).not.toBeInTheDocument();
});
