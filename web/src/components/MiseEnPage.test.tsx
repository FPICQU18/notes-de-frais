/// <reference types="node" />
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter, Link, Route, Routes } from "react-router";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
            path="/depenses/nouvelle"
            element={<div>Formulaire nouvelle dépense</div>}
          />
          <Route path="/depenses/:id" element={<div>Formulaire modification</div>} />
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

/* --------------------------------------------------------- US-042 (bureau) */

type Ecouteur = (evenement: MediaQueryListEvent) => void;

/**
 * Mock de `window.matchMedia` piloté par la largeur : `definirLargeur(px)`
 * met à jour `matches` et notifie les écouteurs, comme au redimensionnement.
 */
function mockLargeur(largeurInitiale: number) {
  let largeur = largeurInitiale;
  const ecouteurs = new Set<Ecouteur>();
  vi.stubGlobal("matchMedia", (requete: string) => {
    const correspond = () =>
      requete === "(min-width: 1024px)" ? largeur >= 1024 : false;
    return {
      get matches() {
        return correspond();
      },
      media: requete,
      addEventListener: (_: string, ecouteur: Ecouteur) => ecouteurs.add(ecouteur),
      removeEventListener: (_: string, ecouteur: Ecouteur) => ecouteurs.delete(ecouteur),
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

function barreLaterale(): HTMLElement {
  return document.querySelector("nav.barre-laterale") as HTMLElement;
}

function barreFlottante(): HTMLElement | null {
  return document.querySelector("nav.barre-navigation");
}

beforeEach(() => {
  // Par défaut, les tests existants tournent en mobile (largeur < 1024 px).
  mockLargeur(800);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  // Restaure un état de visibilité « visible » (jsdom le laisse à « visible",
  // mais un test peut l'avoir forcé à « hidden » via Object.defineProperty).
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  document.dispatchEvent(new Event("visibilitychange"));
});

test("US-042 — 1023 px : barre flottante présente, pas de barre latérale", async () => {
  mockLargeur(1023);
  mockValidation([]);
  renderMiseEnPage(UTILISATEUR);

  expect(await screen.findByRole("link", { name: "Accueil" })).toBeInTheDocument();
  expect(barreFlottante()).not.toBeNull();
  expect(barreLaterale()).toBeNull();
  expect(barreFlottante()?.className).toContain("print:hidden");
});

test("US-042 — 1024 px : le conteneur de contenu est centré dans l'espace restant (marge gauche de la barre) et limité à 1100 px", async () => {
  mockLargeur(1024);
  mockValidation([]);
  const { container } = renderMiseEnPage(UTILISATEUR);

  await screen.findByRole("link", { name: "Accueil" });
  const contenu = container.querySelector(".mise-en-page__contenu") as HTMLElement;
  expect(contenu).not.toBeNull();
  // La feuille de style de l'application (index.css), lue telle qu'écrite
  // sur disque (cwd = racine web) : elle contient la media query bureau.
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf-8");
  expect(css).toContain("@media (min-width: 1024px)");
  const bloc = css.slice(css.indexOf("@media (min-width: 1024px)"));
  expect(bloc).toContain("max-width: 1100px");
  expect(bloc).toContain("margin-inline: auto");
  expect(bloc).toContain("margin-left: 280px");
  // Formulaire 640 px en bureau.
  expect(bloc).toMatch(/\.formulaire-depense[^}]*max-width: 640px/s);
  expect(bloc).toMatch(/\.carte-connexion[^}]*max-width: 640px/s);
});

test("US-042 — < 1024 px : la règle de base du conteneur reste max-width 26 rem, centré", () => {
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf-8");
  const base = css.slice(0, css.indexOf("@media (min-width: 1024px)"));
  expect(base).toMatch(/\.mise-en-page\s*\{[^}]*max-width: 26rem[^}]*margin-inline: auto[^}]*\}/s);
});

test("US-042 — 1024 px : barre latérale fixe, pas de barre flottante, pastille visible pour un valideur", async () => {
  mockLargeur(1024);
  mockValidation([note(1, 1), note(2, 2), note(3, 1)]);
  renderMiseEnPage(VALIDEUR);

  const lien = await screen.findByRole("link", { name: "Validation, 2 dossiers à traiter" });
  const laterale = barreLaterale();
  expect(laterale).not.toBeNull();
  expect(laterale?.className).toContain("print:hidden");
  expect(barreFlottante()).toBeNull();
  // Mêmes entrées que la barre mobile, plus le bouton « Nouvelle dépense » en tête.
  expect(within(laterale as HTMLElement).getByRole("link", { name: "Accueil" })).toBeInTheDocument();
  expect(within(laterale as HTMLElement).getByRole("link", { name: "Dépenses" })).toBeInTheDocument();
  expect(within(laterale as HTMLElement).getByRole("link", { name: "Nouvelle dépense" })).toBeInTheDocument();
  expect(within(laterale as HTMLElement).getByRole("link", { name: "Dossiers" })).toBeInTheDocument();
  expect(within(laterale as HTMLElement).getByText("2")).toHaveAttribute("aria-hidden", "true");
  expect(lien.className).toContain("barre-laterale__lien");
});

