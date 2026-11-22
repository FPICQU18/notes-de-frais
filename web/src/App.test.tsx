import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import App from "./App";
import type { UserRead } from "./api/client";

const UTILISATEUR: UserRead = {
  id: 1,
  email: "camille@example.com",
  display_name: "Camille",
  role: "utilisateur",
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
      return jsonResponse({ detail: "Introuvable" }, 404);
    },
  );
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("connexion réussie : /me 401, login 200, accueil « Bonjour … »", async () => {
  const fetchMock = mockApi(null);
  const utilisateur = userEvent.setup();
  render(<App />);

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
  render(<App />);

  await screen.findByLabelText("Adresse e-mail");
  await utilisateur.type(screen.getByLabelText("Adresse e-mail"), UTILISATEUR.email);
  await utilisateur.type(screen.getByLabelText("Mot de passe"), "mauvais");
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  const alerte = await screen.findByRole("alert");
  expect(alerte).toHaveTextContent("E-mail ou mot de passe incorrect.");
  await waitFor(() => expect(alerte).toHaveFocus());

  expect(screen.getByLabelText("Adresse e-mail")).toHaveValue(UTILISATEUR.email);
  expect(screen.getByLabelText("Mot de passe")).toHaveValue("mauvais");
  expect(screen.getByRole("button", { name: "Se connecter" })).toBeInTheDocument();
  aucunAppelHealth(fetchMock.mock.calls);
});

test("session existante : /me 200 mène directement à l'accueil sans login", async () => {
  const fetchMock = mockApi(UTILISATEUR);
  render(<App />);

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
  render(<App />);

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
  render(<App />);

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
  render(<App />);

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
  render(<App />);

  expect(await screen.findByRole("heading", { name: "Service indisponible" })).toBeInTheDocument();
  await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));

  expect(await screen.findByRole("heading", { name: "Bonjour Camille" })).toBeInTheDocument();
  expect(appelsMe).toBeGreaterThanOrEqual(2);
  aucunAppelHealth(fetchMock.mock.calls);
});
