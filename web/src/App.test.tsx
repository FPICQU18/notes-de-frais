import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { AppRoutes } from "./App";
import type { UserRead } from "./api/client";

const UTILISATEUR: UserRead = {
  id: 1,
  email: "camille@example.com",
  display_name: "Camille",
  role: "utilisateur",
};

const VALIDEUR: UserRead = {
  id: 2,
  email: "valideur@example.com",
  display_name: "Valideur",
  role: "valideur",
};

const ADMIN: UserRead = {
  id: 3,
  email: "admin@example.com",
  display_name: "Admin",
  role: "admin",
};

const MOT_DE_PASSE_VALIDE = "motdepasse";

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

function aucunAppelHealth(appels: Parameters<typeof fetch>[]): void {
  expect(appels.some(([entree]) => String(entree).includes("/api/health"))).toBe(false);
}

/**
 * Simule l'API d'authentification : une session en mémoire, comme le vrai
 * serveur. `/me` répond selon la session, `login` l'ouvre, `logout` la ferme.
 */
function mockApi(sessionInitiale: UserRead | null = null) {
  let session: UserRead | null = sessionInitiale;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (entree: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entree);
      const methode = init?.method ?? "GET";
      if (url.endsWith("/api/v1/auth/me") && methode === "GET") {
        return session === null
          ? jsonResponse({ detail: "Authentification requise." }, 401)
          : jsonResponse(session);
      }
      if (url.endsWith("/api/v1/auth/login") && methode === "POST") {
        const corps = JSON.parse(String(init?.body ?? "{}")) as {
          email?: string;
          password?: string;
        };
        if (corps.email === UTILISATEUR.email && corps.password === MOT_DE_PASSE_VALIDE) {
          session = UTILISATEUR;
          return jsonResponse(UTILISATEUR);
        }
        return jsonResponse({ detail: "E-mail ou mot de passe incorrect." }, 401);
      }
      if (url.endsWith("/api/v1/auth/logout") && methode === "POST") {
        session = null;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/v1/depenses") && methode === "GET") {
        return jsonResponse([]);
      }
      if (/\/api\/v1\/depenses\/\d+$/.test(url) && methode === "GET") {
        return jsonResponse({
          id: 1,
          libelle: "Déjeuner",
          date_depense: "2026-11-15",
          montant_centimes: 2450,
          categorie: "repas",
          commentaire: null,
          note_id: null,
          created_at: "2026-11-15T12:00:00Z",
          updated_at: "2026-11-15T12:00:00Z",
        });
      }
      if (/\/api\/v1\/validation\/notes\/\d+$/.test(url) && methode === "GET") {
        return jsonResponse({
          id: 123,
          libelle: "Dossier 123",
          statut: "soumise",
          total_centimes: 0,
          nb_depenses: 0,
          soumise_at: "2026-11-18T12:00:00Z",
          proprietaire: { id: 1, display_name: "Camille" },
          depenses: [],
        });
      }
      if (url.includes("/api/v1/validation/notes") && methode === "GET") {
        return jsonResponse([]);
      }
      if (/\/api\/v1\/notes\/\d+\/historique$/.test(url) && methode === "GET") {
        return jsonResponse([]);
      }
      if (/\/api\/v1\/notes\/\d+\/valider$/.test(url) && methode === "POST") {
        return new Response(null, { status: 204 });
      }
      if (/\/api\/v1\/notes\/\d+\/refuser$/.test(url) && methode === "POST") {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/v1/notes") && methode === "GET") {
        return jsonResponse([]);
      }
      if (url.split("?")[0].endsWith("/api/v1/users") && methode === "GET") {
        return jsonResponse([
          {
            id: session?.id ?? 1,
            email: session?.email ?? "camille@example.com",
            display_name: session?.display_name ?? "Camille",
            role: session?.role ?? "utilisateur",
            is_active: true,
            created_at: "2026-11-01T10:00:00Z",
          },
        ]);
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    },
  );
  return fetchMock;
}

