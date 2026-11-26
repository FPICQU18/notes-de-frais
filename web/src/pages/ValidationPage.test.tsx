import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import type {
  NoteValidation,
  TransitionRead,
  UserRead,
  ValidationNoteDetail,
} from "../api/client";
import { ValidationPage } from "./ValidationPage";

const VALIDEUR: UserRead = {
  id: 10,
  email: "valideur@example.com",
  display_name: "Valideur",
  role: "valideur",
};

const ADMIN: UserRead = {
  id: 20,
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

function noteValidation(partiel: Partial<NoteValidation> & { id: number }): NoteValidation {
  return {
    libelle: "Déplacement Paris",
    statut: "soumise",
    total_centimes: 12345,
    nb_depenses: 2,
    soumise_at: "2026-11-21T09:30:00Z",
    proprietaire: { id: 99, display_name: "Camille Dupont" },
    ...partiel,
  };
}

/** Extrait le paramètre `statut` d'une URL de l'API de validation. */
function statutDeUrl(url: string): string | null {
  const match = /[?&]statut=([^&]+)/.exec(url);
  return match ? match[1] : null;
}

function renderPage(options: { utilisateur?: UserRead; onSessionExpiree?: () => void; annonce?: string } = {}) {
  const utilisateur = options.utilisateur ?? VALIDEUR;
  const onSessionExpiree = options.onSessionExpiree ?? vi.fn();
  const utils = render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/validation",
          state: options.annonce === undefined ? undefined : { annonce: options.annonce },
        },
      ]}
    >
      <ValidationPage utilisateur={utilisateur} onSessionExpiree={onSessionExpiree} />
    </MemoryRouter>,
  );
  return { onSessionExpiree, ...utils };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("au montage : onglet « À traiter » actif et un seul appel statut=soumise", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));
  renderPage();

  expect(screen.getByRole("tab", { name: "À traiter" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const panneau = screen.getByRole("tabpanel");
  expect(await within(panneau).findByText("Aucun dossier à traiter.")).toBeInTheDocument();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/validation/notes?statut=soumise");
});

test.each(["Dossier validé.", "Dossier refusé."])(
  "annonce « %s » portée par la navigation : rendue dans un role=status",
  async (annonce) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));
    renderPage({ annonce });

    expect(await screen.findByRole("status")).toHaveTextContent(annonce);
    // L'annonce cohabite avec le reste de la page (onglets et état vide).
    expect(screen.getByRole("tab", { name: "À traiter" })).toBeInTheDocument();
    expect(screen.getByText("Aucun dossier à traiter.")).toBeInTheDocument();
  },
);

test("sans annonce : aucun role=status n'est rendu", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));
  renderPage();

  await screen.findByText("Aucun dossier à traiter.");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("activer un onglet déclenche un unique appel ; revenir ne relance pas", async () => {
  const statutsAppeles: string[] = [];
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    statutsAppeles.push(statutDeUrl(String(entree)) ?? "?");
    return jsonResponse([]);
  });
  const utilisateur = userEvent.setup();
  renderPage();

  const panneauInitial = screen.getByRole("tabpanel");
  await within(panneauInitial).findByText("Aucun dossier à traiter.");

  await utilisateur.click(screen.getByRole("tab", { name: "Validés" }));
  await within(screen.getByRole("tabpanel")).findByText("Aucun dossier validé.");

  await utilisateur.click(screen.getByRole("tab", { name: "Refusés" }));
  await within(screen.getByRole("tabpanel")).findByText("Aucun dossier refusé.");

  await utilisateur.click(screen.getByRole("tab", { name: "Remboursés" }));
  await within(screen.getByRole("tabpanel")).findByText("Aucun dossier remboursé.");

  // Retour sur « À traiter » : déjà chargé, aucun nouvel appel.
  await utilisateur.click(screen.getByRole("tab", { name: "À traiter" }));

  expect(statutsAppeles).toEqual(["soumise", "validee", "refusee", "remboursee"]);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test("la carte affiche demandeur, titre, total, date et pastille de statut", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([
      noteValidation({
        id: 1,
        libelle: "Déplacement Paris",
        total_centimes: 12345,
        soumise_at: "2026-11-21T09:30:00Z",
        proprietaire: { id: 99, display_name: "Camille Dupont" },
      }),
    ]),
  );
  renderPage();

  const carte = (await screen.findAllByRole("listitem"))[0];
  expect(within(carte).getByText("Camille Dupont")).toBeInTheDocument();
  expect(within(carte).getByText("Déplacement Paris")).toBeInTheDocument();
  expect(within(carte).getByText("123,45 €")).toBeInTheDocument();
  expect(within(carte).getByText(/Envoyé le 21 nov\./)).toBeInTheDocument();
  expect(within(carte).getByText("Soumise")).toBeInTheDocument();
});

