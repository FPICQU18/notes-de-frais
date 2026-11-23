import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import type { Depense, Note } from "../api/client";
import { DetailDepensePage } from "./DetailDepensePage";

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

function depense(partiel: Partial<Depense> & { id: number }): Depense {
  return {
    libelle: "Ancien",
    date_depense: "2020-06-15",
    montant_centimes: 1000,
    categorie: "transport",
    commentaire: null,
    note_id: null,
    created_at: "2020-06-15T12:00:00Z",
    updated_at: "2020-06-15T12:00:00Z",
    ...partiel,
  };
}

function note(partiel: Partial<Note> & { id: number }): Note {
  return {
    libelle: "Note",
    statut: "brouillon",
    total_centimes: 1000,
    nb_depenses: 1,
    created_at: "2020-06-15T12:00:00Z",
    updated_at: "2020-06-15T12:00:00Z",
    ...partiel,
  };
}

function routeurDetail(routes: Array<{ method: string; url: string; reponse: Response }>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const trouve = routes.find((r) => r.method === method && r.url === url);
    if (trouve === undefined) {
      return jsonResponse({ detail: `Route inattendue : ${method} ${url}` }, 500);
    }
    return trouve.reponse;
  });
}

function renderDetail(options: { onSessionExpiree?: () => void } = {}) {
  const onSessionExpiree = options.onSessionExpiree ?? vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={["/depenses/1"]}>
      <Routes>
        <Route
          path="/depenses/:id"
          element={<DetailDepensePage onSessionExpiree={onSessionExpiree} />}
        />
        <Route path="/depenses" element={<div>LISTE</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return { onSessionExpiree, ...utils };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("note_id null : aucun appel à /notes, formulaire de modification actif", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      routeurDetail([
        {
          method: "GET",
          url: "/api/v1/depenses/1",
          reponse: jsonResponse(depense({ id: 1 })),
        },
      ]),
    );

  renderDetail();

  const montant = await screen.findByLabelText("Montant");
  expect(
    screen.getByRole("heading", { name: "Modifier la dépense" }),
  ).toBeInTheDocument();
  expect(montant).toBeEnabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/depenses/1");
});

test("dossier en brouillon : champs actifs et bouton de modification présent", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    routeurDetail([
      { method: "GET", url: "/api/v1/depenses/1", reponse: jsonResponse(depense({ id: 1, note_id: 5 })) },
      { method: "GET", url: "/api/v1/notes/5", reponse: jsonResponse(note({ id: 5, statut: "brouillon" })) },
    ]),
  );

  renderDetail();

  await screen.findByRole("button", { name: "Enregistrer les modifications" });
  expect(screen.getByLabelText("Montant")).toBeEnabled();
  expect(screen.getByLabelText("Libellé")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
});

test("dossier non brouillon : champs en lecture seule, bandeau et pas de boutons d'action", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    routeurDetail([
      { method: "GET", url: "/api/v1/depenses/1", reponse: jsonResponse(depense({ id: 1, note_id: 5 })) },
      { method: "GET", url: "/api/v1/notes/5", reponse: jsonResponse(note({ id: 5, statut: "soumise" })) },
    ]),
  );

  renderDetail();

  const bandeau = await screen.findByRole("status");
  expect(bandeau).toHaveTextContent(
    "Cette dépense appartient à un dossier qui n'est plus modifiable.",
  );
  expect(screen.getByLabelText("Montant")).toBeDisabled();
  expect(screen.getByLabelText("Libellé")).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Enregistrer les modifications" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
});

test("404 → écran « Dépense introuvable. » avec lien retour", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    routeurDetail([
      { method: "GET", url: "/api/v1/depenses/1", reponse: jsonResponse({ detail: "Introuvable." }, 404) },
    ]),
  );

  renderDetail();

  expect(
    await screen.findByRole("heading", { name: "Dépense introuvable." }),
  ).toBeInTheDocument();
  const lien = screen.getByRole("link", { name: "Retour aux dépenses" });
  expect(lien).toHaveAttribute("href", "/depenses");
});

test("erreur réseau : alerte + « Réessayer » relance le GET", async () => {
  let appels = 0;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    appels += 1;
    if (appels === 1) {
      throw new Error("réseau");
    }
    return jsonResponse(depense({ id: 1 }));
  });
  const utilisateur = userEvent.setup();

  renderDetail();

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(
    await screen.findByRole("heading", { name: "Modifier la dépense" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Montant")).toBeEnabled();
});

test("401 → onSessionExpiree", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    routeurDetail([
      { method: "GET", url: "/api/v1/depenses/1", reponse: jsonResponse({ detail: "Session expirée." }, 401) },
    ]),
  );
  const onSessionExpiree = vi.fn();

  renderDetail({ onSessionExpiree });

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
});

test("modification : PATCH avec le seul champ modifié, puis retour à la liste", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    routeurDetail([
      { method: "GET", url: "/api/v1/depenses/1", reponse: jsonResponse(depense({ id: 1, libelle: "Ancien" })) },
      { method: "PATCH", url: "/api/v1/depenses/1", reponse: jsonResponse({ id: 1 }) },
    ]),
  );
  const utilisateur = userEvent.setup();

  renderDetail();

  const libelle = await screen.findByLabelText("Libellé");
  await utilisateur.clear(libelle);
  await utilisateur.type(libelle, "Nouveau libellé");
  await utilisateur.click(
    screen.getByRole("button", { name: "Enregistrer les modifications" }),
  );

  await screen.findByText("LISTE");

  const patchAppel = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(patchAppel).toBeDefined();
  expect(String(patchAppel![0])).toBe("/api/v1/depenses/1");
  expect(JSON.parse(String(patchAppel![1]?.body))).toEqual({ libelle: "Nouveau libellé" });
});

test("suppression : confirmation puis DELETE, puis retour à la liste", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    routeurDetail([
      { method: "GET", url: "/api/v1/depenses/1", reponse: jsonResponse(depense({ id: 1 })) },
      { method: "DELETE", url: "/api/v1/depenses/1", reponse: new Response(null, { status: 204 }) },
    ]),
  );
  const utilisateur = userEvent.setup();

  renderDetail();

  await utilisateur.click(await screen.findByRole("button", { name: "Supprimer" }));
  const confirmation = await screen.findByRole("group", {
    name: "Confirmation de suppression",
  });
  await utilisateur.click(within(confirmation).getByRole("button", { name: "Supprimer" }));

  await screen.findByText("LISTE");

  const deleteAppel = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
  expect(deleteAppel).toBeDefined();
  expect(String(deleteAppel![0])).toBe("/api/v1/depenses/1");
});