function renderApp(url = "/") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("connexion réussie : /me 401, login 200, accueil « Bonjour … »", async () => {
  const fetchMock = mockApi(null);
  const utilisateur = userEvent.setup();
  renderApp();

  expect(await screen.findByLabelText("Adresse e-mail")).toBeInTheDocument();

  await utilisateur.type(screen.getByLabelText("Adresse e-mail"), UTILISATEUR.email);
  await utilisateur.type(screen.getByLabelText("Mot de passe"), MOT_DE_PASSE_VALIDE);
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  expect(await screen.findByRole("heading", { name: "Bonjour Camille" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Adresse e-mail")).not.toBeInTheDocument();
  aucunAppelHealth(fetchMock.mock.calls);
});

test("échec 401 : message API affiché, focus sur l'alerte, valeurs conservées", async () => {
  const fetchMock = mockApi(null);
  const utilisateur = userEvent.setup();
  renderApp();

  await screen.findByLabelText("Adresse e-mail");
  await utilisateur.type(screen.getByLabelText("Adresse e-mail"), UTILISATEUR.email);
  await utilisateur.type(screen.getByLabelText("Mot de passe"), "mauvais");
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  const alerte = await screen.findByRole("alert");
  expect(alerte).toHaveTextContent("E-mail ou mot de passe incorrect.");
  await waitFor(() => expect(alerte).toHaveFocus());

  expect(screen.getByLabelText("Adresse e-mail")).toHaveValue(UTILISATEUR.email);
  expect(screen.getByLabelText("Mot de passe")).toHaveValue("mauvais");
  expect(screen.getByLabelText("Adresse e-mail")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Adresse e-mail")).toHaveAttribute(
    "aria-describedby",
    "erreur-connexion",
  );
  expect(screen.getByLabelText("Mot de passe")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Mot de passe")).toHaveAttribute(
    "aria-describedby",
    "erreur-connexion",
  );
  expect(screen.getByRole("button", { name: "Se connecter" })).toBeInTheDocument();
  aucunAppelHealth(fetchMock.mock.calls);
});

test("soumission en cours : bouton désactivé « Connexion… » avec aria-busy puis accueil", async () => {
  let resoudreLogin!: (reponse: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const url = String(entree);
    if (url.endsWith("/api/v1/auth/me")) {
      return jsonResponse({ detail: "Authentification requise." }, 401);
    }
    if (url.endsWith("/api/v1/auth/login")) {
      return new Promise<Response>((resoudre) => {
        resoudreLogin = resoudre;
      });
    }
    return jsonResponse({ detail: "Introuvable" }, 404);
  });
  const utilisateur = userEvent.setup();
  renderApp();

  await screen.findByLabelText("Adresse e-mail");
  await utilisateur.type(screen.getByLabelText("Adresse e-mail"), UTILISATEUR.email);
  await utilisateur.type(screen.getByLabelText("Mot de passe"), MOT_DE_PASSE_VALIDE);
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  const bouton = await screen.findByRole("button", { name: "Connexion…" });
  expect(bouton).toBeDisabled();
  expect(bouton).toHaveAttribute("aria-busy", "true");

  resoudreLogin(jsonResponse(UTILISATEUR));
  expect(await screen.findByRole("heading", { name: "Bonjour Camille" })).toBeInTheDocument();
});

test("échec réseau à la connexion : « Serveur injoignable… », focus et saisie conservée", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const url = String(entree);
    if (url.endsWith("/api/v1/auth/me")) {
      return jsonResponse({ detail: "Authentification requise." }, 401);
    }
    if (url.endsWith("/api/v1/auth/login")) {
      throw new Error("réseau");
    }
    return jsonResponse({ detail: "Introuvable" }, 404);
  });
  const utilisateur = userEvent.setup();
  renderApp();

  await screen.findByLabelText("Adresse e-mail");
  await utilisateur.type(screen.getByLabelText("Adresse e-mail"), UTILISATEUR.email);
  await utilisateur.type(screen.getByLabelText("Mot de passe"), MOT_DE_PASSE_VALIDE);
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  const alerte = await screen.findByRole("alert");
  expect(alerte).toHaveTextContent("Serveur injoignable. Vérifiez votre connexion.");
  await waitFor(() => expect(alerte).toHaveFocus());
  expect(screen.getByLabelText("Adresse e-mail")).toHaveValue(UTILISATEUR.email);
  expect(screen.getByLabelText("Mot de passe")).toHaveValue(MOT_DE_PASSE_VALIDE);
  expect(screen.getByRole("button", { name: "Se connecter" })).toBeInTheDocument();
});

