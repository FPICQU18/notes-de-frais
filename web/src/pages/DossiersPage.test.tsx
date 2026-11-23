import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import type { Note } from "../api/client";
import { DossiersPage } from "./DossiersPage";

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

function note(partiel: Partial<Note> & { id: number }): Note {
  return {
    libelle: "Déplacement",
    statut: "brouillon",
    total_centimes: 2450,
    nb_depenses: 2,
    derniere_depense_le: "2026-11-17",
    created_at: "2026-11-18T12:00:00Z",
    updated_at: "2026-11-18T12:00:00Z",
    ...partiel,
  };
}

function renderPage(options: { onSessionExpiree?: () => void } = {}) {
  const onSessionExpiree = options.onSessionExpiree ?? vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={["/dossiers"]}>
      <DossiersPage onSessionExpiree={onSessionExpiree} />
    </MemoryRouter>,
  );
  return { onSessionExpiree, ...utils };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("affiche un h1 « Dossiers » focalisé et appelle GET /v1/notes au montage", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(jsonResponse([note({ id: 1 })]));

  renderPage();

  const titre = screen.getByRole("heading", { level: 1, name: "Dossiers" });
  expect(titre).toHaveFocus();
  await screen.findByText("Déplacement");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/notes");
});

test("affiche les cartes dans l'ordre renvoyé par le serveur, sans tri client", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([
      note({ id: 3, libelle: "Troisième", statut: "soumise" }),
      note({ id: 1, libelle: "Premier", statut: "validee" }),
      note({ id: 2, libelle: "Deuxième", statut: "refusee" }),
    ]),
  );

  renderPage();

  const cartes = await screen.findAllByRole("listitem");
  expect(cartes).toHaveLength(3);
  expect(cartes[0]).toHaveTextContent("Troisième");
  expect(cartes[1]).toHaveTextContent("Premier");
  expect(cartes[2]).toHaveTextContent("Deuxième");
});

test("la carte affiche libellé, période, nombre, total et pastille de statut", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([
      note({
        id: 1,
        libelle: "Déplacement",
        statut: "brouillon",
        total_centimes: 2450,
        nb_depenses: 2,
        derniere_depense_le: "2026-11-17",
      }),
    ]),
  );

  renderPage();

  const carte = (await screen.findAllByRole("listitem"))[0];
  expect(within(carte).getByText("Déplacement")).toBeInTheDocument();
  expect(within(carte).getByText("Brouillon")).toBeInTheDocument();
  expect(within(carte).getByText(/Novembre 2026/)).toBeInTheDocument();
  expect(within(carte).getByText(/2 dépenses/)).toBeInTheDocument();
  expect(within(carte).getByText("24,50 €")).toBeInTheDocument();
});

test("pastille de statut : libellés exacts pour les cinq statuts", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([
      note({ id: 1, libelle: "A", statut: "brouillon" }),
      note({ id: 2, libelle: "B", statut: "soumise" }),
      note({ id: 3, libelle: "C", statut: "validee" }),
      note({ id: 4, libelle: "D", statut: "refusee" }),
      note({ id: 5, libelle: "E", statut: "remboursee" }),
    ]),
  );

  renderPage();

  const cartes = await screen.findAllByRole("listitem");
  expect(within(cartes[0]).getByText("Brouillon")).toBeInTheDocument();
  expect(within(cartes[1]).getByText("Soumise")).toBeInTheDocument();
  expect(within(cartes[2]).getByText("Validée")).toBeInTheDocument();
  expect(within(cartes[3]).getByText("Refusée")).toBeInTheDocument();
  expect(within(cartes[4]).getByText("Remboursée")).toBeInTheDocument();
});

test("dossier sans dépense : « Aucune dépense », « 0 dépense » et « 0,00 € »", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([
      note({
        id: 1,
        libelle: "Vide",
        nb_depenses: 0,
        total_centimes: 0,
        derniere_depense_le: null,
      }),
    ]),
  );

  renderPage();

  const carte = (await screen.findAllByRole("listitem"))[0];
  expect(within(carte).getByText(/Aucune dépense/)).toBeInTheDocument();
  expect(within(carte).getByText(/0 dépense/)).toBeInTheDocument();
  expect(within(carte).getByText("0,00 €")).toBeInTheDocument();
});

