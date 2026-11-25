/// <reference types="node" />
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MESSAGE_RESEAU, type Depense, type NoteDetail, type StatutNote, type TransitionRead } from "../api/client";
import { MiseEnPage } from "../components/MiseEnPage";
import { DossierDetailPage } from "./DossierDetailPage";
import { formatDateHeure } from "../lib/format";

/** Feuille d'impression globale, lue telle qu'écrite sur disque (cwd = racine web). */
const printCss = readFileSync(join(process.cwd(), "src", "print.css"), "utf-8");

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

function depense(partiel: Partial<Depense> & { id: number }): Depense {
  return {
    libelle: "Train Paris → Lyon",
    date_depense: "2026-11-17",
    montant_centimes: 7900,
    categorie: "transport",
    commentaire: null,
    note_id: 1,
    created_at: "2026-11-17T10:00:00Z",
    updated_at: "2026-11-17T10:00:00Z",
    ...partiel,
  };
}

function note(partiel: Partial<NoteDetail> & { id: number }): NoteDetail {
  return {
    libelle: "Semaine 47",
    statut: "brouillon",
    total_centimes: 18000,
    nb_depenses: 2,
    derniere_depense_le: "2026-11-17",
    created_at: "2026-11-18T12:00:00Z",
    updated_at: "2026-11-18T12:00:00Z",
    depenses: [
      depense({ id: 10, libelle: "Train", montant_centimes: 7900, categorie: "transport" }),
      depense({ id: 11, libelle: "Déjeuner", montant_centimes: 10100, categorie: "repas" }),
    ],
    ...partiel,
  };
}

function transition(partiel: Partial<TransitionRead> & { id: number }): TransitionRead {
  return {
    acteur: { id: 1, display_name: "Camille" },
    ancien_statut: "brouillon",
    nouveau_statut: "soumise",
    motif: null,
    created_at: "2026-11-18T12:00:00Z",
    ...partiel,
  };
}

/** Écran de destination de `/dossiers`, pour vérifier l'annonce portée par la navigation. */
function StubDossiers() {
  const location = useLocation();
  const annonce = (location.state as { annonce?: string } | null)?.annonce;
  return <div>LISTE DOSSIERS{annonce ? ` — ${annonce}` : ""}</div>;
}

function renderPage(url = "/dossiers/1") {
  const onSessionExpiree = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/dossiers/:id"
          element={<DossierDetailPage onSessionExpiree={onSessionExpiree} />}
        />
        <Route path="/dossiers" element={<StubDossiers />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onSessionExpiree, ...utils };
}