test("soumise_at null : la date affiche « — » et jamais Invalid Date", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([noteValidation({ id: 1, soumise_at: null })]),
  );
  renderPage();

  const carte = (await screen.findAllByRole("listitem"))[0];
  expect(within(carte).getByText("Envoyé le —")).toBeInTheDocument();
  expect(within(carte).queryByText(/Invalid Date/)).not.toBeInTheDocument();
});

test("masque son propre dossier dans « À traiter » et le montre ailleurs", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const statut = statutDeUrl(String(entree));
    if (statut === "soumise") {
      return jsonResponse([
        noteValidation({
          id: 1,
          libelle: "Mon dossier",
          proprietaire: { id: 10, display_name: "Valideur" },
        }),
        noteValidation({
          id: 2,
          libelle: "Dossier collègue",
          proprietaire: { id: 99, display_name: "Camille Dupont" },
        }),
      ]);
    }
    if (statut === "validee") {
      return jsonResponse([
        noteValidation({
          id: 3,
          libelle: "Mon dossier validé",
          statut: "validee",
          proprietaire: { id: 10, display_name: "Valideur" },
        }),
      ]);
    }
    return jsonResponse([]);
  });
  const utilisateur = userEvent.setup();
  renderPage();

  await screen.findByText("Dossier collègue");
  expect(screen.queryByText("Mon dossier")).not.toBeInTheDocument();

  await utilisateur.click(screen.getByRole("tab", { name: "Validés" }));
  expect(
    await within(screen.getByRole("tabpanel")).findByText("Mon dossier validé"),
  ).toBeInTheDocument();
});

test("états vides : message adapté à chacun des quatre onglets", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse([]));
  const utilisateur = userEvent.setup();
  renderPage();

  await within(screen.getByRole("tabpanel")).findByText("Aucun dossier à traiter.");

  await utilisateur.click(screen.getByRole("tab", { name: "Validés" }));
  await within(screen.getByRole("tabpanel")).findByText("Aucun dossier validé.");

  await utilisateur.click(screen.getByRole("tab", { name: "Refusés" }));
  await within(screen.getByRole("tabpanel")).findByText("Aucun dossier refusé.");

  await utilisateur.click(screen.getByRole("tab", { name: "Remboursés" }));
  await within(screen.getByRole("tabpanel")).findByText("Aucun dossier remboursé.");
});

test("chargement : aria-busy, « Chargement… » et onglets toujours présents", async () => {
  let resoudre!: (reponse: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise<Response>((resoudreAppel) => {
        resoudre = resoudreAppel;
      }),
  );
  renderPage();

  const panneau = screen.getByRole("tabpanel");
  expect(panneau).toHaveAttribute("aria-busy", "true");
  expect(within(panneau).getByText("Chargement…")).toBeInTheDocument();
  expect(screen.getByRole("tablist")).toBeInTheDocument();

  resoudre(jsonResponse([]));
  expect(await within(panneau).findByText("Aucun dossier à traiter.")).toBeInTheDocument();
});