test("singulier et pluriel du nombre de dépenses", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([
      note({ id: 1, libelle: "Une", nb_depenses: 1 }),
      note({ id: 2, libelle: "Deux", nb_depenses: 2 }),
    ]),
  );

  renderPage();

  const cartes = await screen.findAllByRole("listitem");
  expect(within(cartes[0]).getByText(/1 dépense/)).toBeInTheDocument();
  expect(within(cartes[1]).getByText(/2 dépenses/)).toBeInTheDocument();
});

test("état vide : texte exact et bouton « Nouveau dossier »", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));

  renderPage();

  expect(
    await screen.findByText(
      "Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Nouveau dossier" })).toBeInTheDocument();
});

test("chaque carte est un lien vers /dossiers/:id", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([note({ id: 42, libelle: "Déplacement" })]),
  );

  renderPage();

  const lien = await screen.findByRole("link", { name: /Déplacement/ });
  expect(lien).toHaveAttribute("href", "/dossiers/42");
});

test("création valide : POST /v1/notes avec le libellé élagué puis navigation", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_input, init) => {
      if (init?.method === "POST") {
        return jsonResponse(note({ id: 7 }), 201);
      }
      return jsonResponse([]);
    },
  );
  const utilisateur = userEvent.setup();

  render(
    <MemoryRouter initialEntries={["/dossiers"]}>
      <Routes>
        <Route path="/dossiers" element={<DossiersPage onSessionExpiree={vi.fn()} />} />
        <Route path="/dossiers/:id" element={<div>DÉTAIL DOSSIER</div>} />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.");
  await utilisateur.click(screen.getByRole("button", { name: "Nouveau dossier" }));
  await utilisateur.type(screen.getByLabelText("Titre"), "   Mon dossier   ");
  await utilisateur.click(screen.getByRole("button", { name: "Créer" }));

  expect(await screen.findByText("DÉTAIL DOSSIER")).toBeInTheDocument();

  const appelPost = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  expect(appelPost).toBeDefined();
  expect(JSON.parse(appelPost![1]!.body as string)).toEqual({ libelle: "Mon dossier" });
});

test("titre vide : message d'erreur et aucun appel réseau", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));
  const utilisateur = userEvent.setup();

  renderPage();

  await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.");
  await utilisateur.click(screen.getByRole("button", { name: "Nouveau dossier" }));
  await utilisateur.type(screen.getByLabelText("Titre"), "   ");
  await utilisateur.click(screen.getByRole("button", { name: "Créer" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Le libellé est requis.");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("titre trop long : message d'erreur et aucun appel réseau", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));
  const utilisateur = userEvent.setup();

  renderPage();

  await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.");
  await utilisateur.click(screen.getByRole("button", { name: "Nouveau dossier" }));
  await utilisateur.type(screen.getByLabelText("Titre"), "a".repeat(201));
  await utilisateur.click(screen.getByRole("button", { name: "Créer" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Le libellé est trop long (200 caractères maximum).",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("422 : le message serveur s'affiche et la boîte reste ouverte", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (init?.method === "POST") {
      return jsonResponse(
        { detail: [{ loc: ["body", "libelle"], msg: "Le libellé est requis." }] },
        422,
      );
    }
    return jsonResponse([]);
  });
  const utilisateur = userEvent.setup();

  renderPage();

  await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.");
  await utilisateur.click(screen.getByRole("button", { name: "Nouveau dossier" }));
  await utilisateur.type(screen.getByLabelText("Titre"), "Mon dossier");
  await utilisateur.click(screen.getByRole("button", { name: "Créer" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Le libellé est requis.");
  expect(screen.getByLabelText("Titre")).toHaveValue("Mon dossier");
  expect(screen.getByRole("button", { name: "Créer" })).toBeEnabled();
});

test("le focus va au champ Titre à l'ouverture du dialogue", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));
  const utilisateur = userEvent.setup();

  renderPage();

  await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.");
  await utilisateur.click(screen.getByRole("button", { name: "Nouveau dossier" }));
  expect(screen.getByLabelText("Titre")).toHaveFocus();
});

test("Escape ferme le dialogue", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));
  const utilisateur = userEvent.setup();

  renderPage();

  await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.");
  await utilisateur.click(screen.getByRole("button", { name: "Nouveau dossier" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  await utilisateur.keyboard("{Escape}");

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("erreur de chargement : alerte puis « Réessayer » relance l'appel", async () => {
  let appels = 0;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    appels += 1;
    if (appels === 1) {
      throw new Error("réseau");
    }
    return jsonResponse([note({ id: 1 })]);
  });
  const utilisateur = userEvent.setup();

  renderPage();

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Déplacement")).toBeInTheDocument();
});

test("401 au chargement : la session est considérée expirée", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({ detail: "Session expirée." }, 401),
  );
  const onSessionExpiree = vi.fn();

  renderPage({ onSessionExpiree });

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
});

