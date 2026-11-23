import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import type { Depense, Note, UserRead } from "../api/client";
import { HomePage } from "./HomePage";

const UTILISATEUR: UserRead = {
  id: 1,
  email: "camille@example.com",
  display_name: "Camille Martin",
  role: "utilisateur",
};

const MAINTENANT = new Date("2026-11-15T12:00:00Z");

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

function depense(partiel: Partial<Depense> & { id: number }): Depense {
  return {
    libelle: "Ticket",
    date_depense: "2026-11-15",
    montant_centimes: 1000,
    categorie: "autre",
    commentaire: null,
    note_id: null,
    created_at: "2026-11-15T12:00:00Z",
    updated_at: "2026-11-15T12:00:00Z",
    ...partiel,
  };
}

function note(partiel: Partial<Note> & { id: number }): Note {
  return {
    libelle: "Dossier",
    statut: "brouillon",
    total_centimes: 0,
    nb_depenses: 0,
    derniere_depense_le: null,
    created_at: "2026-11-15T12:00:00Z",
    updated_at: "2026-11-15T12:00:00Z",
    ...partiel,
  };
}

function mockAccueil({
  depenses = [],
  aClasser = [],
  notes = [],
}: {
  depenses?: unknown;
  aClasser?: unknown;
  notes?: unknown;
} = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const url = String(entree);
    if (url === "/api/v1/depenses") return jsonResponse(depenses);
    if (url === "/api/v1/depenses?a_classer=true") return jsonResponse(aClasser);
    if (url === "/api/v1/notes") return jsonResponse(notes);
    return jsonResponse({ detail: "Introuvable" }, 404);
  });
}

interface PropsAccueil {
  utilisateur?: UserRead;
  onDeconnecte?: () => void;
  onSessionExpiree?: () => void;
  focusTitre?: boolean;
  maintenant?: Date;
}

function renderAccueil(props: PropsAccueil = {}) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              utilisateur={UTILISATEUR}
              onDeconnecte={() => {}}
              onSessionExpiree={() => {}}
              focusTitre={false}
              maintenant={MAINTENANT}
              {...props}
            />
          }
        />
        <Route path="/depenses" element={<div>Page dépenses</div>} />
        <Route path="/dossiers" element={<div>Page dossiers</div>} />
        <Route path="/depenses/nouvelle" element={<div>Saisie d'un ticket</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("total du mois : somme des dépenses du mois courant seulement", async () => {
  mockAccueil({
    depenses: [
      depense({ id: 1, libelle: "Train", date_depense: "2026-11-05", montant_centimes: 1000 }),
      depense({ id: 2, libelle: "Repas", date_depense: "2026-11-10", montant_centimes: 2500 }),
      depense({ id: 3, libelle: "Hôtel", date_depense: "2026-11-20", montant_centimes: 12345 }),
      depense({ id: 4, libelle: "Octobre", date_depense: "2026-10-28", montant_centimes: 9999 }),
    ],
  });
  renderAccueil();

  expect(await screen.findByText("Dépenses de novembre")).toBeInTheDocument();
  expect(screen.getByText("158,45 €")).toBeInTheDocument();
});

test("aucune dépense du mois : total « 0,00 € »", async () => {
  mockAccueil({
    depenses: [
      depense({ id: 1, libelle: "Octobre", date_depense: "2026-10-28", montant_centimes: 5000 }),
    ],
  });
  renderAccueil();

  expect(await screen.findByText("0,00 €")).toBeInTheDocument();
});

test("pastille « à classer » : « 1 à classer »", async () => {
  mockAccueil({ aClasser: [depense({ id: 1 })] });
  renderAccueil();

  expect(await screen.findByText("1 à classer")).toBeInTheDocument();
});

test("pastille « à classer » : « 2 à classer »", async () => {
  mockAccueil({ aClasser: [depense({ id: 1 }), depense({ id: 2 })] });
  renderAccueil();

  expect(await screen.findByText("2 à classer")).toBeInTheDocument();
});

test("pastille dossiers : « 0 dossier en brouillon »", async () => {
  mockAccueil({ notes: [] });
  renderAccueil();

  expect(await screen.findByText("0 dossier en brouillon")).toBeInTheDocument();
});