test("session ouverte sur /connexion : redirigé vers l'accueil sans formulaire", async () => {
  mockApi(UTILISATEUR);
  renderApp("/connexion");

  expect(await screen.findByRole("heading", { name: "Bonjour Camille" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Adresse e-mail")).not.toBeInTheDocument();
});

test("session existante : /me 200 mène directement à l'accueil sans login", async () => {
  const fetchMock = mockApi(UTILISATEUR);
  renderApp();

  expect(await screen.findByRole("heading", { name: "Bonjour Camille" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Adresse e-mail")).not.toBeInTheDocument();

  const appelsLogin = fetchMock.mock.calls.filter(([entree]) =>
    String(entree).includes("/api/v1/auth/login"),
  );
  expect(appelsLogin).toHaveLength(0);
  aucunAppelHealth(fetchMock.mock.calls);
});

test("déconnexion : logout appelé puis retour à la connexion avec champs vides", async () => {
  const fetchMock = mockApi(UTILISATEUR);
  const utilisateur = userEvent.setup();
  renderApp();

  await screen.findByRole("heading", { name: "Bonjour Camille" });
  await utilisateur.click(screen.getByRole("button", { name: "Se déconnecter" }));

  expect(await screen.findByLabelText("Adresse e-mail")).toBeInTheDocument();

  const appelsLogout = fetchMock.mock.calls.filter(([entree]) =>
    String(entree).includes("/api/v1/auth/logout"),
  );
  expect(appelsLogout).toHaveLength(1);
  expect(screen.getByLabelText("Adresse e-mail")).toHaveValue("");
  expect(screen.getByLabelText("Mot de passe")).toHaveValue("");
  aucunAppelHealth(fetchMock.mock.calls);
});

test("session expirée (401 sur un appel de l'accueil) : retour à la connexion sans boucle", async () => {
  let appelsAccueil = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const url = String(entree);
    if (url.endsWith("/api/v1/auth/me")) {
      return jsonResponse(UTILISATEUR);
    }
    appelsAccueil += 1;
    // Les appels métier de l'accueil renvoient 401 : session expirée.
    return jsonResponse({ detail: "Session expirée." }, 401);
  });
  renderApp();

  expect(await screen.findByLabelText("Adresse e-mail")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Bonjour Camille" })).not.toBeInTheDocument();

  await waitFor(() => expect(appelsAccueil).toBe(3));
  expect(appelsAccueil).toBe(3);
});

test("réponse 422 : le premier message de detail[] est affiché, sans JSON brut", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const url = String(entree);
    if (url.endsWith("/api/v1/auth/me")) {
      return jsonResponse({ detail: "Authentification requise." }, 401);
    }
    if (url.endsWith("/api/v1/auth/login")) {
      return jsonResponse(
        { detail: [{ msg: "Le mot de passe est requis." }, { msg: "Autre" }] },
        422,
      );
    }
    return jsonResponse({ detail: "Introuvable" }, 404);
  });
  const utilisateur = userEvent.setup();
  renderApp();

  await screen.findByLabelText("Adresse e-mail");
  await utilisateur.type(screen.getByLabelText("Adresse e-mail"), UTILISATEUR.email);
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  const alerte = await screen.findByRole("alert");
  expect(alerte).toHaveTextContent("Le mot de passe est requis.");
  expect(alerte).not.toHaveTextContent("[");
  expect(alerte).not.toHaveTextContent("undefined");
});

test("erreur réseau au chargement : écran d'erreur avec « Réessayer »", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau"));
  renderApp();

  expect(await screen.findByRole("heading", { name: "Service indisponible" })).toBeInTheDocument();
  expect(screen.getByText("Serveur injoignable. Vérifiez votre connexion.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
});

test("échec /me 500 puis « Réessayer » rejoue la vérification vers l'accueil", async () => {
  let appelsMe = 0;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (entree) => {
    const url = String(entree);
    if (url.includes("/api/v1/auth/me")) {
      appelsMe += 1;
      if (appelsMe === 1) {
        return jsonResponse({ detail: "Erreur interne" }, 500);
      }
      return jsonResponse(UTILISATEUR);
    }
    return jsonResponse({ detail: "Introuvable" }, 404);
  });
  const utilisateur = userEvent.setup();
  renderApp();

  expect(await screen.findByRole("heading", { name: "Service indisponible" })).toBeInTheDocument();
  await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));

  expect(await screen.findByRole("heading", { name: "Bonjour Camille" })).toBeInTheDocument();
  expect(appelsMe).toBeGreaterThanOrEqual(2);
  aucunAppelHealth(fetchMock.mock.calls);
});

