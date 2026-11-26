import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

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

test("activation de la carte au clavier : la touche Espace ouvre le détail", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([depense({ id: 42, libelle: "Ticket" })]),
  );
  const utilisateur = userEvent.setup();

  render(
    <MemoryRouter initialEntries={["/depenses"]}>
      <Routes>
        <Route path="/depenses" element={<DepensesPage onSessionExpiree={vi.fn()} />} />
        <Route path="/depenses/:id" element={<div>DÉTAIL</div>} />
      </Routes>
    </MemoryRouter>,
  );

  const lien = await screen.findByRole("link", { name: /Ticket/ });
  lien.focus();
  await utilisateur.keyboard(" ");

  expect(await screen.findByText("DÉTAIL")).toBeInTheDocument();
});

/* ------------------------------------------------- US-044 (tableau bureau ≥ 1024 px) */

type EcouteurMedia = (evenement: MediaQueryListEvent) => void;

/**
 * Mock de `window.matchMedia` piloté par la largeur : `definirLargeur(px)`
 * met à jour `matches` et notifie les écouteurs, comme au redimensionnement
 * (même patron que `ValidationPage.test.tsx`, US-043).
 */
function mockLargeur(largeurInitiale: number) {
  let largeur = largeurInitiale;
  const ecouteurs = new Set<EcouteurMedia>();
  vi.stubGlobal("matchMedia", (requete: string) => {
    const correspond = () =>
      requete === "(min-width: 1024px)" ? largeur >= 1024 : false;
    return {
      get matches() {
        return correspond();
      },
      media: requete,
      addEventListener: (_: string, ecouteur: EcouteurMedia) => ecouteurs.add(ecouteur),
      removeEventListener: (_: string, ecouteur: EcouteurMedia) => ecouteurs.delete(ecouteur),
    } as unknown as MediaQueryList;
  });
  return {
    definirLargeur(px: number) {
      largeur = px;
      const evenement = {
        matches: px >= 1024,
        media: "(min-width: 1024px)",
      } as MediaQueryListEvent;
      for (const ecouteur of ecouteurs) ecouteur(evenement);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderListeBureau(options: Options & { largeur?: number } = {}) {
  mockLargeur(options.largeur ?? 1024);
  return renderListe(options);
}

/** Libellés des lignes du tableau, dans l'ordre (via l'aria-label du lien de ligne). */
function libellesDesLignes(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((ligne) =>
      (within(ligne).getByRole("link").getAttribute("aria-label") ?? "").replace(
        "Ouvrir la dépense ",
        "",
      ),
    );
}

describe("US-044 — tableau triable ≥ 1024 px", () => {
  test("1023 px : les cartes restent affichées, aucun tableau", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([depense({ id: 1, libelle: "Ticket" })]),
    );

    renderListeBureau({ largeur: 1023 });

    const cartes = await screen.findAllByRole("listitem");
    expect(cartes).toHaveLength(1);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ticket/ })).toHaveAttribute("href", "/depenses/1");
  });

  test("1024 px : tableau avec les 5 colonnes date, libellé, catégorie, montant, statut", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        depense({ id: 1, libelle: "Déjeuner client", categorie: "repas", montant_centimes: 4500, note_id: null }),
        depense({ id: 2, libelle: "Taxi aéroport", categorie: "transport", montant_centimes: 3250, note_id: 7, date_depense: "2026-11-25" }),
      ]),
    );

    renderListeBureau();

    expect(await screen.findByRole("table", { name: "Toutes les dépenses" })).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    for (const colonne of ["Date", "Libellé", "Catégorie", "Montant", "Statut"]) {
      expect(
        within(screen.getAllByRole("row")[0]).getByRole("columnheader", {
          name: new RegExp(`^${colonne}`),
        }),
      ).toBeInTheDocument();
    }
    // Bulles/couleurs de catégorie dans la colonne catégorie (libellé + date avec bulle).
    expect(screen.getByText("Repas")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();
    expect(screen.getByText(/45,00/)).toBeInTheDocument();
    // Colonne statut = rattachement dossier : « À classer » ou « Dossier n° 7 ».
    expect(screen.getByText("À classer")).toBeInTheDocument();
    expect(screen.getByText("Dossier n° 7")).toBeInTheDocument();
  });

  test("1024 px : tri par défaut = ordre serveur ; clic « Date » → ascendant puis descendant (aria-sort)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        depense({ id: 1, libelle: "Récent", date_depense: "2026-11-26" }),
        depense({ id: 2, libelle: "Ancien", date_depense: "2026-11-10" }),
        depense({ id: 3, libelle: "Milieu", date_depense: "2026-11-18" }),
      ]),
    );
    const utilisateur = userEvent.setup();

    renderListeBureau();

    await screen.findByRole("table");
    expect(libellesDesLignes()).toEqual(["Récent", "Ancien", "Milieu"]);
    const enteteDate = screen.getByRole("columnheader", { name: /Date/ });
    expect(enteteDate).not.toHaveAttribute("aria-sort");

    const boutonDate = within(enteteDate).getByRole("button", { name: /Date/ });
    await utilisateur.click(boutonDate);
    expect(enteteDate).toHaveAttribute("aria-sort", "ascending");
    expect(libellesDesLignes()).toEqual(["Ancien", "Milieu", "Récent"]);

    await utilisateur.click(boutonDate);
    expect(enteteDate).toHaveAttribute("aria-sort", "descending");
    expect(libellesDesLignes()).toEqual(["Récent", "Milieu", "Ancien"]);
  });

  test("1024 px : clic sur « Montant » trie par montant croissant puis décroissant", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        depense({ id: 1, libelle: "Gros", montant_centimes: 9900 }),
        depense({ id: 2, libelle: "Petit", montant_centimes: 850 }),
        depense({ id: 3, libelle: "Moyen", montant_centimes: 3820 }),
      ]),
    );
    const utilisateur = userEvent.setup();

    renderListeBureau();

    const enteteMontant = await screen.findByRole("columnheader", { name: /Montant/ });
    const boutonMontant = within(enteteMontant).getByRole("button", { name: /Montant/ });

    await utilisateur.click(boutonMontant);
    expect(enteteMontant).toHaveAttribute("aria-sort", "ascending");
    expect(libellesDesLignes()).toEqual(["Petit", "Moyen", "Gros"]);

    await utilisateur.click(boutonMontant);
    expect(enteteMontant).toHaveAttribute("aria-sort", "descending");
    expect(libellesDesLignes()).toEqual(["Gros", "Moyen", "Petit"]);
  });

  test("1024 px : clic sur une ligne du tableau navigue vers /depenses/:id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([depense({ id: 42, libelle: "Ticket" })]),
    );
    const utilisateur = userEvent.setup();

    mockLargeur(1024);
    render(
      <MemoryRouter initialEntries={["/depenses"]}>
        <Routes>
          <Route path="/depenses" element={<DepensesPage onSessionExpiree={vi.fn()} />} />
          <Route path="/depenses/:id" element={<div>DÉTAIL</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const lien = await screen.findByRole("link", { name: "Ouvrir la dépense Ticket" });
    expect(lien).toHaveAttribute("href", "/depenses/42");
    await utilisateur.click(lien);
    expect(await screen.findByText("DÉTAIL")).toBeInTheDocument();
  });

  test("1024 px : état vide conservé, pas de tableau", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));

    renderListeBureau();

    expect(await screen.findByText("Aucune dépense pour l'instant.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ajouter une dépense" })).toBeInTheDocument();
  });

  test("1024 px : erreur conservée (alerte + « Réessayer »), annonce conservée, pas de tableau en erreur", async () => {
    let appels = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      appels += 1;
      if (appels === 1) throw new Error("réseau");
      return jsonResponse([depense({ id: 1 })]);
    });
    const utilisateur = userEvent.setup();

    renderListeBureau({ initialState: { annonce: "Dépense enregistrée." } });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Dépense enregistrée.");
    await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("table", { name: "Toutes les dépenses" })).toBeInTheDocument();
  });

  test("1024 px : chargement conserve aria-busy ; 401 → onSessionExpiree", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));

    renderListeBureau();

    const region = screen.getByRole("region", { name: "Dépenses" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Chargement…")).toBeInTheDocument();

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ detail: "Session expirée." }, 401),
    );
    const onSessionExpiree = vi.fn();

    renderListeBureau({ onSessionExpiree });

    await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
  });
});