test("US-042 — 1024 px, rôle utilisateur : entrée Profil au lieu de Validation", async () => {
  mockLargeur(1024);
  mockValidation([]);
  renderMiseEnPage(UTILISATEUR);

  const laterale = await screen.findByRole("navigation", { name: "Navigation principale" });
  expect(within(laterale).getByRole("link", { name: "Profil" })).toBeInTheDocument();
  expect(within(laterale).queryByRole("link", { name: /^Validation/ })).not.toBeInTheDocument();
});

test("US-042 — changement dynamique de largeur : 1024 → 900 bascule vers la barre flottante", async () => {
  const media = mockLargeur(1024);
  mockValidation([]);
  renderMiseEnPage(UTILISATEUR);

  expect(await screen.findByRole("link", { name: "Accueil" })).toBeInTheDocument();
  expect(barreLaterale()).not.toBeNull();
  expect(barreFlottante()).toBeNull();

  act(() => media.definirLargeur(900));
  expect(barreLaterale()).toBeNull();
  expect(barreFlottante()).not.toBeNull();

  act(() => media.definirLargeur(1440));
  expect(barreLaterale()).not.toBeNull();
  expect(barreFlottante()).toBeNull();
});

test("US-042 — 1024 px sur un formulaire de dépense : la barre latérale reste visible", async () => {
  mockLargeur(1024);
  mockValidation([]);
  renderMiseEnPage(UTILISATEUR, { url: "/depenses/nouvelle" });

  expect(await screen.findByText("Formulaire nouvelle dépense")).toBeInTheDocument();
  expect(barreLaterale()).not.toBeNull();
  expect(barreFlottante()).toBeNull();
});

test("US-042 — 800 px sur un formulaire de dépense : la barre flottante est masquée (comportement actuel inchangé)", async () => {
  mockLargeur(800);
  mockValidation([]);
  renderMiseEnPage(UTILISATEUR, { url: "/depenses/7" });

  expect(await screen.findByText("Formulaire modification")).toBeInTheDocument();
  expect(barreFlottante()).toBeNull();
  expect(barreLaterale()).toBeNull();
});

test("US-042 — la pastille garde son comportement en mode bureau (rafraîchie à la navigation)", async () => {
  const media = mockLargeur(1024);
  const { notesCourantes } = mockValidation([note(1, 1), note(2, 1)]);
  const utilisateur = userEvent.setup();
  renderMiseEnPage(VALIDEUR);

  expect(await screen.findByRole("link", { name: "Validation, 2 dossiers à traiter" })).toBeInTheDocument();

  notesCourantes.liste = [note(1, 1)];
  await utilisateur.click(screen.getByRole("link", { name: /^Validation/ }));
  await utilisateur.click(await screen.findByRole("link", { name: "Détail 5" }));
  await utilisateur.click(await screen.findByRole("link", { name: "Retour à la liste" }));

  expect(await screen.findByRole("link", { name: "Validation, 1 dossier à traiter" })).toBeInTheDocument();
  act(() => media.definirLargeur(800));
  expect(await screen.findByRole("link", { name: "Validation, 1 dossier à traiter" })).toBeInTheDocument();
  expect(barreFlottante()).not.toBeNull();
});

type FetchMock = ReturnType<typeof vi.spyOn> & {
  mock: { calls: [RequestInfo | URL, (RequestInit | undefined)?][] };
};

function compterAppelsValidation(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(([entree]: [RequestInfo | URL, RequestInit?]) =>
    String(entree).includes("/api/v1/validation/notes?statut=soumise"),
  ).length;
}

function definirVisibilite(etat: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => etat,
  });
}

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