test("erreur : alerte, message API et « Réessayer » ne relance que l'onglet courant", async () => {
  const appels: Record<string, number> = { soumise: 0, validee: 0 };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const statut = statutDeUrl(String(entree)) ?? "soumise";
    appels[statut] = (appels[statut] ?? 0) + 1;
    if (statut === "validee") {
      return jsonResponse({ detail: "Erreur serveur" }, 500);
    }
    return jsonResponse([
      noteValidation({
        id: 1,
        libelle: "Dossier collègue",
        proprietaire: { id: 99, display_name: "Camille Dupont" },
      }),
    ]);
  });
  const utilisateur = userEvent.setup();
  renderPage();

  await screen.findByText("Dossier collègue");

  await utilisateur.click(screen.getByRole("tab", { name: "Validés" }));
  const alerte = await within(screen.getByRole("tabpanel")).findByRole("alert");
  expect(alerte).toHaveTextContent("Erreur serveur");

  await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));

  await waitFor(() => expect(appels.validee).toBe(2));
  expect(appels.soumise).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(3);

  // Les données de « À traiter » sont conservées : retour sans nouvel appel.
  await utilisateur.click(screen.getByRole("tab", { name: "À traiter" }));
  expect(
    within(screen.getByRole("tabpanel")).getByText("Dossier collègue"),
  ).toBeInTheDocument();
  expect(appels.soumise).toBe(1);
});

test("401 : onSessionExpiree appelée une seule fois, sans boucle d'appels", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({ detail: "Session expirée." }, 401),
  );
  const onSessionExpiree = vi.fn();

  renderPage({ onSessionExpiree });

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("chaque carte est un lien vers /validation/:id", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse([noteValidation({ id: 7 }), noteValidation({ id: 8 })]),
  );
  renderPage();

  const cartes = await screen.findAllByRole("listitem");
  const hrefs = cartes.map((carte) => within(carte).getByRole("link").getAttribute("href"));
  expect(hrefs).toEqual(["/validation/7", "/validation/8"]);
});

test("onglets accessibles : tablist, liens tab/tabpanel et navigation aux flèches", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse([]));
  const utilisateur = userEvent.setup();
  renderPage();

  await within(screen.getByRole("tabpanel")).findByText("Aucun dossier à traiter.");

  expect(screen.getByRole("tablist")).toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(4);

  const aTraiter = screen.getByRole("tab", { name: "À traiter" });
  expect(aTraiter).toHaveAttribute("aria-controls", "validation-panel-soumise");
  expect(screen.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    "validation-onglet-soumise",
  );

  // Flèche droite : « À traiter » → « Validés ».
  aTraiter.focus();
  await utilisateur.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Validés" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: "Validés" })).toHaveFocus();

  // Flèche gauche : retour à « À traiter ».
  await utilisateur.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "À traiter" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: "À traiter" })).toHaveFocus();
});