test("utilisateur : la navigation montre Accueil, Dépenses, Dossiers et Profil, pas Validation", async () => {
  mockApi(UTILISATEUR);
  renderApp();

  await screen.findByRole("heading", { name: "Bonjour Camille" });

  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  expect(within(nav).getByRole("link", { name: "Accueil" })).toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "Dépenses" })).toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "Dossiers" })).toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "Profil" })).toBeInTheDocument();
  expect(within(nav).queryByRole("link", { name: "Validation" })).not.toBeInTheDocument();
});

test("utilisateur : cliquer Dossiers affiche le titre et marque l'onglet actif", async () => {
  mockApi(UTILISATEUR);
  const utilisateur = userEvent.setup();
  renderApp();

  await screen.findByRole("heading", { name: "Bonjour Camille" });
  await utilisateur.click(screen.getByRole("link", { name: "Dossiers" }));

  expect(await screen.findByRole("heading", { name: "Dossiers" })).toBeInTheDocument();
  expect(
    screen.getByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation."),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Dossiers" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("valideur : Validation affiché sans Profil ; cliquer Validation affiche la page", async () => {
  mockApi(VALIDEUR);
  const utilisateur = userEvent.setup();
  renderApp();

  await screen.findByRole("heading", { name: "Bonjour Valideur" });

  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  expect(within(nav).getByRole("link", { name: "Validation" })).toBeInTheDocument();
  expect(within(nav).queryByRole("link", { name: "Profil" })).not.toBeInTheDocument();

  await utilisateur.click(within(nav).getByRole("link", { name: "Validation" }));

  expect(await screen.findByRole("heading", { name: "Validation" })).toBeInTheDocument();
  // L'onglet « À traiter » est actif et son état vide est annoncé.
  expect(await screen.findByRole("tab", { name: "À traiter" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await screen.findByText("Aucun dossier à traiter.")).toBeInTheDocument();
});

test("admin : Validation affiché et Profil absent", async () => {
  mockApi(ADMIN);
  renderApp();

  await screen.findByRole("heading", { name: "Bonjour Admin" });

  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  expect(within(nav).getByRole("link", { name: "Validation" })).toBeInTheDocument();
  expect(within(nav).queryByRole("link", { name: "Profil" })).not.toBeInTheDocument();
});

test("valideur sur /validation/123 : affiche le détail du dossier", async () => {
  mockApi(VALIDEUR);
  renderApp("/validation/123");

  expect(await screen.findByRole("heading", { name: "Dossier 123" })).toBeInTheDocument();
});

test("valider un dossier : POST /valider puis annonce « Dossier validé. » dans un role=status", async () => {
  mockApi(VALIDEUR);
  const utilisateur = userEvent.setup();
  renderApp("/validation/123");

  await utilisateur.click(await screen.findByRole("button", { name: "Valider" }));
  await utilisateur.click(screen.getByRole("button", { name: "Confirmer" }));

  expect(await screen.findByRole("status")).toHaveTextContent("Dossier validé.");
});

test("refuser un dossier : POST /refuser puis annonce « Dossier refusé. » dans un role=status", async () => {
  mockApi(VALIDEUR);
  const utilisateur = userEvent.setup();
  renderApp("/validation/123");

  await utilisateur.click(await screen.findByRole("button", { name: "Refuser" }));
  const dialogue = screen.getByRole("dialog");
  await utilisateur.type(within(dialogue).getByLabelText("Motif du refus"), "Justificatif manquant");
  await utilisateur.click(within(dialogue).getByRole("button", { name: "Confirmer le refus" }));

  expect(await screen.findByRole("status")).toHaveTextContent("Dossier refusé.");
});

test("accueil connecté : le bouton « + » mène à la saisie d'une dépense", async () => {
  mockApi(UTILISATEUR);
  const utilisateur = userEvent.setup();
  renderApp();

  await screen.findByRole("heading", { name: "Bonjour Camille" });
  await utilisateur.click(screen.getByRole("link", { name: "Ajouter une dépense" }));

  expect(await screen.findByRole("heading", { name: "Nouvelle dépense" })).toBeInTheDocument();
});

test("utilisateur sur /validation : redirigé vers l'accueil, sans onglet Validation", async () => {
  mockApi(UTILISATEUR);
  renderApp("/validation");

  expect(await screen.findByRole("heading", { name: "Bonjour Camille" })).toBeInTheDocument();

  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  expect(within(nav).queryByRole("link", { name: "Validation" })).not.toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "Profil" })).toBeInTheDocument();
});

test("utilisateur : les 5 emplacements de la barre sont dans le bon ordre", async () => {
  mockApi(UTILISATEUR);
  renderApp();

  await screen.findByRole("heading", { name: "Bonjour Camille" });

  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  const libelles = within(nav)
    .getAllByRole("link")
    .map((lien) => lien.getAttribute("aria-label"));

  expect(libelles).toEqual([
    "Accueil",
    "Dépenses",
    "Ajouter une dépense",
    "Dossiers",
    "Profil",
  ]);
});

test("valideur sur /profil : la page Profil s'affiche (pas de redirection)", async () => {
  mockApi(VALIDEUR);
  renderApp("/profil");

  expect(await screen.findByRole("heading", { name: "Profil" })).toBeInTheDocument();
  expect(screen.getByText("valideur@example.com")).toBeInTheDocument();
  // Pastille de rôle « Valideur » (et non le nom affiché, identique ici).
  expect(screen.getByText("Valideur", { selector: "span" })).toBeInTheDocument();

  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  expect(within(nav).queryByRole("link", { name: "Profil" })).not.toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "Validation" })).toBeInTheDocument();
});