function installerApi(
  routeur: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (entree, init) => {
    return routeur(String(entree), init);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lecture du dossier", () => {
  test("affiche titre h1 focalisé, statut, sous-titre, total et liste ; un seul GET", async () => {
    const fetchMock = installerApi((url) =>
      url === "/api/v1/notes/1"
        ? jsonResponse(note({ id: 1 }))
        : jsonResponse({ detail: "Introuvable" }, 404),
    );

    renderPage();

    const titre = await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await waitFor(() => expect(titre).toHaveFocus());
    expect(screen.getByText("Brouillon")).toBeInTheDocument();
    expect(screen.getByText("2 dépenses")).toBeInTheDocument();
    expect(screen.getByText("180,00 €")).toBeInTheDocument();

    const liensDepense = screen
      .getAllByRole("link")
      .filter((lien) => lien.getAttribute("href")?.startsWith("/depenses/"));
    expect(liensDepense).toHaveLength(2);

    const appelsNote = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1" && (init?.method ?? "GET") === "GET",
    );
    expect(appelsNote).toHaveLength(1);
  });

  test("répartition : barre décorative aria-hidden et légende des seules catégories présentes", async () => {
    installerApi((url) =>
      url === "/api/v1/notes/1"
        ? jsonResponse(
            note({
              id: 1,
              total_centimes: 10000,
              nb_depenses: 2,
              depenses: [
                depense({ id: 10, libelle: "Train", montant_centimes: 3000, categorie: "transport" }),
                depense({ id: 11, libelle: "Déjeuner", montant_centimes: 7000, categorie: "repas" }),
              ],
            }),
          )
        : jsonResponse({ detail: "Introuvable" }, 404),
    );

    renderPage();

    const total = (await screen.findByText("Total")).closest("section")!;
    expect(within(total).getByText("100,00 €")).toBeInTheDocument();
    // Barre décorative : aria-hidden, présente car il y a des dépenses.
    expect(total.querySelector('div[aria-hidden="true"]')).toBeInTheDocument();
    // Légende : catégories présentes uniquement, avec leur montant.
    expect(within(total).getByText("Transport")).toBeInTheDocument();
    expect(within(total).getByText("30,00 €")).toBeInTheDocument();
    expect(within(total).getByText("Repas")).toBeInTheDocument();
    expect(within(total).getByText("70,00 €")).toBeInTheDocument();
    // Catégorie absente : jamais rendue.
    expect(within(total).queryByText("Hébergement")).not.toBeInTheDocument();
  });

  test("dossier sans dépense : total 0,00 €, pas de barre, état vide", async () => {
    installerApi((url) =>
      url === "/api/v1/notes/1"
        ? jsonResponse(note({ id: 1, total_centimes: 0, nb_depenses: 0, depenses: [] }))
        : jsonResponse({ detail: "Introuvable" }, 404),
    );

    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    expect(screen.getByText("0 dépense")).toBeInTheDocument();
    expect(screen.getByText("0,00 €")).toBeInTheDocument();
    expect(screen.getByText("Aucune dépense dans ce dossier.")).toBeInTheDocument();

    const total = screen.getByText("Total").closest("section")!;
    expect(total.querySelector('div[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  test("liste des dépenses : liens vers /depenses/:id dans l'ordre du serveur", async () => {
    installerApi((url) =>
      url === "/api/v1/notes/1"
        ? jsonResponse(
            note({
              id: 1,
              total_centimes: 300,
              nb_depenses: 3,
              depenses: [
                depense({ id: 30, libelle: "Troisième", montant_centimes: 100 }),
                depense({ id: 10, libelle: "Premier", montant_centimes: 100 }),
                depense({ id: 20, libelle: "Deuxième", montant_centimes: 100 }),
              ],
            }),
          )
        : jsonResponse({ detail: "Introuvable" }, 404),
    );

    renderPage();

    await screen.findByText("Troisième");
    const liens = screen
      .getAllByRole("link")
      .filter((lien) => lien.getAttribute("href")?.startsWith("/depenses/"))
      .map((lien) => lien.getAttribute("href"));
    expect(liens).toEqual(["/depenses/30", "/depenses/10", "/depenses/20"]);
  });

  test("hors brouillon : lecture seule, actions absentes, historique chargé", async () => {
    const fetchMock = installerApi((url) => {
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut: "soumise" }));
      if (url === "/api/v1/notes/1/historique") {
        return jsonResponse([transition({ id: 1, ancien_statut: "brouillon", nouveau_statut: "soumise" })]);
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    renderPage();

    await screen.findByRole("heading", { name: "Historique" });
    expect(screen.queryByRole("button", { name: "Ajouter des dépenses" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Renommer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supprimer le dossier" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Envoyer pour validation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retirer « / })).not.toBeInTheDocument();

    const appelsHistorique = fetchMock.mock.calls.filter(([entree]) =>
      String(entree).includes("/historique"),
    );
    expect(appelsHistorique).toHaveLength(1);
  });

  test("historique : date/heure fr-FR, acteur, transition et motif", async () => {
    const dateTransition = "2026-11-18T12:00:00Z";
    installerApi((url) => {
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut: "soumise" }));
      if (url === "/api/v1/notes/1/historique") {
        return jsonResponse([
          transition({
            id: 1,
            acteur: { id: 1, display_name: "Camille" },
            ancien_statut: "brouillon",
            nouveau_statut: "soumise",
            motif: "Frais professionnels conformes",
            created_at: dateTransition,
          }),
        ]);
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    renderPage();

    const historique = (await screen.findByRole("heading", { name: "Historique" })).closest(
      "section",
    )!;
    const ligne = await within(historique).findByText(/Camille/);
    expect(ligne).toHaveTextContent(formatDateHeure(dateTransition));
    expect(within(historique).getByText("Brouillon → Soumise")).toBeInTheDocument();
    expect(within(historique).getByText("Frais professionnels conformes")).toBeInTheDocument();
  });

  test("refusee : motif du refus dans un bloc role=status et « Rouvrir » ramène en édition", async () => {
    let statutCourant: StatutNote = "refusee";
    const fetchMock = installerApi((url, init) => {
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut: statutCourant }));
      if (url === "/api/v1/notes/1/historique") {
        return jsonResponse([
          transition({ id: 1, ancien_statut: "brouillon", nouveau_statut: "soumise", motif: null }),
          transition({
            id: 2,
            acteur: { id: 2, display_name: "Valideur" },
            ancien_statut: "soumise",
            nouveau_statut: "refusee",
            motif: "Justificatif manquant",
          }),
        ]);
      }
      if (url === "/api/v1/notes/1/rouvrir" && init?.method === "POST") {
        statutCourant = "brouillon";
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    const blocMotif = (await screen.findByText("Motif du refus")).closest(
      '[role="status"]',
    ) as HTMLElement;
    expect(within(blocMotif).getByText("Justificatif manquant")).toBeInTheDocument();

    await utilisateur.click(screen.getByRole("button", { name: "Rouvrir le dossier" }));

    // Retour en édition : pastille « Brouillon » et actions d'édition présentes.
    await screen.findByText("Brouillon");
    expect(screen.getByRole("button", { name: "Ajouter des dépenses" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Envoyer pour validation" })).toBeInTheDocument();

    expect(
      fetchMock.mock.calls.some(([entree]) => String(entree) === "/api/v1/notes/1/rouvrir"),
    ).toBe(true);
  });
});

describe("édition en brouillon", () => {
  test("actions disponibles : ajouter, retirer, renommer, supprimer, envoyer", async () => {
    installerApi((url) =>
      url === "/api/v1/notes/1"
        ? jsonResponse(note({ id: 1 }))
        : jsonResponse({ detail: "Introuvable" }, 404),
    );

    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    expect(screen.getByRole("button", { name: "Ajouter des dépenses" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Renommer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supprimer le dossier" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Envoyer pour validation" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retirer « Train » du dossier" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retirer « Déjeuner » du dossier" }),
    ).toBeInTheDocument();
  });

  test("ajout multiple : un seul POST batch puis rechargement et fermeture", async () => {
    const fetchMock = installerApi((url, init) => {
      if (url === "/api/v1/notes/1/depenses" && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1 }));
      if (url === "/api/v1/depenses?a_classer=true") {
        return jsonResponse([
          depense({ id: 20, libelle: "Taxi", note_id: null }),
          depense({ id: 21, libelle: "Péage", note_id: null }),
        ]);
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Ajouter des dépenses" }));

    const dialogue = await screen.findByRole("dialog");
    await utilisateur.click(within(dialogue).getByRole("checkbox", { name: /Taxi/ }));
    await utilisateur.click(within(dialogue).getByRole("checkbox", { name: /Péage/ }));
    await utilisateur.click(within(dialogue).getByRole("button", { name: "Ajouter" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const appelsPost = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1/depenses" && init?.method === "POST",
    );
    expect(appelsPost).toHaveLength(1);
    expect(JSON.parse(String(appelsPost[0][1]!.body))).toEqual({ depense_ids: [20, 21] });

    const appelsNote = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1" && (init?.method ?? "GET") === "GET",
    );
    expect(appelsNote).toHaveLength(2);
  });

  test("panneau d'ajout vide : « Aucune dépense à classer. » et bouton Ajouter désactivé", async () => {
    installerApi((url) => {
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1 }));
      if (url === "/api/v1/depenses?a_classer=true") return jsonResponse([]);
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Ajouter des dépenses" }));

    const dialogue = await screen.findByRole("dialog");
    expect(within(dialogue).getByText("Aucune dépense à classer.")).toBeInTheDocument();
    expect(within(dialogue).getByRole("button", { name: "Ajouter" })).toBeDisabled();
  });

  test("échec d'ajout 409 : message, panneau ouvert, sélection conservée, détail inchangé", async () => {
    const fetchMock = installerApi((url, init) => {
      if (url === "/api/v1/notes/1/depenses" && init?.method === "POST") {
        return jsonResponse({ detail: "Une dépense est déjà rattachée à un dossier." }, 409);
      }
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1 }));
      if (url === "/api/v1/depenses?a_classer=true") {
        return jsonResponse([depense({ id: 20, libelle: "Taxi", note_id: null })]);
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Ajouter des dépenses" }));

    const dialogue = await screen.findByRole("dialog");
    await utilisateur.click(within(dialogue).getByRole("checkbox", { name: /Taxi/ }));
    await utilisateur.click(within(dialogue).getByRole("button", { name: "Ajouter" }));

    expect(await within(dialogue).findByRole("alert")).toHaveTextContent(
      "Une dépense est déjà rattachée à un dossier.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialogue).getByRole("checkbox", { name: /Taxi/ })).toBeChecked();

    const appelsNote = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1" && (init?.method ?? "GET") === "GET",
    );
    expect(appelsNote).toHaveLength(1);
  });

  test("retrait : DELETE unitaire puis mise à jour sans rechargement complet", async () => {
    const fetchMock = installerApi((url, init) => {
      if (url === "/api/v1/notes/1/depenses/10" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1 }));
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Retirer « Train » du dossier" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([entree, init]) =>
            String(entree) === "/api/v1/notes/1/depenses/10" && init?.method === "DELETE",
        ),
      ).toBe(true),
    );

    const appelsNote = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1" && (init?.method ?? "GET") === "GET",
    );
    expect(appelsNote).toHaveLength(2);
  });

  test("échec de retrait 409 : message et resynchronisation", async () => {
    const fetchMock = installerApi((url, init) => {
      if (url === "/api/v1/notes/1/depenses/10" && init?.method === "DELETE") {
        return jsonResponse({ detail: "La dépense n'est pas dans ce dossier." }, 409);
      }
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1 }));
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Retirer « Train » du dossier" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La dépense n'est pas dans ce dossier.",
    );

    const appelsNote = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1" && (init?.method ?? "GET") === "GET",
    );
    expect(appelsNote).toHaveLength(2);
  });

  test("renommage : titre vide → erreur locale sans appel réseau", async () => {
    const fetchMock = installerApi((url) =>
      url === "/api/v1/notes/1"
        ? jsonResponse(note({ id: 1 }))
        : jsonResponse({ detail: "Introuvable" }, 404),
    );

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Renommer" }));

    const champ = screen.getByLabelText("Titre");
    await utilisateur.clear(champ);
    await utilisateur.type(champ, "   ");
    await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Le libellé est requis.");
    const appelsPatch = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(appelsPatch).toHaveLength(0);
  });

  test("renommage valide : PATCH avec le libellé élagué puis mise à jour du titre", async () => {
    let libelleCourant = "Semaine 47";
    const fetchMock = installerApi((url, init) => {
      if (url === "/api/v1/notes/1" && init?.method === "PATCH") {
        libelleCourant = (JSON.parse(String(init.body)) as { libelle: string }).libelle;
        return jsonResponse(note({ id: 1, libelle: libelleCourant }));
      }
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, libelle: libelleCourant }));
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Renommer" }));

    const champ = screen.getByLabelText("Titre");
    expect(champ).toHaveValue("Semaine 47");
    await utilisateur.clear(champ);
    await utilisateur.type(champ, "   Déplacement Lyon   ");
    await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Déplacement Lyon" }),
    ).toBeInTheDocument();

    const appelsPatch = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(appelsPatch).toHaveLength(1);
    expect(JSON.parse(String(appelsPatch[0][1]!.body))).toEqual({ libelle: "Déplacement Lyon" });
  });

  test("renommage 409 : message serveur puis lecture seule après rechargement", async () => {
    let statutCourant: StatutNote = "brouillon";
    installerApi((url, init) => {
      if (url === "/api/v1/notes/1" && init?.method === "PATCH") {
        return jsonResponse({ detail: "Le dossier n'est plus modifiable." }, 409);
      }
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut: statutCourant }));
      if (url === "/api/v1/notes/1/historique") {
        return jsonResponse([
          transition({ id: 1, ancien_statut: "brouillon", nouveau_statut: "soumise" }),
        ]);
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Renommer" }));
    await utilisateur.clear(screen.getByLabelText("Titre"));
    await utilisateur.type(screen.getByLabelText("Titre"), "Nouveau titre");
    statutCourant = "soumise";
    await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le dossier n'est plus modifiable.",
    );
    await screen.findByRole("heading", { name: "Historique" });
    expect(screen.queryByRole("button", { name: "Ajouter des dépenses" })).not.toBeInTheDocument();
  });

  test("suppression : confirmation puis DELETE puis navigation avec annonce", async () => {
    const fetchMock = installerApi((url, init) => {
      if (url === "/api/v1/notes/1" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1 }));
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Supprimer le dossier" }));

    expect(
      screen.getByText(
        "Supprimer ce dossier ? Les dépenses seront conservées et redeviendront à classer.",
      ),
    ).toBeInTheDocument();

    await utilisateur.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(await screen.findByText(/Dossier supprimé/)).toBeInTheDocument();
    const appelsDelete = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1" && init?.method === "DELETE",
    );
    expect(appelsDelete).toHaveLength(1);
  });

  test("suppression 409 : message et confirmation reste ouverte", async () => {
    installerApi((url, init) => {
      if (url === "/api/v1/notes/1" && init?.method === "DELETE") {
        return jsonResponse({ detail: "Le dossier n'est pas supprimable." }, 409);
      }
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1 }));
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Supprimer le dossier" }));
    await utilisateur.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le dossier n'est pas supprimable.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("envoi : confirmation, POST /soumettre, pastille « Soumise » et lecture seule", async () => {
    let statutCourant: StatutNote = "brouillon";
    const fetchMock = installerApi((url, init) => {
      if (url === "/api/v1/notes/1/soumettre" && init?.method === "POST") {
        statutCourant = "soumise";
        return new Response(null, { status: 204 });
      }
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut: statutCourant }));
      if (url === "/api/v1/notes/1/historique") {
        return jsonResponse([
          transition({ id: 1, ancien_statut: "brouillon", nouveau_statut: "soumise" }),
        ]);
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer pour validation" }));

    expect(
      screen.getByText("Envoyer ce dossier pour validation ? Il ne sera plus modifiable."),
    ).toBeInTheDocument();

    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Dossier envoyé pour validation.",
    );
    // Pastille « Soumise » et lecture seule après rechargement.
    await screen.findByText("Soumise");
    expect(
      screen.queryByRole("button", { name: "Envoyer pour validation" }),
    ).not.toBeInTheDocument();

    const appelsSoumettre = fetchMock.mock.calls.filter(([entree]) =>
      String(entree).includes("/soumettre"),
    );
    expect(appelsSoumettre).toHaveLength(1);
  });

  test("envoi 409 sans dépense : message serveur affiché", async () => {
    installerApi((url, init) => {
      if (url === "/api/v1/notes/1/soumettre" && init?.method === "POST") {
        return jsonResponse(
          { detail: "Le dossier doit contenir au moins une dépense pour être soumis." },
          409,
        );
      }
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1 }));
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer pour validation" }));
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le dossier doit contenir au moins une dépense pour être soumis.",
    );
  });
});

