import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";

import type { Depense } from "../api/client";
import { DepensesPage } from "./DepensesPage";

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

function depense(partiel: Partial<Depense> & { id: number }): Depense {
  return {
    libelle: "Ticket",
    date_depense: "2026-11-18",
    montant_centimes: 2450,
    categorie: "transport",
    commentaire: null,
    note_id: null,
    created_at: "2026-11-18T12:00:00Z",
    updated_at: "2026-11-18T12:00:00Z",
    ...partiel,
  };
}

interface Options {
  onSessionExpiree?: () => void;
  initialState?: unknown;
}

function renderListe(options: Options = {}) {
  const onSessionExpiree = options.onSessionExpiree ?? vi.fn();
  const initialEntries = options.initialState
    ? [{ pathname: "/depenses", state: options.initialState }]
    : ["/depenses"];
  const utils = render(
    <MemoryRouter initialEntries={initialEntries}>
      <DepensesPage onSessionExpiree={onSessionExpiree} />
    </MemoryRouter>,
  );
  return { onSessionExpiree, ...utils };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("émet un seul GET /depenses au montage et affiche le titre « Dépenses »", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(jsonResponse([depense({ id: 1 })]));

  renderListe();

  expect(screen.getByRole("heading", { level: 1, name: "Dépenses" })).toBeInTheDocument();
  await screen.findByText("Ticket");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/depenses");
});

test("affiche les cartes dans l'ordre renvoyé par le serveur, sans tri ni regroupement", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([
      depense({ id: 1, libelle: "Ticket", montant_centimes: 2450 }),
      depense({ id: 2, libelle: "Trajet", montant_centimes: 12345, note_id: 5 }),
      depense({ id: 3, libelle: "Parking", montant_centimes: 800 }),
    ]),
  );

  renderListe();

  const cartes = await screen.findAllByRole("listitem");
  expect(cartes.map((c) => c.textContent)).toHaveLength(3);
  expect(cartes[0]).toHaveTextContent("Ticket");
  expect(cartes[1]).toHaveTextContent("Trajet");
  expect(cartes[2]).toHaveTextContent("Parking");

  // Contenu d'une carte : libellé, date courte, montant à droite.
  expect(within(cartes[0]).getByText("Ticket")).toBeInTheDocument();
  expect(within(cartes[0]).getByText(/18 nov\./)).toBeInTheDocument();
  expect(within(cartes[0]).getByText("24,50 €")).toBeInTheDocument();

  // « À classer » quand note_id est null, sinon « Semaine NN ».
  expect(within(cartes[0]).getByText("À classer")).toBeInTheDocument();
  expect(within(cartes[1]).getByText(/Semaine 47/)).toBeInTheDocument();
  expect(within(cartes[1]).getByText("123,45 €")).toBeInTheDocument();
});

test("pendant le chargement : titre rendu, zone aria-busy, pas d'erreur", () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));

  renderListe();

  expect(screen.getByRole("heading", { level: 1, name: "Dépenses" })).toBeInTheDocument();
  const region = screen.getByRole("region", { name: "Dépenses" });
  expect(region).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("Chargement…")).toBeInTheDocument();
});

test("liste vide : message et lien « Ajouter une dépense » vers /depenses/nouvelle", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));

  renderListe();

  expect(await screen.findByText("Aucune dépense pour l'instant.")).toBeInTheDocument();
  const lien = screen.getByRole("link", { name: "Ajouter une dépense" });
  expect(lien).toHaveAttribute("href", "/depenses/nouvelle");
});

test("erreur de chargement : alerte + « Réessayer » relance le GET sans rechargement", async () => {
  let appels = 0;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    appels += 1;
    if (appels === 1) {
      throw new Error("réseau");
    }
    return jsonResponse([]);
  });
  const utilisateur = userEvent.setup();

  renderListe();

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Aucune dépense pour l'instant.")).toBeInTheDocument();
});

test("401 → onSessionExpiree", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({ detail: "Session expirée." }, 401),
  );
  const onSessionExpiree = vi.fn();

  renderListe({ onSessionExpiree });

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
});

test("annonce de navigation : affichée dans une zone role=status", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([depense({ id: 1 })]));

  renderListe({ initialState: { annonce: "Dépense enregistrée." } });

  const statut = await screen.findByRole("status");
  expect(statut).toHaveTextContent("Dépense enregistrée.");
});

test("annonce inconnue : ignorée (pas de zone status)", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([depense({ id: 1 })]));

  renderListe({ initialState: { annonce: "Message pirate" } });

  await screen.findByText("Ticket");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("chaque carte est un lien vers /depenses/:id", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([depense({ id: 42, libelle: "Ticket" })]),
  );

  renderListe();

  const lien = await screen.findByRole("link", { name: /Ticket/ });
  expect(lien).toHaveAttribute("href", "/depenses/42");
});
