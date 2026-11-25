import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { ApiError } from "../api/client";
import type { UserRead } from "../api/client";
import { LoginPage } from "./LoginPage";

const UTILISATEUR: UserRead = {
  id: 1,
  email: "camille@example.com",
  display_name: "Camille",
  role: "utilisateur",
};

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

/** Monte la page avec un fetch simulé ; `reponseLogin` pilote la réponse de /login. */
function monterPage(
  reponseLogin: () => Promise<Response> = async () => jsonResponse(UTILISATEUR),
) {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (entree, init) => {
    const url = String(entree);
    if (url.endsWith("/api/v1/auth/login") && init?.method === "POST") {
      return reponseLogin();
    }
    return jsonResponse({ detail: "Introuvable" }, 404);
  });
  const onConnecte = vi.fn();
  render(<LoginPage onConnecte={onConnecte} focusTitre={false} />);
  return { fetchMock, onConnecte };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("rendu : carte blanche (rayon 28, ombre douce), pastille primaire, titre, champs visibles", () => {
  monterPage();

  const carte = screen.getByTestId("carte-connexion");
  expect(carte).toHaveClass("bg-white");
  expect(carte).toHaveClass("rounded-[28px]");
  expect(carte).toHaveClass("shadow-[0_6px_18px_rgba(40,30,120,0.06)]");

  // Pastille primaire #5B3DF5 avec pictogramme LogIn (svg lucide, trait 2 px).
  const pastille = carte.querySelector("span.bg-\\[\\#5B3DF5\\]");
  expect(pastille).not.toBeNull();
  const icone = pastille!.querySelector("svg");
  expect(icone).not.toBeNull();
  expect(icone).toHaveAttribute("stroke-width", "2");

  // Titre « Notes de frais » en text-2xl font-semibold.
  const titre = screen.getByRole("heading", { name: "Notes de frais" });
  expect(titre).toHaveClass("text-2xl");
  expect(titre).toHaveClass("font-semibold");

  // Champs visibles avec placeholder et label associé.
  const email = screen.getByLabelText("Adresse e-mail");
  expect(email).toBeVisible();
  expect(email).toHaveAttribute("placeholder");
  expect(email).toHaveAttribute("type", "email");
  expect(email).toHaveAttribute("inputmode", "email");
  const motDePasse = screen.getByLabelText("Mot de passe");
  expect(motDePasse).toBeVisible();
  expect(motDePasse).toHaveAttribute("placeholder");
  expect(motDePasse).toHaveAttribute("type", "password");

  // Bouton principal et bouton d'affichage du mot de passe.
  expect(screen.getByRole("button", { name: "Se connecter" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Afficher le mot de passe" }),
  ).toBeInTheDocument();
});

test("centrage vertical : le conteneur de page centre la carte (min-h-svh + justify-center)", () => {
  const { container } = render(
    <LoginPage onConnecte={vi.fn()} focusTitre={false} />,
  );
  const main = container.querySelector("main");
  expect(main).toHaveClass("min-h-svh");
  expect(main).toHaveClass("justify-center");
});

test("toggle mot de passe : Eye → EyeOff, type password → text → password", async () => {
  monterPage();
  const utilisateur = userEvent.setup();

  const motDePasse = screen.getByLabelText("Mot de passe");
  await utilisateur.type(motDePasse, "supersecret");
  expect(motDePasse).toHaveAttribute("type", "password");

  const toggle = screen.getByRole("button", { name: "Afficher le mot de passe" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await utilisateur.click(toggle);

  expect(motDePasse).toHaveAttribute("type", "text");
  expect(motDePasse).toHaveValue("supersecret");
  expect(
    screen.getByRole("button", { name: "Masquer le mot de passe" }),
  ).toHaveAttribute("aria-pressed", "true");

  await utilisateur.click(screen.getByRole("button", { name: "Masquer le mot de passe" }));
  expect(motDePasse).toHaveAttribute("type", "password");
  expect(
    screen.getByRole("button", { name: "Afficher le mot de passe" }),
  ).toBeInTheDocument();
});

test("clavier mobile : e-mail en inputmode=email, mot de passe en inputmode=numeric", () => {
  monterPage();
  expect(screen.getByLabelText("Adresse e-mail")).toHaveAttribute("inputmode", "email");
  expect(screen.getByLabelText("Mot de passe")).toHaveAttribute("inputmode", "numeric");
});

test("erreur API 401 : role=alert sous le formulaire, focus sur l'alerte, saisie conservée", async () => {
  monterPage(async () =>
    jsonResponse({ detail: "E-mail ou mot de passe incorrect." }, 401),
  );
  const utilisateur = userEvent.setup();

  const email = screen.getByLabelText("Adresse e-mail");
  const motDePasse = screen.getByLabelText("Mot de passe");
  await utilisateur.type(email, UTILISATEUR.email);
  await utilisateur.type(motDePasse, "mauvais");
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  const alerte = await screen.findByRole("alert");
  expect(alerte).toHaveTextContent("E-mail ou mot de passe incorrect.");
  expect(alerte).toHaveAttribute("id", "erreur-connexion");
  // Le message d'erreur est placé sous le formulaire dans le DOM.
  const formulaire = screen.getByRole("button", { name: "Se connecter" }).closest("form");
  expect(formulaire).not.toBeNull();
  expect(
    formulaire!.compareDocumentPosition(alerte) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  // 401 générique : aucun champ désigné, le focus va à l'alerte.
  await waitFor(() => expect(alerte).toHaveFocus());
  expect(email).toHaveValue(UTILISATEUR.email);
  expect(motDePasse).toHaveValue("mauvais");
  expect(email).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveAttribute("aria-describedby", "erreur-connexion");
  expect(motDePasse).toHaveAttribute("aria-invalid", "true");
});

test("erreur 422 sur l'e-mail : focus placé sur le champ e-mail", async () => {
  monterPage(async () =>
    jsonResponse(
      { detail: [{ loc: ["body", "email"], msg: "Adresse e-mail invalide." }] },
      422,
    ),
  );
  const utilisateur = userEvent.setup();

  await utilisateur.type(screen.getByLabelText("Mot de passe"), "motdepasse");
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  const alerte = await screen.findByRole("alert");
  expect(alerte).toHaveTextContent("Adresse e-mail invalide.");
  await waitFor(() => expect(screen.getByLabelText("Adresse e-mail")).toHaveFocus());
});

test("erreur 422 sur le mot de passe : focus placé sur le champ mot de passe", async () => {
  monterPage(async () =>
    jsonResponse(
      { detail: [{ loc: ["body", "password"], msg: "Le mot de passe est requis." }] },
      422,
    ),
  );
  const utilisateur = userEvent.setup();

  await utilisateur.type(screen.getByLabelText("Adresse e-mail"), UTILISATEUR.email);
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  const alerte = await screen.findByRole("alert");
  expect(alerte).toHaveTextContent("Le mot de passe est requis.");
  await waitFor(() => expect(screen.getByLabelText("Mot de passe")).toHaveFocus());
});

test("erreur réseau : message générique réseau dans role=alert, bouton réactivé", async () => {
  monterPage(async () => {
    throw new ApiError(0, "Serveur injoignable. Vérifiez votre connexion.");
  });
  const utilisateur = userEvent.setup();

  await utilisateur.type(screen.getByLabelText("Adresse e-mail"), UTILISATEUR.email);
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  const alerte = await screen.findByRole("alert");
  expect(alerte).toHaveTextContent("Serveur injoignable. Vérifiez votre connexion.");
  const bouton = screen.getByRole("button", { name: "Se connecter" });
  await waitFor(() => expect(bouton).toBeEnabled());
});

test("connexion réussie : onConnecte appelé avec l'utilisateur, pas d'alerte", async () => {
  const { onConnecte } = monterPage(async () => jsonResponse(UTILISATEUR));
  const utilisateur = userEvent.setup();

  await utilisateur.type(screen.getByLabelText("Adresse e-mail"), UTILISATEUR.email);
  await utilisateur.type(screen.getByLabelText("Mot de passe"), "motdepasse");
  await utilisateur.click(screen.getByRole("button", { name: "Se connecter" }));

  await waitFor(() => expect(onConnecte).toHaveBeenCalledWith(UTILISATEUR));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("accessibilité : chaque action est un <button>, cibles ≥ 44 px, focus visible", () => {
  monterPage();

  const boutons = screen.getAllByRole("button");
  for (const bouton of boutons) {
    expect(bouton.tagName).toBe("BUTTON");
  }
  // Bouton principal pleine hauteur 56 px, toggle 44 px : classes de hauteur.
  expect(screen.getByRole("button", { name: "Se connecter" })).toHaveClass("h-14");
  expect(
    screen.getByRole("button", { name: "Afficher le mot de passe" }),
  ).toHaveClass("h-11");
  // Champs : hauteur 52 px.
  expect(screen.getByLabelText("Adresse e-mail")).toHaveClass("h-[52px]");
  expect(screen.getByLabelText("Mot de passe")).toHaveClass("h-[52px]");
  // Focus visible sur les champs et les boutons (outline au focus).
  expect(screen.getByLabelText("Adresse e-mail").className).toContain("focus-visible:outline-2");
  expect(
    screen.getByRole("button", { name: "Afficher le mot de passe" }).className,
  ).toContain("focus-visible:outline-2");
});
