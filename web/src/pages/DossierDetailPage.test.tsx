import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import type { Depense, NoteDetail, StatutNote, TransitionRead } from "../api/client";
import { DossierDetailPage } from "./DossierDetailPage";
import { formatDateHeure } from "../lib/format";

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