test("pastille dossiers : « 1 dossier en brouillon »", async () => {
  mockAccueil({ notes: [note({ id: 1, statut: "brouillon" })] });
  renderAccueil();

  expect(await screen.findByText("1 dossier en brouillon")).toBeInTheDocument();
});

test("pastille dossiers : « 2 dossiers en brouillon », un soumise non compté", async () => {
  mockAccueil({
    notes: [
      note({ id: 1, statut: "brouillon" }),
      note({ id: 2, statut: "brouillon" }),
      note({ id: 3, statut: "soumise" }),
    ],
  });
  renderAccueil();

  expect(await screen.findByText("2 dossiers en brouillon")).toBeInTheDocument();
});

test("plus de 3 dépenses : 3 cartes dans l'ordre du serveur", async () => {
  mockAccueil({
    depenses: [
      depense({ id: 1, libelle: "Première", date_depense: "2026-11-20" }),
      depense({ id: 2, libelle: "Deuxième", date_depense: "2026-11-19" }),
      depense({ id: 3, libelle: "Troisième", date_depense: "2026-11-18" }),
      depense({ id: 4, libelle: "Quatrième", date_depense: "2026-11-17" }),
    ],
  });
  renderAccueil();

  await screen.findByText("Première");

  const cartes = screen.getAllByRole("listitem");
  expect(cartes).toHaveLength(3);
  expect(within(cartes[0]).getByText("Première")).toBeInTheDocument();
  expect(within(cartes[1]).getByText("Deuxième")).toBeInTheDocument();
  expect(within(cartes[2]).getByText("Troisième")).toBeInTheDocument();
  expect(screen.queryByText("Quatrième")).not.toBeInTheDocument();
});

test("détail : « À classer » si note_id null, « Semaine 47 » sinon", async () => {
  mockAccueil({
    depenses: [
      depense({ id: 1, libelle: "Sans dossier", date_depense: "2026-11-10", note_id: null }),
      depense({ id: 2, libelle: "Rattachée", date_depense: "2026-11-17", note_id: 7 }),
    ],
  });
  renderAccueil();

  await screen.findByText("Sans dossier");

  expect(screen.getByText("À classer")).toBeInTheDocument();
  expect(screen.getByText("Semaine 47")).toBeInTheDocument();
});

test("« Scanner un ticket » mène à la saisie d'un ticket avec ?scan=1", async () => {
  mockAccueil();
  const utilisateur = userEvent.setup();
  renderAccueil();

  const lien = await screen.findByRole("link", { name: "Scanner un ticket" });
  expect(lien).toHaveAttribute("href", "/depenses/nouvelle?scan=1");

  await utilisateur.click(lien);

  expect(await screen.findByText("Saisie d'un ticket")).toBeInTheDocument();
});

test("« Tout voir » mène à /depenses", async () => {
  mockAccueil();
  const utilisateur = userEvent.setup();
  renderAccueil();

  await utilisateur.click(await screen.findByRole("link", { name: "Tout voir" }));

  expect(await screen.findByText("Page dépenses")).toBeInTheDocument();
});

test("pastilles : « à classer » → /depenses, « en brouillon » → /dossiers", async () => {
  mockAccueil({ aClasser: [depense({ id: 1 })], notes: [note({ id: 1 })] });
  renderAccueil();

  expect(await screen.findByRole("link", { name: "1 à classer" })).toHaveAttribute(
    "href",
    "/depenses",
  );
  expect(
    screen.getByRole("link", { name: "1 dossier en brouillon" }),
  ).toHaveAttribute("href", "/dossiers");
});