describe("erreurs de chargement", () => {
  test("chargement : aria-busy=true pendant, absent une fois chargé", async () => {
    let resoudreNote!: (reponse: Response) => void;
    installerApi((url) => {
      if (url === "/api/v1/notes/1") {
        return new Promise<Response>((resoudre) => {
          resoudreNote = resoudre;
        });
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    renderPage();

    expect(screen.getByText("Chargement…")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");

    resoudreNote(jsonResponse(note({ id: 1 })));
    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    expect(screen.getByRole("main")).not.toHaveAttribute("aria-busy");
  });

  test("404 : « Ce dossier est introuvable. » et lien de retour, sans « Réessayer »", async () => {
    installerApi(() => jsonResponse({ detail: "Note introuvable." }, 404));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Ce dossier est introuvable.");
    const lien = screen.getByRole("link", { name: "Retour aux dossiers" });
    expect(lien).toHaveAttribute("href", "/dossiers");
    expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
  });

  test("erreur réseau : « Réessayer » relance l'appel", async () => {
    let appels = 0;
    installerApi((url) => {
      if (url !== "/api/v1/notes/1") return jsonResponse({ detail: "Introuvable" }, 404);
      appels += 1;
      if (appels === 1) throw new Error("réseau");
      return jsonResponse(note({ id: 1 }));
    });

    const utilisateur = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Semaine 47" })).toBeInTheDocument();
    expect(appels).toBe(2);
  });

  test("401 au chargement : la session est considérée expirée", async () => {
    installerApi(() => jsonResponse({ detail: "Session expirée." }, 401));

    const { onSessionExpiree } = renderPage();

    await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
  });
});

describe("export CSV et impression (US-029)", () => {
  /** Réponse CSV avec l'en-tête Content-Disposition usuel. */
  function csvResponse(
    contenu = "date;libellé\n2026-11-17;Train\n",
    enTete: string | null = 'attachment; filename="note-1.csv"',
  ): Response {
    return new Response(contenu, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        ...(enTete === null ? {} : { "Content-Disposition": enTete }),
      },
    });
  }

  /** Mock fetch : le dossier a le statut donné, l'historique renvoie une transition. */
  function installerApiStatut(statut: StatutNote) {
    return installerApi((url) => {
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut }));
      if (url === "/api/v1/notes/1/historique") {
        return jsonResponse([
          transition({ id: 1, ancien_statut: "brouillon", nouveau_statut: statut }),
        ]);
      }
      return jsonResponse({ detail: "Note introuvable." }, 404);
    });
  }

  /** Bouchons URL.createObjectURL / revokeObjectURL + espion de clic sur le lien créé. */
  function installerUrlObjet() {
    const cree = vi.fn(() => "blob:mock-url");
    const revoque = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: cree,
      revokeObjectURL: revoque,
    }));
    const clics: { href: string; download: string }[] = [];
    const createElementOriginal = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const element = createElementOriginal(tag, options);
      if (tag === "a") {
        vi.spyOn(element as HTMLAnchorElement, "click").mockImplementation(() => {
          const lien = element as HTMLAnchorElement;
          clics.push({ href: lien.href, download: lien.download });
        });
      }
      return element;
    });
    return { cree, revoque, clics };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each(["validee", "remboursee"] as const)(
    "statut %s : « Télécharger le CSV » et « Imprimer » sont disponibles",
    async (statut) => {
      installerApiStatut(statut);

      renderPage();

      await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
      expect(
        screen.getByRole("button", { name: "Télécharger le CSV" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Imprimer" })).toBeInTheDocument();
    },
  );

  test.each(["brouillon", "soumise", "refusee"] as const)(
    "statut %s : aucune des deux actions n'est affichée",
    async (statut) => {
      installerApiStatut(statut);

      renderPage();

      await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
      expect(
        screen.queryByRole("button", { name: "Télécharger le CSV" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Imprimer" })).not.toBeInTheDocument();
    },
  );

  test("« Télécharger le CSV » appelle la bonne URL, crée un lien temporaire avec le nom de l'en-tête et révoque l'URL d'objet", async () => {
    const fetchMock = installerApi((url) => {
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut: "validee" }));
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/notes/1/export.csv") {
        return csvResponse("date;libellé\n", 'attachment; filename="note-1.csv"');
      }
      return jsonResponse({ detail: "Note introuvable." }, 404);
    });
    const urlObjet = installerUrlObjet();

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Télécharger le CSV" }));

    await waitFor(() => expect(urlObjet.clics).toHaveLength(1));
    const appelExport = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1/export.csv" && (init?.method ?? "GET") === "GET",
    );
    expect(appelExport).toHaveLength(1);
    expect(appelExport[0][1]?.credentials).toBe("same-origin");
    expect(urlObjet.cree).toHaveBeenCalledTimes(1);
    expect(urlObjet.clics[0]).toEqual({ href: "blob:mock-url", download: "note-1.csv" });
    expect(urlObjet.revoque).toHaveBeenCalledWith("blob:mock-url");
    // Aucune navigation : la page reste sur le dossier.
    expect(screen.getByRole("heading", { level: 1, name: "Semaine 47" })).toBeInTheDocument();
  });

  test("repli du nom de fichier quand l'en-tête Content-Disposition est absent", async () => {
    installerApi((url) => {
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut: "remboursee" }));
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/notes/1/export.csv") return csvResponse("a;b\n", null);
      return jsonResponse({ detail: "Note introuvable." }, 404);
    });
    const urlObjet = installerUrlObjet();

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Télécharger le CSV" }));

    await waitFor(() => expect(urlObjet.clics).toHaveLength(1));
    expect(urlObjet.clics[0].download).toBe("note-1.csv");
  });

  test("échec 404 de l'export : alerte role=alert avec le message de l'API, la page reste sur le dossier", async () => {
    installerApi((url) => {
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut: "validee" }));
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/notes/1/export.csv") {
        return jsonResponse({ detail: "Note introuvable." }, 404);
      }
      return jsonResponse({ detail: "Note introuvable." }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Télécharger le CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Note introuvable.");
    expect(screen.getByRole("heading", { level: 1, name: "Semaine 47" })).toBeInTheDocument();
  });

  test("panne réseau lors de l'export : alerte avec le message réseau", async () => {
    installerApi((url) => {
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut: "validee" }));
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/notes/1/export.csv") throw new Error("réseau");
      return jsonResponse({ detail: "Note introuvable." }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Télécharger le CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(MESSAGE_RESEAU);
  });

  test("pendant le téléchargement le bouton est désactivé et aria-busy ; un double clic ne déclenche qu'un seul appel", async () => {
    let resoudreExport!: (reponse: Response) => void;
    const fetchMock = installerApi((url) => {
      if (url === "/api/v1/notes/1") return jsonResponse(note({ id: 1, statut: "validee" }));
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/notes/1/export.csv") {
        return new Promise<Response>((resoudre) => {
          resoudreExport = resoudre;
        });
      }
      return jsonResponse({ detail: "Note introuvable." }, 404);
    });
    installerUrlObjet();

    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    const bouton = screen.getByRole("button", { name: "Télécharger le CSV" });
    // Double clic avant même le premier re-rendu.
    fireEvent.click(bouton);
    fireEvent.click(bouton);

    expect(bouton).toBeDisabled();
    expect(bouton).toHaveAttribute("aria-busy", "true");

    resoudreExport(csvResponse());
    await waitFor(() => expect(bouton).not.toBeDisabled());
    expect(bouton).not.toHaveAttribute("aria-busy");

    const appelsExport = fetchMock.mock.calls.filter(
      ([entree]) => String(entree) === "/api/v1/notes/1/export.csv",
    );
    expect(appelsExport).toHaveLength(1);
  });

  test("« Imprimer » appelle window.print() une fois, sans aucune requête réseau", async () => {
    const fetchMock = installerApiStatut("validee");
    const printMock = vi.fn();
    vi.stubGlobal("print", printMock);

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    const nbAppelsAvant = fetchMock.mock.calls.length;
    await utilisateur.click(screen.getByRole("button", { name: "Imprimer" }));

    expect(printMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.length).toBe(nbAppelsAvant);
  });

  test("impression : la barre de navigation, les actions et les liens d'édition sont masqués en print:", async () => {
    installerApiStatut("validee");

    render(
      <MemoryRouter initialEntries={["/dossiers/1"]}>
        <Routes>
          <Route
            element={
              <MiseEnPage
                utilisateur={{ id: 1, email: "a@b.c", display_name: "Camille", role: "utilisateur" }}
              />
            }
          >
            <Route
              path="/dossiers/:id"
              element={<DossierDetailPage onSessionExpiree={vi.fn()} />}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });

    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(nav.className).toContain("print:hidden");

    const boutonCsv = screen.getByRole("button", { name: "Télécharger le CSV" });
    const boutonImprimer = screen.getByRole("button", { name: "Imprimer" });
    expect(boutonCsv.closest("div")!.className).toContain("print:hidden");
    expect(boutonImprimer.closest("div")!.className).toContain("print:hidden");

    const entete = screen.getByRole("banner");
    expect(entete.className).toContain("print:hidden");

    // Liens vers les dépenses : visibles à l'impression (pas de print:hidden).
    const liensDepense = screen
      .getAllByRole("link")
      .filter((lien) => /^\/depenses\/\d+$/.test(lien.getAttribute("href") ?? ""));
    expect(liensDepense.length).toBeGreaterThan(0);
    for (const lien of liensDepense) {
      expect(lien.className).not.toContain("print:hidden");
      expect(lien.closest("li")!.className).toContain("print:break-inside-avoid");
    }
  });

  test("impression : en-tête du dossier, dépenses et historique conservent leurs contenus visibles", async () => {
    installerApiStatut("remboursee");

    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    // En-tête : titre, statut, total, nombre de dépenses.
    expect(screen.getByText("Remboursée")).toBeInTheDocument();
    expect(screen.getByText("180,00 €")).toBeInTheDocument();
    expect(screen.getByText("2 dépenses")).toBeInTheDocument();
    // Dépenses : libellé, date, montant.
    expect(screen.getByText("Train")).toBeInTheDocument();
    expect(screen.getAllByText("79,00 €").length).toBeGreaterThan(0);
    expect(screen.getByText("Déjeuner")).toBeInTheDocument();
    // Historique visible.
    await screen.findByRole("heading", { name: "Historique" });
    expect(screen.getByText("Brouillon → Remboursée")).toBeInTheDocument();
  });

  test("feuille d'impression globale : marges 12 mm, fond blanc, texte noir", () => {
    expect(printCss).toContain("@media print");
    expect(printCss).toMatch(/@page\s*{[^}]*margin:\s*12mm/);
    expect(printCss).toMatch(/background:\s*#ffffff\s*!important/);
    expect(printCss).toMatch(/color:\s*#000000\s*!important/);
    // Aucune classe d'écran n'est définie dans print.css.
    expect(printCss).not.toMatch(/^\.[a-z-]+\s*{/m);
  });
});