describe("pastille « À rembourser » (US-035)", () => {
  function installerOngletValides(utilisateur: UserRead, notes: NoteValidation[]) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
      const statut = statutDeUrl(String(entree));
      if (statut === "validee") return jsonResponse(notes);
      return jsonResponse([]);
    });
    return renderPage({ utilisateur });
  }

  test("admin + onglet « Validés » : chaque carte validée affiche la pastille « À rembourser »", async () => {
    const utilisateur = userEvent.setup();
    installerOngletValides(ADMIN, [
      noteValidation({ id: 1, statut: "validee", libelle: "Dossier A" }),
      noteValidation({ id: 2, statut: "validee", libelle: "Dossier B" }),
    ]);

    await utilisateur.click(await screen.findByRole("tab", { name: "Validés" }));
    const panneau = screen.getByRole("tabpanel");
    const pastilles = await within(panneau).findAllByText("À rembourser");
    expect(pastilles).toHaveLength(2);
    // Pastille primaire, texte blanc, font-semibold, cible ≥ 44 px de haut.
    for (const pastille of pastilles) {
      expect(pastille.className).toContain("font-semibold");
      expect(pastille.className).toContain("bg-primary");
      expect(pastille.className).toContain("text-primary-foreground");
      expect(pastille.className).toContain("min-h-11");
    }
  });

  test.each(["valideur", "utilisateur"] as const)(
    "%s + onglet « Validés » : aucune pastille « À rembourser »",
    async (role) => {
      const utilisateur = userEvent.setup();
      installerOngletValides(
        { id: 10, email: "x@example.com", display_name: "X", role },
        [noteValidation({ id: 1, statut: "validee", libelle: "Dossier A" })],
      );

      await utilisateur.click(await screen.findByRole("tab", { name: "Validés" }));
      const panneau = await within(screen.getByRole("tabpanel")).findByText("Dossier A");
      expect(panneau).toBeInTheDocument();
      expect(within(screen.getByRole("tabpanel")).queryByText("À rembourser")).not.toBeInTheDocument();
    },
  );

  test("admin : la pastille n'apparaît que sur les dossiers validés, pas sur les autres onglets", async () => {
    const utilisateur = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
      const statut = statutDeUrl(String(entree));
      if (statut === "soumise") {
        return jsonResponse([noteValidation({ id: 1, statut: "soumise", proprietaire: { id: 99, display_name: "Camille" } })]);
      }
      if (statut === "validee") {
        return jsonResponse([noteValidation({ id: 2, statut: "validee", proprietaire: { id: 99, display_name: "Camille" } })]);
      }
      if (statut === "remboursee") {
        return jsonResponse([noteValidation({ id: 3, statut: "remboursee", proprietaire: { id: 99, display_name: "Camille" } })]);
      }
      return jsonResponse([]);
    });
    renderPage({ utilisateur: ADMIN });

    // Onglet « À traiter » : pas de pastille.
    await screen.findAllByRole("listitem");
    expect(within(screen.getByRole("tabpanel")).queryByText("À rembourser")).not.toBeInTheDocument();

    // Onglet « Validés » : la pastille est là.
    await utilisateur.click(screen.getByRole("tab", { name: "Validés" }));
    expect(await within(screen.getByRole("tabpanel")).findByText("À rembourser")).toBeInTheDocument();

    // Onglet « Remboursés » : plus de pastille (déjà remboursé).
    await utilisateur.click(screen.getByRole("tab", { name: "Remboursés" }));
    await within(screen.getByRole("tabpanel")).findByText("Remboursée");
    expect(within(screen.getByRole("tabpanel")).queryByText("À rembourser")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------- US-043 (maître-détail bureau) */

type EcouteurMedia = (evenement: MediaQueryListEvent) => void;

/**
 * Mock de `window.matchMedia` piloté par la largeur : `definirLargeur(px)`
 * met à jour `matches` et notifie les écouteurs, comme au redimensionnement
 * (même patron que `MiseEnPage.test.tsx`, US-042).
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

function detailValidation(
  partiel: Partial<ValidationNoteDetail> & { id: number },
): ValidationNoteDetail {
  return {
    libelle: `Dossier ${partiel.id}`,
    statut: "soumise",
    total_centimes: 18000,
    nb_depenses: 1,
    soumise_at: "2026-11-21T09:30:00Z",
    proprietaire: { id: 99, display_name: "Camille Dupont" },
    depenses: [
      {
        id: partiel.id * 100,
        libelle: "Déjeuner client",
        date_depense: "2026-11-18",
        montant_centimes: 18000,
        categorie: "repas",
        commentaire: null,
        note_id: partiel.id,
        created_at: "2026-11-18T12:00:00Z",
        updated_at: "2026-11-18T12:00:00Z",
      },
    ],
    ...partiel,
  };
}

function transitionHistorique(id: number): TransitionRead {
  return {
    id,
    acteur: { id: 99, display_name: "Camille Dupont" },
    ancien_statut: "brouillon",
    nouveau_statut: "soumise",
    motif: null,
    created_at: "2026-11-21T09:30:00Z",
  };
}

/** Page de stub pour `/validation/:id`, afin de détecter toute navigation. */
function StubDetailValidation() {
  const location = useLocation();
  return <div>DETAIL PAGE{location.pathname}</div>;
}

function renderPageAvecRoutes(options: { largeur: number; annonce?: string } = { largeur: 800 }) {
  mockLargeur(options.largeur);
  const onSessionExpiree = vi.fn();
  const utils = render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/validation",
          state: options.annonce === undefined ? undefined : { annonce: options.annonce },
        },
      ]}
    >
      <Routes>
        <Route
          path="/validation"
          element={<ValidationPage utilisateur={VALIDEUR} onSessionExpiree={onSessionExpiree} />}
        />
        <Route path="/validation/:id" element={<StubDetailValidation />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onSessionExpiree, ...utils };
}

