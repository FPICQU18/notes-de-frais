import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Navigate, Route, Routes } from "react-router";

import type { UserRead } from "../api/client";
import { ComptesPage, type CompteRead } from "./ComptesPage";

const ADMIN: UserRead = {
  id: 1,
  email: "admin@example.com",
  display_name: "Alice Admin",
  role: "admin",
};

const COMPTES: CompteRead[] = [
  {
    id: 1,
    email: "admin@example.com",
    display_name: "Alice Admin",
    role: "admin",
    is_active: true,
    created_at: "2026-11-01T10:00:00Z",
  },
  {
    id: 2,
    email: "victor@example.com",
    display_name: "Victor Valideur",
    role: "valideur",
    is_active: true,
    created_at: "2026-11-02T10:00:00Z",
  },
  {
    id: 3,
    email: "camille@example.com",
    display_name: "Camille Martin",
    role: "utilisateur",
    is_active: false,
    created_at: "2026-11-03T10:00:00Z",
  },
];

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

type Handler = (
  url: string,
  methode: string,
  corps: unknown,
) => Response | Promise<Response> | undefined;

/** fetch simulé par URL et méthode ; `handlers` surcharge les routes usuelles. */
function mockFetch(handlers: Handler[] = []) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((entree, init) => {
    const url = String(entree);
    const methode = init?.method ?? "GET";
    const corps = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
    for (const handler of handlers) {
      const reponse = handler(url, methode, corps);
      if (reponse !== undefined) return Promise.resolve(reponse);
    }
    if (url.split("?")[0].endsWith("/api/v1/users") && methode === "GET") {
      return Promise.resolve(jsonResponse(COMPTES));
    }
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
}

function renderComptes(
  props: { utilisateur?: UserRead; onSessionExpiree?: () => void } = {},
) {
  const utilisateur = props.utilisateur ?? ADMIN;
  const onSessionExpiree = props.onSessionExpiree ?? vi.fn();
  render(
    <MemoryRouter initialEntries={["/admin/comptes"]}>
      <Routes>
        <Route
          path="/admin/comptes"
          element={
            utilisateur.role === "admin" ? (
              <ComptesPage utilisateur={utilisateur} onSessionExpiree={onSessionExpiree} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="/" element={<div>Accueil</div>} />
        <Route path="/connexion" element={<div>Écran de connexion</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return { onSessionExpiree };
}

/** Appels filtrés par URL et méthode. */
function appels(fetchMock: ReturnType<typeof mockFetch>, urlPart: string, methode: string) {
  return fetchMock.mock.calls.filter(
    ([entree, init]) =>
      String(entree).includes(urlPart) && (init as RequestInit | undefined)?.method === methode,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "");
});

/* ----------------------------------------------------------- liste */

test("bouton « Retour » présent en haut de la page Comptes, au clic retour à la page précédente (/profil)", async () => {
  mockFetch();
  const utilisateur = userEvent.setup();
  // idx > 0 : une page précédente existe dans l'appli (cas navigate(-1)).
  window.history.replaceState({ idx: 1 }, "");
  render(
    <MemoryRouter initialEntries={["/profil", "/admin/comptes"]} initialIndex={1}>
      <Routes>
        <Route path="/profil" element={<div>Page profil</div>} />
        <Route
          path="/admin/comptes"
          element={<ComptesPage utilisateur={ADMIN} onSessionExpiree={vi.fn()} />}
        />
      </Routes>
    </MemoryRouter>,
  );

  const bouton = await screen.findByRole("button", { name: "Retour au profil" });
  expect(bouton).toHaveTextContent("Retour");
  expect(bouton.className).toContain("h-11");
  expect(bouton.className).toContain("min-w-11");
  expect(bouton.className).toContain("focus-visible:outline-2");

  await utilisateur.click(bouton);
  expect(await screen.findByText("Page profil")).toBeInTheDocument();
});

test("liste des comptes : nom, e-mail, rôle en libellé français et état, dans l'ordre de l'API", async () => {
  mockFetch();
  renderComptes();

  expect(await screen.findByText("Alice Admin")).toBeInTheDocument();
  expect(screen.getByText("admin@example.com")).toBeInTheDocument();
  expect(screen.getByText("Victor Valideur")).toBeInTheDocument();
  expect(screen.getByText("victor@example.com")).toBeInTheDocument();
  expect(screen.getByText("Camille Martin")).toBeInTheDocument();
  expect(screen.getByText("camille@example.com")).toBeInTheDocument();

  // Libellés français des rôles.
  expect(screen.getByText("Admin", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByText("Valideur", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByText("Utilisateur", { selector: "span" })).toBeInTheDocument();

  // États.
  expect(screen.getAllByText("Actif")).toHaveLength(2);
  expect(screen.getByText("Inactif")).toBeInTheDocument();

  // Ordre de l'API (aucun tri client) : Alice, Victor, Camille.
  const items = screen.getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining("Alice Admin"),
    expect.stringContaining("Victor Valideur"),
    expect.stringContaining("Camille Martin"),
  ]);

  // Chaque ligne a un sélecteur de rôle avec un <label> associé.
  expect(screen.getByLabelText("Changer le rôle de Alice Admin")).toBeInTheDocument();
  expect(screen.getByLabelText("Changer le rôle de Victor Valideur")).toBeInTheDocument();
  expect(screen.getByLabelText("Changer le rôle de Camille Martin")).toBeInTheDocument();
});

test("rôle non admin sur /admin/comptes : redirigé vers /", async () => {
  mockFetch();
  renderComptes({
    utilisateur: { id: 2, email: "v@example.com", display_name: "Victor", role: "valideur" },
  });

  expect(await screen.findByText("Accueil")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Comptes" })).not.toBeInTheDocument();
});

test("liste vide : « Aucun compte. » ; chargement : aria-busy + « Chargement… » ; erreur 500 : alerte + « Réessayer » ; erreur 403 : alerte sans « Réessayer »", async () => {
  // --- 403 (rôle insuffisant) : alerte avec le message du serveur, mais
  // PAS de « Réessayer » (le serveur a refusé, ce n'est pas transitoire).
  vi.spyOn(globalThis, "fetch").mockImplementation((entree) => {
    if (String(entree).split("?")[0].endsWith("/api/v1/users")) {
      return Promise.resolve(jsonResponse({ detail: "Accès interdit." }, 403));
    }
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
  const { unmount } = render(
    <MemoryRouter initialEntries={["/admin/comptes"]}>
      <Routes>
        <Route
          path="/admin/comptes"
          element={<ComptesPage utilisateur={ADMIN} onSessionExpiree={vi.fn()} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Accès interdit.");
  expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
  unmount();

  // --- 500 : alerte + « Réessayer », puis succès sur liste vide.
  let resoudre!: (r: Response) => void;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((entree) => {
    if (String(entree).split("?")[0].endsWith("/api/v1/users")) {
      return new Promise<Response>((res) => {
        resoudre = res;
      });
    }
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
  renderComptes();

  const section = screen.getByRole("region", { name: "Comptes" });
  expect(section).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("Chargement…")).toBeInTheDocument();

  resoudre(jsonResponse({ detail: "Erreur serveur." }, 500));
  expect(await screen.findByRole("alert")).toHaveTextContent("Erreur serveur.");
  const boutonReessayer = screen.getByRole("button", { name: "Réessayer" });
  expect(boutonReessayer).toBeInTheDocument();

  // Réessayer → succès sur liste vide → « Aucun compte. ».
  fetchMock.mockImplementation((entree) => {
    if (String(entree).split("?")[0].endsWith("/api/v1/users")) return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
  const utilisateur = userEvent.setup();
  await utilisateur.click(boutonReessayer);
  expect(await screen.findByText("Aucun compte.")).toBeInTheDocument();
  expect(screen.queryByText("Chargement…")).not.toBeInTheDocument();
});

/* --------------------------------------------------------- création */

test("« Nouveau compte » ouvre la feuille avec 4 champs labellisés et l'aide « au moins 12 caractères »", async () => {
  mockFetch();
  const utilisateur = userEvent.setup();
  renderComptes();

  await utilisateur.click(await screen.findByRole("button", { name: "Nouveau compte" }));

  const dialog = await screen.findByRole("dialog", { name: "Nouveau compte" });
  expect(within(dialog).getByLabelText("Nom affiché")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("E-mail")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Rôle")).toBeInTheDocument();
  const mdp = within(dialog).getByLabelText("Mot de passe initial");
  expect(mdp).toBeInTheDocument();
  expect(within(dialog).getByText("Au moins 12 caractères.")).toBeInTheDocument();
  // Rôle proposé : Utilisateur / Valideur / Admin.
  const select = within(dialog).getByLabelText("Rôle") as HTMLSelectElement;
  expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
    "Utilisateur",
    "Valideur",
    "Admin",
  ]);
});

test("création réussie : un seul POST, feuille fermée, liste rechargée, « Compte créé. » annoncé", async () => {
  const fetchMock = mockFetch([
    (url, methode) => {
      if (url.split("?")[0].endsWith("/api/v1/users") && methode === "POST") {
        return jsonResponse(
          {
            id: 4,
            email: "nouveau@example.com",
            display_name: "Nouveau Compte",
            role: "valideur",
            is_active: true,
            created_at: "2026-11-24T10:00:00Z",
          },
          201,
        );
      }
      return undefined;
    },
    // Le GET suivant (rechargement) renvoie la liste à jour.
    (url, methode) => {
      if (url.split("?")[0].endsWith("/api/v1/users") && methode === "GET") {
        return jsonResponse([...COMPTES, {
          id: 4,
          email: "nouveau@example.com",
          display_name: "Nouveau Compte",
          role: "valideur",
          is_active: true,
          created_at: "2026-11-24T10:00:00Z",
        }]);
      }
      return undefined;
    },
  ]);
  const utilisateur = userEvent.setup();
  renderComptes();

  await utilisateur.click(await screen.findByRole("button", { name: "Nouveau compte" }));
  const dialog = await screen.findByRole("dialog", { name: "Nouveau compte" });
  await utilisateur.type(within(dialog).getByLabelText("Nom affiché"), "Nouveau Compte");
  await utilisateur.type(within(dialog).getByLabelText("E-mail"), "nouveau@example.com");
  await utilisateur.selectOptions(within(dialog).getByLabelText("Rôle"), "valideur");
  await utilisateur.type(within(dialog).getByLabelText("Mot de passe initial"), "motdepasse12!");

  const bouton = within(dialog).getByRole("button", { name: "Créer le compte" });
  await utilisateur.click(bouton);

  // Pendant l'appel : bouton désactivé + aria-busy.
  await waitFor(() => expect(bouton).toBeDisabled());

  // Un seul POST, puis la feuille se ferme et la liste est rechargée.
  await waitFor(() =>
    expect(appels(fetchMock, "/api/v1/users", "POST")).toHaveLength(1),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Compte créé.");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(await screen.findByText("Nouveau Compte")).toBeInTheDocument();
  // Le GET a été relancé après la création.
  expect(appels(fetchMock, "/api/v1/users", "GET").length).toBeGreaterThanOrEqual(2);
});

test("création en 409 : message de l'API dans role=\"alert\", feuille ouverte, valeurs conservées", async () => {
  mockFetch([
    (url, methode) => {
      if (url.split("?")[0].endsWith("/api/v1/users") && methode === "POST") {
        return jsonResponse({ detail: "Cette adresse e-mail est déjà utilisée." }, 409);
      }
      return undefined;
    },
  ]);
  const utilisateur = userEvent.setup();
  renderComptes();

  await utilisateur.click(await screen.findByRole("button", { name: "Nouveau compte" }));
  const dialog = await screen.findByRole("dialog", { name: "Nouveau compte" });
  await utilisateur.type(within(dialog).getByLabelText("Nom affiché"), "Sofiane Benali");
  await utilisateur.type(within(dialog).getByLabelText("E-mail"), "sofiane@example.com");
  await utilisateur.type(within(dialog).getByLabelText("Mot de passe initial"), "motdepasse12!");
  await utilisateur.click(within(dialog).getByRole("button", { name: "Créer le compte" }));

  const alerte = await within(dialog).findByRole("alert");
  expect(alerte).toHaveTextContent("Cette adresse e-mail est déjà utilisée.");
  // Formulaire toujours ouvert, aucune donnée perdue.
  expect(within(dialog).getByLabelText("Nom affiché")).toHaveValue("Sofiane Benali");
  expect(within(dialog).getByLabelText("E-mail")).toHaveValue("sofiane@example.com");
  expect(within(dialog).getByLabelText("Mot de passe initial")).toHaveValue("motdepasse12!");
  expect(screen.getByRole("dialog", { name: "Nouveau compte" })).toBeInTheDocument();
});

test("création en 422 : chaque message est rattaché à son champ, visible au-dessus du champ", async () => {
  mockFetch([
    (url, methode) => {
      if (url.split("?")[0].endsWith("/api/v1/users") && methode === "POST") {
        return jsonResponse(
          {
            detail: [
              {
                loc: ["body", "password"],
                msg: "Le mot de passe doit contenir au moins 12 caractères.",
              },
              {
                loc: ["body", "email"],
                msg: "Adresse e-mail invalide.",
              },
            ],
          },
          422,
        );
      }
      return undefined;
    },
  ]);
  const utilisateur = userEvent.setup();
  renderComptes();

  await utilisateur.click(await screen.findByRole("button", { name: "Nouveau compte" }));
  const dialog = await screen.findByRole("dialog", { name: "Nouveau compte" });
  await utilisateur.type(within(dialog).getByLabelText("Nom affiché"), "Sofiane Benali");
  await utilisateur.type(within(dialog).getByLabelText("E-mail"), "invalide");
  await utilisateur.type(within(dialog).getByLabelText("Mot de passe initial"), "court");
  await utilisateur.click(within(dialog).getByRole("button", { name: "Créer le compte" }));

  const champMdp = within(dialog).getByLabelText("Mot de passe initial");
  await waitFor(() =>
    expect(within(dialog).getByText("Le mot de passe doit contenir au moins 12 caractères."))
      .toBeInTheDocument(),
  );
  expect(within(dialog).getByText("Adresse e-mail invalide.")).toBeInTheDocument();
  // Rattaché au champ : aria-describedby pointe vers le message d'erreur.
  expect(champMdp).toHaveAttribute("aria-describedby", expect.stringContaining("erreur-nouveau-mdp"));
  expect(champMdp).toHaveAttribute("aria-invalid", "true");
  // Le message reste au-dessus du champ concerné (ordre DOM : erreur puis champ).
  const erreurMdp = within(dialog).getByText(
    "Le mot de passe doit contenir au moins 12 caractères.",
  );
  expect(erreurMdp.compareDocumentPosition(champMdp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

/* ------------------------------------------------------------ rôle */

test("changement de rôle : PATCH envoyé, ligne mise à jour, « Rôle modifié. » annoncé", async () => {
  const fetchMock = mockFetch([
    (url, methode) => {
      if (url.endsWith("/api/v1/users/3/role") && methode === "PATCH") {
        return jsonResponse({ id: 3, role: "valideur" });
      }
      return undefined;
    },
  ]);
  const utilisateur = userEvent.setup();
  renderComptes();

  const select = (await screen.findByLabelText("Changer le rôle de Camille Martin")) as HTMLSelectElement;
  expect(select.value).toBe("utilisateur");
  await utilisateur.selectOptions(select, "valideur");

  await waitFor(() => expect(appels(fetchMock, "/api/v1/users/3/role", "PATCH")).toHaveLength(1));
  expect(await screen.findByRole("status")).toHaveTextContent("Rôle modifié.");
  // La ligne est mise à jour.
  await waitFor(() => expect(select.value).toBe("valideur"));
});

test("changement de rôle en 403 : message de l'API affiché et la ligne revient à son rôle précédent", async () => {
  const fetchMock = mockFetch([
    (url, methode) => {
      if (url.endsWith("/api/v1/users/2/role") && methode === "PATCH") {
        return jsonResponse(
          { detail: "Vous ne pouvez pas retirer votre propre rôle admin." },
          403,
        );
      }
      return undefined;
    },
  ]);
  const utilisateur = userEvent.setup();
  renderComptes();

  const select = (await screen.findByLabelText("Changer le rôle de Victor Valideur")) as HTMLSelectElement;
  expect(select.value).toBe("valideur");
  await utilisateur.selectOptions(select, "admin");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Vous ne pouvez pas retirer votre propre rôle admin.",
  );
  await waitFor(() => expect(select.value).toBe("valideur"));
  expect(appels(fetchMock, "/api/v1/users/2/role", "PATCH")).toHaveLength(1);
});

/* --------------------------------------- désactivation / réactivation */

test("« Désactiver » demande confirmation puis envoie POST deactivate : ligne « Inactif » + annonce", async () => {
  const fetchMock = mockFetch([
    (url, methode) => {
      if (url.endsWith("/api/v1/users/2/deactivate") && methode === "POST") {
        return new Response(null, { status: 204 });
      }
      return undefined;
    },
  ]);
  const utilisateur = userEvent.setup();
  renderComptes();

  const ligne = (await screen.findByText("Victor Valideur")).closest("li") as HTMLElement;
  await utilisateur.click(within(ligne).getByRole("button", { name: "Désactiver" }));

  // Confirmation.
  const dialog = await screen.findByRole("dialog", { name: "Désactiver ce compte ?" });
  expect(dialog).toHaveTextContent(
    "Désactiver Victor Valideur ? Ses sessions seront fermées.",
  );
  await utilisateur.click(within(dialog).getByRole("button", { name: "Désactiver" }));

  await waitFor(() =>
    expect(appels(fetchMock, "/api/v1/users/2/deactivate", "POST")).toHaveLength(1),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Compte désactivé.");
  await waitFor(() => expect(within(ligne).getByText("Inactif")).toBeInTheDocument());
  // Le bouton devient « Réactiver ».
  expect(within(ligne).getByRole("button", { name: "Réactiver" })).toBeInTheDocument();
});

test("désactivation en 403 : le message de l'API est affiché", async () => {
  mockFetch([
    (url, methode) => {
      if (url.endsWith("/api/v1/users/2/deactivate") && methode === "POST") {
        return jsonResponse(
          { detail: "Vous ne pouvez pas désactiver votre propre compte." },
          403,
        );
      }
      return undefined;
    },
  ]);
  const utilisateur = userEvent.setup();
  renderComptes();

  const ligne = (await screen.findByText("Victor Valideur")).closest("li") as HTMLElement;
  await utilisateur.click(within(ligne).getByRole("button", { name: "Désactiver" }));
  const dialog = await screen.findByRole("dialog", { name: "Désactiver ce compte ?" });
  await utilisateur.click(within(dialog).getByRole("button", { name: "Désactiver" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Vous ne pouvez pas désactiver votre propre compte.",
  );
});

test("« Réactiver » envoie POST reactivate : ligne « Actif » + « Compte réactivé. »", async () => {
  const fetchMock = mockFetch([
    (url, methode) => {
      if (url.endsWith("/api/v1/users/3/reactivate") && methode === "POST") {
        return new Response(null, { status: 204 });
      }
      return undefined;
    },
  ]);
  const utilisateur = userEvent.setup();
  renderComptes();

  const ligne = (await screen.findByText("Camille Martin")).closest("li") as HTMLElement;
  expect(within(ligne).getByText("Inactif")).toBeInTheDocument();
  await utilisateur.click(within(ligne).getByRole("button", { name: "Réactiver" }));

  await waitFor(() =>
    expect(appels(fetchMock, "/api/v1/users/3/reactivate", "POST")).toHaveLength(1),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Compte réactivé.");
  await waitFor(() => expect(within(ligne).getByText("Actif")).toBeInTheDocument());
});

/* -------------------------------------------------- sa propre ligne */

test("ligne de l'admin connecté : « Désactiver » désactivé avec explication, retrait de son rôle admin désactivé dans le sélecteur", async () => {
  mockFetch();
  renderComptes();

  const ligne = (await screen.findByText("Alice Admin")).closest("li") as HTMLElement;
  const desactiver = within(ligne).getByRole("button", { name: "Désactiver" });
  expect(desactiver).toBeDisabled();
  expect(ligne).toHaveTextContent("Vous ne pouvez pas désactiver votre propre compte.");
  expect(ligne).toHaveTextContent("Vous ne pouvez pas retirer votre propre rôle admin.");

  // Le sélecteur de son propre rôle : seule l'option « Admin » reste active.
  const select = within(ligne).getByLabelText(
    "Changer le rôle de Alice Admin",
  ) as HTMLSelectElement;
  const options = Array.from(select.options);
  expect(options.find((o) => o.value === "admin")?.disabled).toBe(false);
  expect(options.find((o) => o.value === "utilisateur")?.disabled).toBe(true);
  expect(options.find((o) => o.value === "valideur")?.disabled).toBe(true);
});

/* ------------------------------------------------------------- 401 */

test("401 sur le chargement : onSessionExpiree appelé (retour à la connexion)", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation((entree) => {
    if (String(entree).split("?")[0].endsWith("/api/v1/users")) {
      return Promise.resolve(jsonResponse({ detail: "Authentification requise." }, 401));
    }
    return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
  });
  const onSessionExpiree = vi.fn();
  renderComptes({ onSessionExpiree });

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalledTimes(1));
});

test("401 sur un changement de rôle : onSessionExpiree appelé", async () => {
  const onSessionExpiree = vi.fn();
  mockFetch([
    (url, methode) => {
      if (url.endsWith("/api/v1/users/3/role") && methode === "PATCH") {
        return jsonResponse({ detail: "Authentification requise." }, 401);
      }
      return undefined;
    },
  ]);
  const utilisateur = userEvent.setup();
  renderComptes({ onSessionExpiree });

  const select = await screen.findByLabelText("Changer le rôle de Camille Martin");
  await utilisateur.selectOptions(select, "valideur");

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalledTimes(1));
});

/* ------------------------------------- US-045 (tableau bureau ≥ 1024 px) */

type EcouteurMedia = (evenement: MediaQueryListEvent) => void;

/**
 * Mock de `window.matchMedia` piloté par la largeur (même patron que
 * `DossiersPage.test.tsx`, US-044) : `definirLargeur(px)` notifie les
 * écouteurs comme au redimensionnement.
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

function renderComptesBureau(options: { largeur?: number } = {}) {
  mockLargeur(options.largeur ?? 1024);
  return renderComptes();
}

/** Lignes du tableau (sans l'en-tête), dans l'ordre affiché. */
function lignesTableau(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

describe("US-045 — tableau des comptes ≥ 1024 px", () => {
  test("1023 px : la liste actuelle (cartes) reste affichée, aucun tableau", async () => {
    mockFetch();
    renderComptesBureau({ largeur: 1023 });

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // Les sélecteurs de rôle de la liste mobile sont présents.
    expect(screen.getByLabelText("Changer le rôle de Alice Admin")).toBeInTheDocument();
  });

  test("1024 px : tableau « Tous les comptes » avec les 6 colonnes, pastilles et bouton « Nouveau compte »", async () => {
    mockFetch();
    renderComptesBureau();

    const tableau = await screen.findByRole("table", { name: "Tous les comptes" });
    expect(tableau).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);

    for (const colonne of ["Nom", "E-mail", "Rôle", "Statut", "Créé le", "Actions"]) {
      expect(
        within(screen.getAllByRole("row")[0]).getByRole("columnheader", {
          name: new RegExp(`^${colonne}`),
        }),
      ).toBeInTheDocument();
    }

    // 3 lignes, dans l'ordre de l'API (aucun tri actif par défaut).
    const lignes = lignesTableau();
    expect(lignes).toHaveLength(3);
    expect(lignes[0]).toHaveTextContent("Alice Admin");
    expect(lignes[0]).toHaveTextContent("admin@example.com");
    expect(lignes[1]).toHaveTextContent("Victor Valideur");
    expect(lignes[2]).toHaveTextContent("Camille Martin");

    // Pastilles de rôle et de statut identiques à la liste mobile.
    expect(within(lignes[0]).getByText("Admin")).toBeInTheDocument();
    expect(within(lignes[1]).getByText("Valideur")).toBeInTheDocument();
    expect(within(lignes[2]).getByText("Utilisateur")).toBeInTheDocument();
    expect(within(lignes[0]).getByText("Actif")).toBeInTheDocument();
    expect(within(lignes[2]).getByText("Inactif")).toBeInTheDocument();

    // Date de création formatée en français.
    expect(within(lignes[0]).getByText("1 nov. 2026")).toBeInTheDocument();

    // Actions : « Modifier » + « Désactiver » sur les comptes actifs,
    // « Réactiver » sur le compte inactif ; aucune action sur son propre compte.
    expect(within(lignes[0]).queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
    expect(within(lignes[1]).getByRole("button", { name: "Modifier" })).toBeInTheDocument();
    expect(within(lignes[1]).getByRole("button", { name: "Désactiver" })).toBeInTheDocument();
    expect(within(lignes[2]).getByRole("button", { name: "Réactiver" })).toBeInTheDocument();

    // Le bouton « Nouveau compte » reste présent.
    expect(screen.getByRole("button", { name: "Nouveau compte" })).toBeInTheDocument();
  });

  test("1024 px : clic sur « Modifier » d'une ligne ouvre la feuille d'édition (mêmes champs, sans mot de passe)", async () => {
    mockFetch();
    const utilisateur = userEvent.setup();
    renderComptesBureau();

    const lignes = await screen.findAllByRole("row");
    // lignes[0] = en-tête ; lignes[1] = Alice (soi), lignes[2] = Victor, lignes[3] = Camille.
    const ligneVictor = lignes[2];
    await utilisateur.click(within(ligneVictor).getByRole("button", { name: "Modifier" }));

    const dialog = await screen.findByRole("dialog", { name: "Modifier Victor Valideur" });
    expect(within(dialog).getByLabelText("Nom affiché")).toHaveValue("Victor Valideur");
    expect(within(dialog).getByLabelText("E-mail")).toHaveValue("victor@example.com");
    expect((within(dialog).getByLabelText("Rôle") as HTMLSelectElement).value).toBe("valideur");
    // Pas de champ mot de passe dans l'édition.
    expect(within(dialog).queryByLabelText("Mot de passe initial")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Enregistrer" })).toBeInTheDocument();
  });

  test("1024 px : enregistrement de l'édition envoie un seul PATCH, ferme la feuille, recharge et annonce « Compte modifié. »", async () => {
    // Compteur de GET : le premier renvoie la liste d'origine, le second
    // (rechargement après édition) la liste mise à jour.
    let nbGet = 0;
    const fetchMock = mockFetch([
      (url, methode) => {
        if (url.endsWith("/api/v1/users/2") && methode === "PATCH") {
          return jsonResponse({
            id: 2,
            email: "victor2@example.com",
            display_name: "Victor V.",
            role: "admin",
            is_active: true,
            created_at: "2026-11-02T10:00:00Z",
          });
        }
        if (url.split("?")[0].endsWith("/api/v1/users") && methode === "GET") {
          nbGet += 1;
          if (nbGet > 1) {
            return jsonResponse([
              COMPTES[0],
              { ...COMPTES[1], display_name: "Victor V.", email: "victor2@example.com", role: "admin" },
              COMPTES[2],
            ]);
          }
        }
        return undefined;
      },
    ]);
    const utilisateur = userEvent.setup();
    renderComptesBureau();

    const lignes = await screen.findAllByRole("row");
    // lignes[0] = en-tête ; lignes[1] = Alice (soi, sans action), lignes[2] = Victor.
    const ligneVictor = lignes[2];
    await utilisateur.click(within(ligneVictor).getByRole("button", { name: "Modifier" }));
    const dialog = await screen.findByRole("dialog", { name: "Modifier Victor Valideur" });
    await utilisateur.clear(within(dialog).getByLabelText("Nom affiché"));
    await utilisateur.type(within(dialog).getByLabelText("Nom affiché"), "Victor V.");
    await utilisateur.clear(within(dialog).getByLabelText("E-mail"));
    await utilisateur.type(within(dialog).getByLabelText("E-mail"), "victor2@example.com");
    await utilisateur.selectOptions(within(dialog).getByLabelText("Rôle"), "admin");
    await utilisateur.click(within(dialog).getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(appels(fetchMock, "/api/v1/users/2", "PATCH")).toHaveLength(1),
    );
    const corps = JSON.parse(
      (appels(fetchMock, "/api/v1/users/2", "PATCH")[0][1] as RequestInit).body as string,
    );
    expect(corps).toEqual({
      display_name: "Victor V.",
      email: "victor2@example.com",
      role: "admin",
    });
    expect(corps).not.toHaveProperty("password");
    await waitFor(() =>
      expect(screen.getAllByRole("status").some((el) => el.textContent === "Compte modifié.")).toBe(true),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Liste rechargée : la ligne affiche le nouveau nom.
    expect(await screen.findByText("Victor V.")).toBeInTheDocument();
  });

  test("1024 px : édition en 422 → messages rattachés aux champs ; en 403 → message du serveur dans la feuille", async () => {
    const fetchMock = mockFetch([
      (url, methode) => {
        if (url.endsWith("/api/v1/users/2") && methode === "PATCH") {
          return jsonResponse(
            {
              detail: [
                { loc: ["body", "email"], msg: "Adresse e-mail invalide." },
              ],
            },
            422,
          );
        }
        return undefined;
      },
    ]);
    const utilisateur = userEvent.setup();
    renderComptesBureau();

    const lignes = await screen.findAllByRole("row");
    await utilisateur.click(within(lignes[2]).getByRole("button", { name: "Modifier" }));
    let dialog = await screen.findByRole("dialog", { name: "Modifier Victor Valideur" });
    await utilisateur.clear(within(dialog).getByLabelText("E-mail"));
    await utilisateur.type(within(dialog).getByLabelText("E-mail"), "invalide");
    await utilisateur.click(within(dialog).getByRole("button", { name: "Enregistrer" }));

    const champEmail = within(dialog).getByLabelText("E-mail");
    await waitFor(() =>
      expect(within(dialog).getByText("Adresse e-mail invalide.")).toBeInTheDocument(),
    );
    expect(champEmail).toHaveAttribute("aria-invalid", "true");
    expect(champEmail).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining("erreur-edition-email"),
    );
    // La feuille reste ouverte, la saisie conservée.
    expect(champEmail).toHaveValue("invalide");
    expect(appels(fetchMock, "/api/v1/users/2", "PATCH")).toHaveLength(1);

    // 403 : message du serveur affiché dans la feuille, liste inchangée.
    fetchMock.mockImplementation((entree, init) => {
      const url = String(entree);
      const methode = init?.method ?? "GET";
      if (url.endsWith("/api/v1/users/2") && methode === "PATCH") {
        return Promise.resolve(
          jsonResponse({ detail: "Vous ne pouvez pas modifier ce compte." }, 403),
        );
      }
      if (url.split("?")[0].endsWith("/api/v1/users") && methode === "GET") {
        return Promise.resolve(jsonResponse(COMPTES));
      }
      return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
    });
    await utilisateur.clear(within(dialog).getByLabelText("E-mail"));
    await utilisateur.type(within(dialog).getByLabelText("E-mail"), "victor@example.com");
    await utilisateur.click(within(dialog).getByRole("button", { name: "Enregistrer" }));

    dialog = await screen.findByRole("dialog", { name: "Modifier Victor Valideur" });
    const alerte = await within(dialog).findByRole("alert");
    expect(alerte).toHaveTextContent("Vous ne pouvez pas modifier ce compte.");
    expect(screen.getByText("Victor Valideur")).toBeInTheDocument();
  });

  test("1024 px : « Nouveau compte » toujours fonctionnel (création OK depuis le tableau)", async () => {
    mockFetch([
      (url, methode) => {
        if (url.split("?")[0].endsWith("/api/v1/users") && methode === "POST") {
          return jsonResponse(
            {
              id: 4,
              email: "nouveau@example.com",
              display_name: "Nouveau Compte",
              role: "valideur",
              is_active: true,
              created_at: "2026-11-24T10:00:00Z",
            },
            201,
          );
        }
        return undefined;
      },
    ]);
    const utilisateur = userEvent.setup();
    renderComptesBureau();

    await screen.findByRole("table", { name: "Tous les comptes" });
    await utilisateur.click(screen.getByRole("button", { name: "Nouveau compte" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouveau compte" });
    await utilisateur.type(within(dialog).getByLabelText("Nom affiché"), "Nouveau Compte");
    await utilisateur.type(within(dialog).getByLabelText("E-mail"), "nouveau@example.com");
    await utilisateur.type(within(dialog).getByLabelText("Mot de passe initial"), "motdepasse12!");
    await utilisateur.click(within(dialog).getByRole("button", { name: "Créer le compte" }));

    await waitFor(() =>
      expect(screen.getAllByRole("status").some((el) => el.textContent === "Compte créé.")).toBe(true),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("1024 px : « Désactiver » d'une ligne du tableau ouvre la même feuille de confirmation", async () => {
    const fetchMock = mockFetch([
      (url, methode) => {
        if (url.endsWith("/api/v1/users/2/deactivate") && methode === "POST") {
          return new Response(null, { status: 204 });
        }
        return undefined;
      },
    ]);
    const utilisateur = userEvent.setup();
    renderComptesBureau();

    const lignes = await screen.findAllByRole("row");
    await utilisateur.click(within(lignes[2]).getByRole("button", { name: "Désactiver" }));

    const dialog = await screen.findByRole("dialog", { name: "Désactiver ce compte ?" });
    expect(dialog).toHaveTextContent("Désactiver Victor Valideur ? Ses sessions seront fermées.");
    await utilisateur.click(within(dialog).getByRole("button", { name: "Désactiver" }));

    await waitFor(() =>
      expect(appels(fetchMock, "/api/v1/users/2/deactivate", "POST")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("status").some((el) => el.textContent === "Compte désactivé.")).toBe(true),
    );
    await waitFor(() =>
      expect(within(lignesTableau()[1]).getByText("Inactif")).toBeInTheDocument(),
    );
  });

  test("1024 px : 403 (non-admin) au chargement → message du serveur sans « Réessayer » ; 401 → onSessionExpiree", async () => {
    // 403 : alerte avec le message du serveur, PAS de bouton « Réessayer ».
    vi.spyOn(globalThis, "fetch").mockImplementation((entree) => {
      if (String(entree).split("?")[0].endsWith("/api/v1/users")) {
        return Promise.resolve(jsonResponse({ detail: "Accès interdit." }, 403));
      }
      return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
    });
    renderComptesBureau();

    expect(await screen.findByRole("alert")).toHaveTextContent("Accès interdit.");
    expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // Le bouton « Nouveau compte » reste présent.
    expect(screen.getByRole("button", { name: "Nouveau compte" })).toBeInTheDocument();
    vi.restoreAllMocks();

    // 401 : onSessionExpiree appelé.
    vi.spyOn(globalThis, "fetch").mockImplementation((entree) => {
      if (String(entree).split("?")[0].endsWith("/api/v1/users")) {
        return Promise.resolve(jsonResponse({ detail: "Authentification requise." }, 401));
      }
      return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
    });
    const onSessionExpiree = vi.fn();
    renderComptes({ onSessionExpiree });
    await waitFor(() => expect(onSessionExpiree).toHaveBeenCalledTimes(1));
  });

  test("1024 px : états conservés — chargement (aria-busy), liste vide « Aucun compte. » sans tableau", async () => {
    let resoudre!: (r: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((entree) => {
      if (String(entree).split("?")[0].endsWith("/api/v1/users")) {
        return new Promise<Response>((res) => {
          resoudre = res;
        });
      }
      return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
    });
    renderComptesBureau();

    const section = screen.getByRole("region", { name: "Comptes" });
    expect(section).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Chargement…")).toBeInTheDocument();

    fetchMock.mockImplementation((entree) => {
      if (String(entree).split("?")[0].endsWith("/api/v1/users")) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.resolve(jsonResponse({ detail: "Introuvable" }, 404));
    });
    resoudre(jsonResponse([]));
    expect(await screen.findByText("Aucun compte.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nouveau compte" })).toBeInTheDocument();
  });

  test("1024 px : le tri par nom fonctionne (clic sur l'en-tête « Nom » inverse l'ordre)", async () => {
    mockFetch();
    const utilisateur = userEvent.setup();
    renderComptesBureau();

    await screen.findByRole("table", { name: "Tous les comptes" });
    // Ordre API : Alice, Victor, Camille.
    expect(lignesTableau().map((l) => l.textContent)).toEqual([
      expect.stringContaining("Alice Admin"),
      expect.stringContaining("Victor Valideur"),
      expect.stringContaining("Camille Martin"),
    ]);

    await utilisateur.click(screen.getByRole("columnheader", { name: /^Nom/ }).querySelector("button") as HTMLElement);
    // Tri ascendant : Alice, Camille, Victor.
    expect(lignesTableau().map((l) => l.textContent)).toEqual([
      expect.stringContaining("Alice Admin"),
      expect.stringContaining("Camille Martin"),
      expect.stringContaining("Victor Valideur"),
    ]);
  });

  test("redimensionnement : 1024 → 1023 px repasse en liste, 1023 → 1024 px repasse en tableau", async () => {
    mockFetch();
    const { definirLargeur } = mockLargeur(1024);
    renderComptes();

    await screen.findByRole("table", { name: "Tous les comptes" });
    definirLargeur(1023);
    expect(await screen.findAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    definirLargeur(1024);
    expect(await screen.findByRole("table", { name: "Tous les comptes" })).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