test("l'appli redevient visible (visibilitychange) : le compteur est rechargé et la pastille mise à jour", async () => {
  const { fetchMock, notesCourantes } = mockValidation([note(1, 1), note(2, 1)]);
  renderMiseEnPage(VALIDEUR);

  expect(await screen.findByRole("link", { name: "Validation, 2 dossiers à traiter" })).toBeInTheDocument();
  expect(compterAppelsValidation(fetchMock)).toBe(1);

  // Un collègue a soumis un troisième dossier pendant que l'onglet était caché.
  definirVisibilite("hidden");
  notesCourantes.liste = [note(1, 1), note(2, 1), note(3, 1)];
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Toujours caché : aucun rechargement.
  expect(compterAppelsValidation(fetchMock)).toBe(1);

  // L'onglet redevient visible : nouvel appel, pastille à jour.
  definirVisibilite("visible");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await screen.findByRole("link", { name: "Validation, 3 dossiers à traiter" })).toBeInTheDocument();
  expect(compterAppelsValidation(fetchMock)).toBe(2);
});

test("rafraîchissement toutes les 60 s tant que l'onglet est visible ; aucun appel si redevenu caché", async () => {
  vi.useFakeTimers();
  const { fetchMock, notesCourantes } = mockValidation([note(1, 1)]);
  renderMiseEnPage(VALIDEUR);

  // Chargement initial (promesse résolue malgré les timers factices).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(compterAppelsValidation(fetchMock)).toBe(1);
  expect(screen.getByRole("link", { name: "Validation, 1 dossier à traiter" })).toBeInTheDocument();

  // 60 s au premier plan : rechargement.
  notesCourantes.liste = [note(1, 1), note(2, 1)];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(compterAppelsValidation(fetchMock)).toBe(2);
  expect(screen.getByRole("link", { name: "Validation, 2 dossiers à traiter" })).toBeInTheDocument();

  // 60 s de plus alors que l'onglet est redevenu caché : aucun appel.
  definirVisibilite("hidden");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(compterAppelsValidation(fetchMock)).toBe(2);

  // Redevenu visible, 60 s plus tard : rechargement.
  definirVisibilite("visible");
  notesCourantes.liste = [note(1, 1), note(2, 1), note(3, 1)];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(compterAppelsValidation(fetchMock)).toBe(3);
  expect(screen.getByRole("link", { name: "Validation, 3 dossiers à traiter" })).toBeInTheDocument();
});

test("démontage du composant : intervalle et écouteur retirés, plus aucun appel après 60 s", async () => {
  vi.useFakeTimers();
  const { fetchMock } = mockValidation([note(1, 1)]);
  const { unmount } = renderMiseEnPage(VALIDEUR);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(compterAppelsValidation(fetchMock)).toBe(1);

  unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(compterAppelsValidation(fetchMock)).toBe(1);
});

test("401 lors d'un rechargement (visibilitychange) : onSessionExpiree est appelé", async () => {
  let reponse401 = false;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((entree) => {
    const url = String(entree);
    if (url.includes("/api/v1/validation/notes")) {
      return Promise.resolve(
        reponse401
          ? jsonResponse({ detail: "Session expirée." }, 401)
          : jsonResponse([note(1, 1)]),
      );
    }
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
  const onSessionExpiree = vi.fn();
  renderMiseEnPage(VALIDEUR, { onSessionExpiree });

  expect(await screen.findByRole("link", { name: "Validation, 1 dossier à traiter" })).toBeInTheDocument();
  expect(onSessionExpiree).not.toHaveBeenCalled();

  reponse401 = true;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalledTimes(1));
  expect(compterAppelsValidation(fetchMock)).toBe(2);
});

test("erreur non-401 lors d'un rechargement : le compteur courant est conservé", async () => {
  let erreur = false;
  vi.spyOn(globalThis, "fetch").mockImplementation((entree) => {
    const url = String(entree);
    if (url.includes("/api/v1/validation/notes")) {
      return erreur
        ? Promise.reject(new Error("réseau"))
        : Promise.resolve(jsonResponse([note(1, 1), note(2, 1)]));
    }
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
  renderMiseEnPage(VALIDEUR);

  expect(await screen.findByRole("link", { name: "Validation, 2 dossiers à traiter" })).toBeInTheDocument();

  erreur = true;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => {
    await Promise.resolve();
  });
  // Toujours 2 : pas de pastille fantôme après l'échec du rechargement.
  expect(await screen.findByRole("link", { name: "Validation, 2 dossiers à traiter" })).toBeInTheDocument();
});

test("rôle utilisateur : aucun intervalle ni écouteur de visibilité (aucun appel même après 60 s ou visibilitychange)", async () => {
  vi.useFakeTimers();
  const { fetchMock } = mockValidation([note(1, 2)]);
  renderMiseEnPage(UTILISATEUR);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(compterAppelsValidation(fetchMock)).toBe(0);
  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  expect(within(nav).queryByRole("link", { name: /^Validation/ })).not.toBeInTheDocument();
});