test("401 à la création : session expirée, aucune navigation, aucun nouvel appel", async () => {
  const onSessionExpiree = vi.fn();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_input, init) => {
      if (init?.method === "POST") {
        return jsonResponse({ detail: "Session expirée." }, 401);
      }
      return jsonResponse([]);
    },
  );
  const utilisateur = userEvent.setup();

  render(
    <MemoryRouter initialEntries={["/dossiers"]}>
      <Routes>
        <Route
          path="/dossiers"
          element={<DossiersPage onSessionExpiree={onSessionExpiree} />}
        />
        <Route path="/dossiers/:id" element={<div>DÉTAIL DOSSIER</div>} />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.");
  await utilisateur.click(screen.getByRole("button", { name: "Nouveau dossier" }));
  await utilisateur.type(screen.getByLabelText("Titre"), "Mon dossier");
  await utilisateur.click(screen.getByRole("button", { name: "Créer" }));

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
  expect(screen.queryByText("DÉTAIL DOSSIER")).not.toBeInTheDocument();

  const appelsPost = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(appelsPost).toHaveLength(1);
});

test("création : « Création… » et « Annuler » désactivés pendant l'envoi puis navigation", async () => {
  let resoudrePost!: (reponse: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    if (init?.method === "POST") {
      return new Promise<Response>((resoudre) => {
        resoudrePost = resoudre;
      });
    }
    return Promise.resolve(jsonResponse([]));
  });
  const utilisateur = userEvent.setup();

  render(
    <MemoryRouter initialEntries={["/dossiers"]}>
      <Routes>
        <Route path="/dossiers" element={<DossiersPage onSessionExpiree={vi.fn()} />} />
        <Route path="/dossiers/:id" element={<div>DÉTAIL DOSSIER</div>} />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.");
  await utilisateur.click(screen.getByRole("button", { name: "Nouveau dossier" }));
  await utilisateur.type(screen.getByLabelText("Titre"), "Mon dossier");
  await utilisateur.click(screen.getByRole("button", { name: "Créer" }));

  const boutonCreation = await screen.findByRole("button", { name: "Création…" });
  expect(boutonCreation).toBeDisabled();
  expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();

  resoudrePost(jsonResponse(note({ id: 9 }), 201));
  expect(await screen.findByText("DÉTAIL DOSSIER")).toBeInTheDocument();
});

test("le bouton « Annuler » ferme la boîte sans appel réseau", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));
  const utilisateur = userEvent.setup();

  renderPage();

  await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation.");
  await utilisateur.click(screen.getByRole("button", { name: "Nouveau dossier" }));

  const dialogue = screen.getByRole("dialog");
  expect(dialogue).toBeInTheDocument();
  expect(within(dialogue).getByRole("button", { name: "Annuler" })).toBeInTheDocument();

  await utilisateur.click(within(dialogue).getByRole("button", { name: "Annuler" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