test("admin sur /profil : la page Profil s'affiche avec le lien « Gérer les comptes »", async () => {
  mockApi(ADMIN);
  renderApp("/profil");

  expect(await screen.findByRole("heading", { name: "Profil" })).toBeInTheDocument();
  expect(screen.getByText("admin@example.com")).toBeInTheDocument();
  expect(screen.getByText("Admin", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Gérer les comptes" })).toHaveAttribute(
    "href",
    "/admin/comptes",
  );

  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  expect(within(nav).queryByRole("link", { name: "Profil" })).not.toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "Validation" })).toBeInTheDocument();
});

test("utilisateur sur /depenses : titre « Dépenses », liste vide, onglet actif", async () => {
  mockApi(UTILISATEUR);
  renderApp("/depenses");

  expect(await screen.findByRole("heading", { name: "Dépenses" })).toBeInTheDocument();
  expect(await screen.findByText("Aucune dépense pour l'instant.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Dépenses" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("utilisateur sur /profil : la page Profil affiche nom, e-mail, pastille et « Se déconnecter »", async () => {
  mockApi(UTILISATEUR);
  renderApp("/profil");

  const titre = await screen.findByRole("heading", { name: "Profil" });
  expect(titre).toBeInTheDocument();
  expect(titre).toHaveFocus();
  expect(screen.getByText("Camille")).toBeInTheDocument();
  expect(screen.getByText("camille@example.com")).toBeInTheDocument();
  expect(screen.getByText("Utilisateur")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Gérer les comptes" })).not.toBeInTheDocument();
});

test("admin sur /admin/comptes : la page Comptes s'affiche avec sa liste ; valideur et utilisateur redirigés vers /", async () => {
  mockApi(ADMIN);
  renderApp("/admin/comptes");

  expect(await screen.findByRole("heading", { name: "Comptes" })).toBeInTheDocument();
  // La liste de l'API s'affiche (ici : le compte de l'admin lui-même).
  expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
  expect(screen.queryByText("Bientôt disponible.")).not.toBeInTheDocument();
});

test.each([
  [UTILISATEUR],
  [VALIDEUR],
])("rôle non admin sur /admin/comptes : redirigé vers l'accueil", async (utilisateur) => {
  mockApi(utilisateur);
  renderApp("/admin/comptes");

  expect(
    await screen.findByRole("heading", { name: `Bonjour ${utilisateur.display_name}` }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Comptes" })).not.toBeInTheDocument();
});

test("avatar de l'accueil : lien « Profil » vers /profil, puis page Profil au clic", async () => {
  mockApi(UTILISATEUR);
  const utilisateur = userEvent.setup();
  renderApp();

  await screen.findByRole("heading", { name: "Bonjour Camille" });
  const avatar = screen
    .getAllByRole("link", { name: "Profil" })
    .find((lien) => lien.classList.contains("accueil-avatar"));
  expect(avatar).toBeDefined();
  expect(avatar).toHaveAttribute("href", "/profil");
  expect(avatar).not.toHaveAttribute("aria-hidden");

  await utilisateur.click(avatar!);

  expect(await screen.findByRole("heading", { name: "Profil" })).toBeInTheDocument();
});

test("déconnexion depuis la page Profil : logout appelé une fois puis retour à la connexion", async () => {
  const fetchMock = mockApi(UTILISATEUR);
  const utilisateur = userEvent.setup();
  renderApp("/profil");

  await utilisateur.click(await screen.findByRole("button", { name: "Se déconnecter" }));

  expect(await screen.findByLabelText("Adresse e-mail")).toBeInTheDocument();
  const appelsLogout = fetchMock.mock.calls.filter(([entree]) =>
    String(entree).includes("/api/v1/auth/logout"),
  );
  expect(appelsLogout).toHaveLength(1);
  aucunAppelHealth(fetchMock.mock.calls);
});

test("focus du h1 à l'arrivée sur une page vide après clic sur Dossiers", async () => {
  mockApi(UTILISATEUR);
  const utilisateur = userEvent.setup();
  renderApp();

  await screen.findByRole("heading", { name: "Bonjour Camille" });
  await utilisateur.click(screen.getByRole("link", { name: "Dossiers" }));

  expect(await screen.findByRole("heading", { name: "Dossiers" })).toHaveFocus();
});

test("valideur : /dossiers affiche le titre « Dossiers » et l'état vide", async () => {
  mockApi(VALIDEUR);
  renderApp("/dossiers");

  expect(await screen.findByRole("heading", { name: "Dossiers" })).toBeInTheDocument();
  expect(
    await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation."),
  ).toBeInTheDocument();
});

test("admin : /dossiers affiche le titre « Dossiers » et l'état vide", async () => {
  mockApi(ADMIN);
  renderApp("/dossiers");

  expect(await screen.findByRole("heading", { name: "Dossiers" })).toBeInTheDocument();
  expect(
    await screen.findByText("Aucun dossier. Regroupez vos dépenses pour les envoyer en validation."),
  ).toBeInTheDocument();
});

test.each([
  [UTILISATEUR, "/depenses"],
  [VALIDEUR, "/depenses"],
  [ADMIN, "/depenses"],
  [UTILISATEUR, "/dossiers"],
  [UTILISATEUR, "/"],
])(
  "barre de navigation présente et utilisable sur %s pour %s",
  async (utilisateur, url) => {
    mockApi(utilisateur);
    renderApp(url);

    const nav = await screen.findByRole("navigation", {
      name: "Navigation principale",
    });
    expect(within(nav).getByRole("link", { name: "Accueil" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Dépenses" })).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: "Ajouter une dépense" }),
    ).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Dossiers" })).toBeInTheDocument();

    if (utilisateur.role === "utilisateur") {
      expect(within(nav).getByRole("link", { name: "Profil" })).toBeInTheDocument();
    } else {
      expect(within(nav).getByRole("link", { name: "Validation" })).toBeInTheDocument();
    }
  },
);

test.each([
  [UTILISATEUR, "/depenses/nouvelle"],
  [UTILISATEUR, "/depenses/1"],
  [VALIDEUR, "/depenses/nouvelle"],
  [VALIDEUR, "/depenses/1"],
  [ADMIN, "/depenses/nouvelle"],
  [ADMIN, "/depenses/1"],
])(
  "barre de navigation masquée sur l'écran de formulaire %s pour %s (bouton « Enregistrer » accessible)",
  async (utilisateur, url) => {
    mockApi(utilisateur);
    renderApp(url);

    // L'écran de formulaire s'affiche (bouton d'enregistrement présent)…
    expect(
      await screen.findByRole("button", { name: /Enregistrer/ }),
    ).toBeInTheDocument();
    // …et la barre flottante est absente : pas de chevauchement possible.
    expect(
      screen.queryByRole("navigation", { name: "Navigation principale" }),
    ).not.toBeInTheDocument();
  },
);