test("échec réseau de /depenses : alerte + « Réessayer » relance l'appel", async () => {
  let appelsDepenses = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const url = String(entree);
    if (url === "/api/v1/depenses") {
      appelsDepenses += 1;
      if (appelsDepenses === 1) {
        throw new Error("réseau");
      }
      return jsonResponse([
        depense({ id: 1, libelle: "Récupérée", date_depense: "2026-11-15" }),
      ]);
    }
    if (url === "/api/v1/depenses?a_classer=true") return jsonResponse([]);
    if (url === "/api/v1/notes") return jsonResponse([]);
    return jsonResponse({ detail: "Introuvable" }, 404);
  });
  const utilisateur = userEvent.setup();
  renderAccueil();

  const alerte = await screen.findByRole("alert");
  expect(alerte).toHaveTextContent("Serveur injoignable. Vérifiez votre connexion.");

  await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));

  expect(await screen.findByText("Récupérée")).toBeInTheDocument();
  expect(appelsDepenses).toBeGreaterThanOrEqual(2);
});

test("401 sur un appel : onSessionExpiree est appelé sans boucle de requêtes", async () => {
  let appels = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const url = String(entree);
    appels += 1;
    if (url === "/api/v1/depenses") {
      return jsonResponse({ detail: "Session expirée." }, 401);
    }
    if (url === "/api/v1/depenses?a_classer=true") {
      return jsonResponse({ detail: "Session expirée." }, 401);
    }
    if (url === "/api/v1/notes") {
      return jsonResponse({ detail: "Session expirée." }, 401);
    }
    return jsonResponse({ detail: "Introuvable" }, 404);
  });
  const onSessionExpiree = vi.fn();
  renderAccueil({ onSessionExpiree });

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
  expect(appels).toBe(3);
  expect(onSessionExpiree).toHaveBeenCalledTimes(3);
});

test("exactement 3 appels : depenses, depenses?a_classer=true, notes", async () => {
  const fetchMock = mockAccueil();
  renderAccueil();

  await screen.findByText("Dépenses de novembre");

  const urls = fetchMock.mock.calls.map(([entree]) => String(entree));
  expect(urls.filter((url) => url === "/api/v1/depenses")).toHaveLength(1);
  expect(urls.filter((url) => url === "/api/v1/depenses?a_classer=true")).toHaveLength(1);
  expect(urls.filter((url) => url === "/api/v1/notes")).toHaveLength(1);
});

test("état de chargement : aria-busy et « Chargement… » pendant le chargement", async () => {
  let resolveDepenses!: (reponse: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const url = String(entree);
    if (url === "/api/v1/depenses") {
      return new Promise<Response>((resoudre) => {
        resolveDepenses = resoudre;
      });
    }
    if (url === "/api/v1/depenses?a_classer=true") return jsonResponse([]);
    if (url === "/api/v1/notes") return jsonResponse([]);
    return jsonResponse({ detail: "Introuvable" }, 404);
  });
  renderAccueil();

  expect(screen.getByText("Chargement…")).toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");

  resolveDepenses(jsonResponse([]));
  await screen.findByText("Aucune dépense ce mois-ci.");
  expect(screen.getByRole("main")).not.toHaveAttribute("aria-busy");
});

test("aucune dépense : message vide, pastilles à 0, « Scanner un ticket » présent", async () => {
  mockAccueil();
  renderAccueil();

  expect(await screen.findByText("Aucune dépense ce mois-ci.")).toBeInTheDocument();
  expect(screen.getByText("0 à classer")).toBeInTheDocument();
  expect(screen.getByText("0 dossier en brouillon")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Scanner un ticket" })).toBeInTheDocument();
});

test("entête : initiales, date en français et « Bonjour <display_name> »", async () => {
  mockAccueil();
  renderAccueil();

  expect(
    await screen.findByRole("heading", { name: "Bonjour Camille Martin" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Dimanche 15 novembre")).toBeInTheDocument();
  expect(screen.getByText("CM")).toHaveAttribute("aria-hidden", "true");
});

test("focusTitre : le h1 reçoit le focus", async () => {
  mockAccueil();
  renderAccueil({ focusTitre: true });

  const titre = await screen.findByRole("heading", {
    name: "Bonjour Camille Martin",
  });
  await waitFor(() => expect(titre).toHaveFocus());
});

test("« Se déconnecter » reste accessible dans l'entête", async () => {
  mockAccueil();
  renderAccueil();

  expect(
    await screen.findByRole("button", { name: "Se déconnecter" }),
  ).toBeInTheDocument();
});