/** Routeur d'API pour le maître-détail : file « soumise » + détails + historique. */
function apiMaitreDetail(
  notes: NoteValidation[],
  details: Record<number, ValidationNoteDetail>,
  options: { apresDecision?: NoteValidation[] } = {},
) {
  let nbDecisions = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (entree, init) => {
    const url = String(entree);
    const methode = init?.method ?? "GET";
    if (url.startsWith("/api/v1/depenses/") && url.endsWith("/justificatif")) {
      return jsonResponse({ detail: "Introuvable" }, 404);
    }
    if (url === "/api/v1/validation/notes?statut=soumise" && methode === "GET") {
      // Après une décision, la file rechargée ne contient plus le dossier traité.
      return jsonResponse(nbDecisions > 0 ? (options.apresDecision ?? []) : notes);
    }
    const matchDetail = /^\/api\/v1\/validation\/notes\/(\d+)$/.exec(url);
    if (matchDetail && methode === "GET") {
      const detail = details[Number(matchDetail[1])];
      return detail === undefined
        ? jsonResponse({ detail: "Introuvable" }, 404)
        : jsonResponse(detail);
    }
    const matchHistorique = /^\/api\/v1\/notes\/(\d+)\/historique$/.exec(url);
    if (matchHistorique && methode === "GET") {
      return jsonResponse([transitionHistorique(1)]);
    }
    if (methode === "POST" && /\/valider$/.test(url)) {
      nbDecisions += 1;
      return jsonResponse({ detail: "OK" });
    }
    if (methode === "POST" && /\/refuser$/.test(url)) {
      nbDecisions += 1;
      return jsonResponse({ detail: "OK" });
    }
    return jsonResponse([]);
  });
}

beforeEach(() => {
  // Par défaut, les tests existants tournent en mobile (largeur < 1024 px).
  mockLargeur(800);
});

