import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";

import type { NoteValidation, UserRead } from "../api/client";
import { ValidationPage } from "./ValidationPage";

const VALIDEUR: UserRead = {
  id: 10,
  email: "valideur@example.com",
  display_name: "Valideur",
  role: "valideur",
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