describe("US-043 — maître-détail ≥ 1024 px", () => {
  test("1023 px : les cartes restent des liens vers /validation/:id (aucune navigation au clic simulé, rôle lien)", async () => {
    apiMaitreDetail(
      [noteValidation({ id: 7 }), noteValidation({ id: 8 })],
      {},
    );
    renderPageAvecRoutes({ largeur: 1023 });

    const cartes = await screen.findAllByRole("listitem");
    const hrefs = cartes.map((carte) => within(carte).getByRole("link").getAttribute("href"));
    expect(hrefs).toEqual(["/validation/7", "/validation/8"]);
    // Pas de panneau détail, pas de bouton de sélection.
    expect(screen.queryByRole("button", { name: /Dossier 7/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Aucun dossier sélectionné.")).not.toBeInTheDocument();
  });

  test("1024 px : la file s'affiche à gauche et le premier dossier est sélectionné automatiquement dans le panneau", async () => {
    apiMaitreDetail(
      [noteValidation({ id: 1, libelle: "Déplacement Paris" }), noteValidation({ id: 2, libelle: "Salon Lyon" })],
      {
        1: detailValidation({ id: 1, libelle: "Déplacement Paris" }),
        2: detailValidation({ id: 2, libelle: "Salon Lyon" }),
      },
    );
    renderPageAvecRoutes({ largeur: 1024 });

    // File : mêmes onglets, mêmes cartes, rendues en boutons sélectionnables.
    expect(screen.getByRole("tab", { name: "À traiter" })).toHaveAttribute("aria-selected", "true");
    const carte1 = await screen.findByRole("button", { name: /Déplacement Paris/ });
    expect(carte1).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Salon Lyon/ })).toHaveAttribute("aria-pressed", "false");

    // Panneau : détail du dossier 1 chargé (pas de navigation vers /validation/:id).
    const panneau = await screen.findByLabelText("Détail du dossier sélectionné");
    expect(within(panneau).getByRole("heading", { name: "Déplacement Paris" })).toBeInTheDocument();
    expect(within(panneau).getByText("Camille Dupont")).toBeInTheDocument();
    // Total du dossier (34 px) et montant de la dépense (petit) : au moins un 180,00 €.
    expect(within(panneau).getAllByText("180,00 €").length).toBeGreaterThan(0);
    expect(within(panneau).getByText("Déjeuner client")).toBeInTheDocument();
    expect(within(panneau).getByRole("heading", { name: "Historique" })).toBeInTheDocument();
    expect(within(panneau).getByRole("button", { name: "Valider" })).toBeInTheDocument();
    expect(within(panneau).getByRole("button", { name: "Refuser" })).toBeInTheDocument();
    expect(screen.queryByText(/DETAIL PAGE/)).not.toBeInTheDocument();
  });

  test("1024 px : sélectionner un dossier dans la file met à jour le panneau sans changer de page", async () => {
    apiMaitreDetail(
      [noteValidation({ id: 1, libelle: "Déplacement Paris" }), noteValidation({ id: 2, libelle: "Salon Lyon" })],
      {
        1: detailValidation({ id: 1, libelle: "Déplacement Paris" }),
        2: detailValidation({ id: 2, libelle: "Salon Lyon" }),
      },
    );
    const utilisateur = userEvent.setup();
    renderPageAvecRoutes({ largeur: 1024 });

    const carte2 = await screen.findByRole("button", { name: /Salon Lyon/ });
    await utilisateur.click(carte2);

    expect(carte2).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Déplacement Paris/ })).toHaveAttribute("aria-pressed", "false");
    const panneau = screen.getByLabelText("Détail du dossier sélectionné");
    expect(within(panneau).getByRole("heading", { name: "Salon Lyon" })).toBeInTheDocument();
    // Toujours sur /validation : aucune navigation.
    expect(screen.queryByText(/DETAIL PAGE/)).not.toBeInTheDocument();
  });

  test("1024 px : après « Valider », le dossier quitte la file et le suivant est sélectionné, avec l'annonce conservée", async () => {
    apiMaitreDetail(
      [noteValidation({ id: 1, libelle: "Déplacement Paris" }), noteValidation({ id: 2, libelle: "Salon Lyon" })],
      {
        1: detailValidation({ id: 1, libelle: "Déplacement Paris" }),
        2: detailValidation({ id: 2, libelle: "Salon Lyon" }),
      },
      { apresDecision: [noteValidation({ id: 2, libelle: "Salon Lyon" })] },
    );
    const utilisateur = userEvent.setup();
    renderPageAvecRoutes({ largeur: 1024 });

    const panneau = await screen.findByLabelText("Détail du dossier sélectionné");
    await within(panneau).findByRole("heading", { name: "Déplacement Paris" });
    await utilisateur.click(within(panneau).getByRole("button", { name: "Valider" }));
    await utilisateur.click(
      await within(screen.getByRole("dialog", { name: "Valider ce dossier ?" })).findByRole("button", { name: "Confirmer" }),
    );

    // Annonce conservée + dossier suivant sélectionné automatiquement.
    expect(await screen.findByRole("status")).toHaveTextContent("Dossier validé.");
    const carte2 = await screen.findByRole("button", { name: /Salon Lyon/ });
    await waitFor(() => expect(carte2).toHaveAttribute("aria-pressed", "true"));
    const panneauSuivant = screen.getByLabelText("Détail du dossier sélectionné");
    expect(within(panneauSuivant).getByRole("heading", { name: "Salon Lyon" })).toBeInTheDocument();
    // Le dossier validé a quitté la file « À traiter ».
    expect(screen.queryByRole("button", { name: /Déplacement Paris/ })).not.toBeInTheDocument();
    // Pas de navigation.
    expect(screen.queryByText(/DETAIL PAGE/)).not.toBeInTheDocument();
  });

  test("1024 px : après « Refuser » (motif saisi), annonce « Dossier refusé. » et dossier suivant sélectionné", async () => {
    apiMaitreDetail(
      [noteValidation({ id: 1, libelle: "Déplacement Paris" }), noteValidation({ id: 2, libelle: "Salon Lyon" })],
      {
        1: detailValidation({ id: 1, libelle: "Déplacement Paris" }),
        2: detailValidation({ id: 2, libelle: "Salon Lyon" }),
      },
      { apresDecision: [noteValidation({ id: 2, libelle: "Salon Lyon" })] },
    );
    const utilisateur = userEvent.setup();
    renderPageAvecRoutes({ largeur: 1024 });

    const panneau = await screen.findByLabelText("Détail du dossier sélectionné");
    await within(panneau).findByRole("heading", { name: "Déplacement Paris" });
    await utilisateur.click(within(panneau).getByRole("button", { name: "Refuser" }));
    const dialogue = await screen.findByRole("dialog", { name: "Refuser le dossier" });
    await utilisateur.type(within(dialogue).getByLabelText("Motif du refus"), "Justificatifs manquants");
    await utilisateur.click(within(dialogue).getByRole("button", { name: "Confirmer le refus" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Dossier refusé.");
    const carte2 = await screen.findByRole("button", { name: /Salon Lyon/ });
    await waitFor(() => expect(carte2).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByRole("button", { name: /Déplacement Paris/ })).not.toBeInTheDocument();
  });

  test("1024 px : file « À traiter » vide après décision → le panneau affiche l'état vide de la maquette", async () => {
    apiMaitreDetail(
      [noteValidation({ id: 1, libelle: "Déplacement Paris" })],
      { 1: detailValidation({ id: 1, libelle: "Déplacement Paris" }) },
      { apresDecision: [] },
    );
    const utilisateur = userEvent.setup();
    renderPageAvecRoutes({ largeur: 1024 });

    const panneau = await screen.findByLabelText("Détail du dossier sélectionné");
    await within(panneau).findByRole("heading", { name: "Déplacement Paris" });
    await utilisateur.click(within(panneau).getByRole("button", { name: "Valider" }));
    await utilisateur.click(
      await within(screen.getByRole("dialog", { name: "Valider ce dossier ?" })).findByRole("button", { name: "Confirmer" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent("Dossier validé.");
    expect(await screen.findByText("Aucun dossier sélectionné.")).toBeInTheDocument();
    expect(screen.getByText("Sélectionnez un dossier dans la file.")).toBeInTheDocument();
    expect(screen.getByText("Aucun dossier à traiter.")).toBeInTheDocument();
  });

  test("1024 px : file « À traiter » vide au chargement → état vide du panneau, aucune sélection", async () => {
    apiMaitreDetail([], {});
    renderPageAvecRoutes({ largeur: 1024 });

    expect(await screen.findByText("Aucun dossier à traiter.")).toBeInTheDocument();
    expect(await screen.findByText("Aucun dossier sélectionné.")).toBeInTheDocument();
    expect(screen.getByText("Sélectionnez un dossier dans la file.")).toBeInTheDocument();
  });

  test("1024 px : erreur 403 sur la décision → message du serveur dans l'alerte, sans « Réessayer », sélection inchangée", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (entree, init) => {
      const url = String(entree);
      const methode = init?.method ?? "GET";
      if (url.startsWith("/api/v1/depenses/") && url.endsWith("/justificatif")) {
        return jsonResponse({ detail: "Introuvable" }, 404);
      }
      if (url === "/api/v1/validation/notes?statut=soumise") {
        return jsonResponse([noteValidation({ id: 1, libelle: "Déplacement Paris" })]);
      }
      if (/^\/api\/v1\/validation\/notes\/\d+$/.test(url)) {
        return jsonResponse(detailValidation({ id: 1, libelle: "Déplacement Paris" }));
      }
      if (/\/historique$/.test(url)) return jsonResponse([transitionHistorique(1)]);
      if (methode === "POST" && /\/valider$/.test(url)) {
        return jsonResponse({ detail: "Vous ne pouvez pas valider votre propre dossier." }, 403);
      }
      return jsonResponse([]);
    });
    const utilisateur = userEvent.setup();
    renderPageAvecRoutes({ largeur: 1024 });

    const panneau = await screen.findByLabelText("Détail du dossier sélectionné");
    await within(panneau).findByRole("heading", { name: "Déplacement Paris" });
    await utilisateur.click(within(panneau).getByRole("button", { name: "Valider" }));
    await utilisateur.click(
      await within(screen.getByRole("dialog", { name: "Valider ce dossier ?" })).findByRole("button", { name: "Confirmer" }),
    );

    const alerte = await within(panneau).findByRole("alert");
    expect(alerte).toHaveTextContent("Vous ne pouvez pas valider votre propre dossier.");
    expect(within(panneau).queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
    // Pas de resélection : le dossier reste sélectionné.
    expect(screen.getByRole("button", { name: /Déplacement Paris/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("1024 px : 401 sur la décision → onSessionExpiree appelée", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (entree, init) => {
      const url = String(entree);
      const methode = init?.method ?? "GET";
      if (url === "/api/v1/validation/notes?statut=soumise") {
        return jsonResponse([noteValidation({ id: 1, libelle: "Déplacement Paris" })]);
      }
      if (/^\/api\/v1\/validation\/notes\/\d+$/.test(url)) {
        return jsonResponse(detailValidation({ id: 1, libelle: "Déplacement Paris" }));
      }
      if (/\/historique$/.test(url)) return jsonResponse([transitionHistorique(1)]);
      if (methode === "POST") return jsonResponse({ detail: "Session expirée." }, 401);
      if (url.startsWith("/api/v1/depenses/") && url.endsWith("/justificatif")) {
        return jsonResponse({ detail: "Introuvable" }, 404);
      }
      return jsonResponse([]);
    });
    const utilisateur = userEvent.setup();
    const { onSessionExpiree } = renderPageAvecRoutes({ largeur: 1024 });

    const panneau = await screen.findByLabelText("Détail du dossier sélectionné");
    await within(panneau).findByRole("heading", { name: "Déplacement Paris" });
    await utilisateur.click(within(panneau).getByRole("button", { name: "Valider" }));
    await utilisateur.click(
      await within(screen.getByRole("dialog", { name: "Valider ce dossier ?" })).findByRole("button", { name: "Confirmer" }),
    );

    await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
  });

  test("1024 px : les autres onglets restent fonctionnels (mêmes données, mêmes cartes)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
      const url = String(entree);
      const statut = statutDeUrl(url);
      if (url.startsWith("/api/v1/depenses/") && url.endsWith("/justificatif")) {
        return jsonResponse({ detail: "Introuvable" }, 404);
      }
      if (/^\/api\/v1\/validation\/notes\/\d+$/.test(url)) {
        return jsonResponse(detailValidation({ id: 1, libelle: "Déplacement Paris" }));
      }
      if (/\/historique$/.test(url)) return jsonResponse([transitionHistorique(1)]);
      if (statut === "validee") {
        return jsonResponse([noteValidation({ id: 5, statut: "validee", libelle: "Dossier validé A" })]);
      }
      if (statut === "soumise") {
        return jsonResponse([noteValidation({ id: 1, libelle: "Déplacement Paris" })]);
      }
      return jsonResponse([]);
    });
    const utilisateur = userEvent.setup();
    renderPageAvecRoutes({ largeur: 1024 });

    await screen.findByRole("button", { name: /Déplacement Paris/ });
    await utilisateur.click(screen.getByRole("tab", { name: "Validés" }));
    expect(await screen.findByRole("button", { name: /Dossier validé A/ })).toBeInTheDocument();
  });
});
