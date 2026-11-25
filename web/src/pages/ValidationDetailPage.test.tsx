import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import type {
  Depense,
  StatutNote,
  TransitionRead,
  UserRead,
  ValidationNoteDetail,
} from "../api/client";
import { MiseEnPage } from "../components/MiseEnPage";
import { ValidationDetailPage } from "./ValidationDetailPage";
import { formatDateCourte, formatDateHeure } from "../lib/format";

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

function note(partiel: Partial<ValidationNoteDetail> & { id: number }): ValidationNoteDetail {
  return {
    libelle: "Semaine 47",
    statut: "soumise",
    total_centimes: 18000,
    nb_depenses: 2,
    soumise_at: "2026-11-18T12:00:00Z",
    proprietaire: { id: 2, display_name: "Camille" },
    depenses: [
      depense({ id: 10, libelle: "Train", montant_centimes: 7900, categorie: "transport" }),
      depense({ id: 11, libelle: "Déjeuner", montant_centimes: 10100, categorie: "repas" }),
    ],
    ...partiel,
  };
}

function transition(partiel: Partial<TransitionRead> & { id: number }): TransitionRead {
  return {
    acteur: { id: 2, display_name: "Camille" },
    ancien_statut: "brouillon",
    nouveau_statut: "soumise",
    motif: null,
    created_at: "2026-11-18T12:00:00Z",
    ...partiel,
  };
}

/** Écran de destination de `/validation`, pour vérifier l'annonce portée par la navigation. */
function StubValidation() {
  const location = useLocation();
  const annonce = (location.state as { annonce?: string } | null)?.annonce;
  return <div>LISTE VALIDATION{annonce ? ` — ${annonce}` : ""}</div>;
}

function renderPage(url = "/validation/1", role: UserRead["role"] = "valideur") {
  const onSessionExpiree = vi.fn();
  const utilisateur: UserRead = {
    id: 3,
    email: "valideur@exemple.fr",
    display_name: "Valideur",
    role,
  };
  const utils = render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/validation/:id"
          element={
            <ValidationDetailPage utilisateur={utilisateur} onSessionExpiree={onSessionExpiree} />
          }
        />
        <Route path="/validation" element={<StubValidation />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onSessionExpiree, ...utils };
}

/** Rendu avec la barre de navigation (MiseEnPage), pour tester les variantes print. */
function renderPageAvecMiseEnPage(role: UserRead["role"] = "admin") {
  const onSessionExpiree = vi.fn();
  const utilisateur: UserRead = {
    id: 3,
    email: "admin@exemple.fr",
    display_name: "Admin",
    role,
  };
  const utils = render(
    <MemoryRouter initialEntries={["/validation/1"]}>
      <Routes>
        <Route element={<MiseEnPage utilisateur={utilisateur} />}>
          <Route
            path="/validation/:id"
            element={
              <ValidationDetailPage utilisateur={utilisateur} onSessionExpiree={onSessionExpiree} />
            }
          />
        </Route>
        <Route path="/validation" element={<StubValidation />} />
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

/** Fait répondre « aucune photo » aux appels justificatif non gérés. */
function apiAvecJustificatifsParDefaut(
  routeur: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  return (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/v1/depenses/") && url.endsWith("/justificatif")) {
      return jsonResponse({ detail: "Introuvable" }, 404);
    }
    return routeur(url, init);
  };
}

const createObjectURL = vi.fn(() => "blob:apercu-ticket");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lecture du dossier", () => {
  test("lance deux appels (détail + historique) et affiche demandeur, titre, statut, total, date d'envoi et nombre de dépenses", async () => {
    const fetchMock = installerApi(
      apiAvecJustificatifsParDefaut((url) => {
        if (url === "/api/v1/validation/notes/1") return jsonResponse(note({ id: 1 }));
        if (url === "/api/v1/notes/1/historique") return jsonResponse([transition({ id: 1 })]);
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Semaine 47" }),
    ).toBeInTheDocument();
    // Pastille de statut.
    expect(screen.getByText("Soumise")).toBeInTheDocument();
    // Demandeur.
    expect(screen.getByText("Camille")).toBeInTheDocument();
    // Total.
    expect(screen.getByText("180,00 €")).toBeInTheDocument();
    // Nombre de dépenses.
    expect(screen.getByText("2 dépenses")).toBeInTheDocument();
    // Date d'envoi.
    const ligneEnvoi = screen.getByText((contenu) => contenu.startsWith("Envoyé le"));
    expect(ligneEnvoi).toHaveTextContent(formatDateHeure("2026-11-18T12:00:00Z"));

    expect(
      fetchMock.mock.calls.some(([entree]) => String(entree) === "/api/v1/validation/notes/1"),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([entree]) => String(entree) === "/api/v1/notes/1/historique"),
    ).toBe(true);
  });

  test("dépenses affichées dans l'ordre du serveur, sans tri client", async () => {
    installerApi(
      apiAvecJustificatifsParDefaut((url) => {
        if (url === "/api/v1/validation/notes/1") {
          return jsonResponse(
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
          );
        }
        if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    renderPage();

    await screen.findByText("Troisième");
    const section = screen.getByRole("region", { name: "Dépenses" });
    const libelles = within(section)
      .getAllByText(/^(Troisième|Premier|Deuxième)$/)
      .map((element) => element.textContent);
    expect(libelles).toEqual(["Troisième", "Premier", "Deuxième"]);
    expect(within(section).getAllByText("1,00 €")).toHaveLength(3);
    // Chaque dépense affiche sa date (formatDateCourte) et sa bulle de catégorie.
    expect(within(section).getAllByText(formatDateCourte("2026-11-17"))).toHaveLength(3);
    expect(
      section.querySelectorAll("span[style*='--categorie-transport-fond']"),
    ).toHaveLength(3);
  });

  test("justificatif image : vignette, agrandissement au clic, object URL révoquée au démontage", async () => {
    installerApi((url) => {
      if (url === "/api/v1/validation/notes/1") {
        return jsonResponse(
          note({ id: 1, nb_depenses: 1, depenses: [depense({ id: 10, libelle: "Train" })] }),
        );
      }
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/depenses/10/justificatif") {
        return new Response("png", { status: 200, headers: { "Content-Type": "image/png" } });
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    const { unmount } = renderPage();

    const vignette = await screen.findByRole("button", {
      name: "Agrandir le justificatif : Train",
    });
    expect(within(vignette).getByRole("img", { name: "Justificatif : Train" })).toHaveAttribute(
      "src",
      "blob:apercu-ticket",
    );
    expect(createObjectURL).toHaveBeenCalled();

    await utilisateur.click(vignette);
    expect(
      screen.getByRole("dialog", { name: "Justificatif agrandi : Train" }),
    ).toBeInTheDocument();

    await utilisateur.click(screen.getByRole("button", { name: "Fermer" }));
    expect(
      screen.queryByRole("dialog", { name: "Justificatif agrandi : Train" }),
    ).not.toBeInTheDocument();

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:apercu-ticket");
  });

  test("justificatif PDF : lien « Ouvrir le PDF » vers la route dédiée", async () => {
    installerApi((url) => {
      if (url === "/api/v1/validation/notes/1") {
        return jsonResponse(
          note({ id: 1, nb_depenses: 1, depenses: [depense({ id: 10, libelle: "Train" })] }),
        );
      }
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/depenses/10/justificatif") {
        return new Response("%PDF", { status: 200, headers: { "Content-Type": "application/pdf" } });
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    renderPage();

    const lien = await screen.findByRole("link", { name: "Ouvrir le PDF" });
    expect(lien).toHaveAttribute("href", "/api/v1/depenses/10/justificatif");
    expect(lien).toHaveAttribute("target", "_blank");
  });

  test("justificatif 404 : « Aucune photo »", async () => {
    installerApi(
      apiAvecJustificatifsParDefaut((url) => {
        if (url === "/api/v1/validation/notes/1") {
          return jsonResponse(
            note({ id: 1, nb_depenses: 1, depenses: [depense({ id: 10, libelle: "Train" })] }),
          );
        }
        if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    renderPage();

    expect(await screen.findByText("Aucune photo")).toBeInTheDocument();
  });

  test("échec de chargement d'une photo : « Aucune photo » sans bloquer les autres dépenses", async () => {
    installerApi((url) => {
      if (url === "/api/v1/validation/notes/1") {
        return jsonResponse(
          note({
            id: 1,
            depenses: [
              depense({ id: 10, libelle: "Train" }),
              depense({ id: 11, libelle: "Déjeuner", categorie: "repas" }),
            ],
          }),
        );
      }
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/depenses/10/justificatif") throw new Error("réseau");
      if (url === "/api/v1/depenses/11/justificatif") {
        return new Response("png", { status: 200, headers: { "Content-Type": "image/png" } });
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    renderPage();

    await screen.findByRole("button", { name: "Agrandir le justificatif : Déjeuner" });
    expect(screen.getByText("Train")).toBeInTheDocument();
    expect(screen.getByText("Aucune photo")).toBeInTheDocument();
  });

  test("historique : acteur, transition en libellés français, date/heure et motif encadré quand présent", async () => {
    const dateTransition = "2026-11-18T12:00:00Z";
    installerApi(
      apiAvecJustificatifsParDefaut((url) => {
        if (url === "/api/v1/validation/notes/1") return jsonResponse(note({ id: 1 }));
        if (url === "/api/v1/notes/1/historique") {
          return jsonResponse([
            transition({ id: 1, ancien_statut: "brouillon", nouveau_statut: "soumise", motif: null }),
            transition({
              id: 2,
              acteur: { id: 3, display_name: "Valideur" },
              ancien_statut: "soumise",
              nouveau_statut: "refusee",
              motif: "Justificatif manquant",
              created_at: dateTransition,
            }),
          ]);
        }
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    renderPage();

    const historique = (await screen.findByRole("heading", { name: "Historique" })).closest(
      "section",
    )!;
    expect(within(historique).getByText("Brouillon → Soumise")).toBeInTheDocument();
    expect(within(historique).getByText("Soumise → Refusée")).toBeInTheDocument();
    expect(within(historique).getByText(/Camille/)).toBeInTheDocument();
    const ligneRefus = within(historique).getByText(/Valideur/);
    expect(ligneRefus).toHaveTextContent(formatDateHeure(dateTransition));
    // Motif encadré uniquement sur la transition qui en porte un.
    expect(within(historique).getByText("Justificatif manquant")).toBeInTheDocument();
  });
});

describe("décision", () => {
  test("statut soumise : boutons « Valider » et « Refuser » visibles", async () => {
    installerApi(
      apiAvecJustificatifsParDefaut((url) => {
        if (url === "/api/v1/validation/notes/1") return jsonResponse(note({ id: 1 }));
        if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    renderPage();

    expect(await screen.findByRole("button", { name: "Valider" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refuser" })).toBeInTheDocument();
  });

  test("statut autre que soumise : boutons absents", async () => {
    installerApi(
      apiAvecJustificatifsParDefaut((url) => {
        if (url === "/api/v1/validation/notes/1") {
          return jsonResponse(note({ id: 1, statut: "validee" }));
        }
        if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    expect(screen.queryByRole("button", { name: "Valider" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refuser" })).not.toBeInTheDocument();
  });

  test("valider : confirmation, un seul POST, bouton désactivé/aria-busy pendant l'envoi, navigation avec annonce", async () => {
    let resolvePost!: (reponse: Response) => void;
    const fetchMock = installerApi((url, init) => {
      if (url === "/api/v1/validation/notes/1") return jsonResponse(note({ id: 1 }));
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/notes/1/valider" && init?.method === "POST") {
        return new Promise<Response>((resoudre) => {
          resolvePost = resoudre;
        });
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await utilisateur.click(await screen.findByRole("button", { name: "Valider" }));
    expect(
      screen.getByRole("heading", { name: "Valider ce dossier ?" }),
    ).toBeInTheDocument();

    await utilisateur.click(screen.getByRole("button", { name: "Confirmer" }));

    // Pendant l'envoi : bouton désactivé + aria-busy. Un second clic ne produit qu'un appel.
    const bouton = screen.getByRole("button", { name: "En cours…" });
    expect(bouton).toBeDisabled();
    expect(bouton).toHaveAttribute("aria-busy", "true");
    fireEvent.click(bouton);

    resolvePost(new Response(null, { status: 204 }));

    expect(await screen.findByText(/Dossier validé/)).toBeInTheDocument();

    const appelsPost = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1/valider" && init?.method === "POST",
    );
    expect(appelsPost).toHaveLength(1);
  });

  test("refuser : motif vide (même après espaces) → bouton désactivé ; saisie → activé", async () => {
    installerApi(
      apiAvecJustificatifsParDefaut((url) => {
        if (url === "/api/v1/validation/notes/1") return jsonResponse(note({ id: 1 }));
        if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    const utilisateur = userEvent.setup();
    renderPage();

    await utilisateur.click(await screen.findByRole("button", { name: "Refuser" }));

    const dialogue = screen.getByRole("dialog");
    const champ = within(dialogue).getByLabelText("Motif du refus");
    const confirmer = within(dialogue).getByRole("button", { name: "Confirmer le refus" });

    expect(confirmer).toBeDisabled();
    expect(champ).toHaveAttribute("maxLength", "1000");

    await utilisateur.type(champ, "   ");
    expect(confirmer).toBeDisabled();

    await utilisateur.type(champ, "Justificatif manquant");
    expect(confirmer).toBeEnabled();
  });

  test("refuser : POST /refuser avec le motif élagué, retour à /validation avec annonce", async () => {
    const fetchMock = installerApi((url, init) => {
      if (url === "/api/v1/validation/notes/1") return jsonResponse(note({ id: 1 }));
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/notes/1/refuser" && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await utilisateur.click(await screen.findByRole("button", { name: "Refuser" }));
    const dialogue = screen.getByRole("dialog");
    await utilisateur.type(
      within(dialogue).getByLabelText("Motif du refus"),
      "  Justificatif manquant  ",
    );
    await utilisateur.click(within(dialogue).getByRole("button", { name: "Confirmer le refus" }));

    expect(await screen.findByText(/Dossier refusé/)).toBeInTheDocument();

    const appelsPost = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1/refuser" && init?.method === "POST",
    );
    expect(appelsPost).toHaveLength(1);
    expect(JSON.parse(String(appelsPost[0][1]!.body))).toEqual({
      motif: "Justificatif manquant",
    });
  });

  test("403 (appelant propriétaire) : message API affiché tel quel, aucune navigation", async () => {
    installerApi((url, init) => {
      if (url === "/api/v1/validation/notes/1") return jsonResponse(note({ id: 1 }));
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/notes/1/valider" && init?.method === "POST") {
        return jsonResponse(
          { detail: "Vous ne pouvez pas valider votre propre dossier." },
          403,
        );
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await utilisateur.click(await screen.findByRole("button", { name: "Valider" }));
    await utilisateur.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vous ne pouvez pas valider votre propre dossier.",
    );
    // Le dossier reste à l'écran, la confirmation est refermée, aucune navigation.
    expect(screen.getByRole("heading", { level: 1, name: "Semaine 47" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/LISTE VALIDATION/)).not.toBeInTheDocument();
  });

  test("409 : message affiché puis détail et historique rechargés", async () => {
    let appelsNote = 0;
    let appelsHistorique = 0;
    installerApi((url, init) => {
      if (url === "/api/v1/notes/1/valider" && init?.method === "POST") {
        return jsonResponse({ detail: "Le dossier a déjà été traité." }, 409);
      }
      if (url === "/api/v1/validation/notes/1") {
        appelsNote += 1;
        const statut: StatutNote = appelsNote === 1 ? "soumise" : "validee";
        return jsonResponse(note({ id: 1, statut }));
      }
      if (url === "/api/v1/notes/1/historique") {
        appelsHistorique += 1;
        const transitions = appelsHistorique === 1
          ? [transition({ id: 1 })]
          : [
              transition({ id: 1 }),
              transition({ id: 2, ancien_statut: "soumise", nouveau_statut: "validee" }),
            ];
        return jsonResponse(transitions);
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await utilisateur.click(await screen.findByRole("button", { name: "Valider" }));
    await utilisateur.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le dossier a déjà été traité.",
    );
    // Resynchronisation : le statut passe à « Validée » et les boutons disparaissent.
    await screen.findByText("Validée");
    expect(screen.queryByRole("button", { name: "Valider" })).not.toBeInTheDocument();
    expect(appelsNote).toBeGreaterThanOrEqual(2);
    expect(appelsHistorique).toBeGreaterThanOrEqual(2);
  });

  test("422 : message API affiché au niveau du champ motif, dialogue ouvert", async () => {
    installerApi((url, init) => {
      if (url === "/api/v1/validation/notes/1") return jsonResponse(note({ id: 1 }));
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/notes/1/refuser" && init?.method === "POST") {
        return jsonResponse(
          { detail: [{ loc: ["body", "motif"], msg: "Le motif est trop long." }] },
          422,
        );
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await utilisateur.click(await screen.findByRole("button", { name: "Refuser" }));
    const dialogue = screen.getByRole("dialog");
    await utilisateur.type(within(dialogue).getByLabelText("Motif du refus"), "Trop long");
    await utilisateur.click(within(dialogue).getByRole("button", { name: "Confirmer le refus" }));

    expect(await within(dialogue).findByRole("alert")).toHaveTextContent(
      "Le motif est trop long.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("401 sur la décision : onSessionExpiree appelé", async () => {
    installerApi((url, init) => {
      if (url === "/api/v1/validation/notes/1") return jsonResponse(note({ id: 1 }));
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      if (url === "/api/v1/notes/1/valider" && init?.method === "POST") {
        return jsonResponse({ detail: "Session expirée." }, 401);
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    const { onSessionExpiree } = renderPage();

    await utilisateur.click(await screen.findByRole("button", { name: "Valider" }));
    await utilisateur.click(screen.getByRole("button", { name: "Confirmer" }));

    await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
  });
});

describe("erreurs de chargement", () => {
  test("chargement : aria-busy=true et « Chargement… » annoncé, puis retirés", async () => {
    let resolveNote!: (reponse: Response) => void;
    installerApi((url) => {
      if (url === "/api/v1/validation/notes/1") {
        return new Promise<Response>((resoudre) => {
          resolveNote = resoudre;
        });
      }
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    renderPage();

    expect(screen.getByText("Chargement…")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");

    resolveNote(jsonResponse(note({ id: 1 })));
    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    expect(screen.getByRole("main")).not.toHaveAttribute("aria-busy");
  });

  test("404 : « Dossier introuvable » et lien « Retour à la validation »", async () => {
    installerApi(() => jsonResponse({ detail: "Note introuvable." }, 404));

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Dossier introuvable" }),
    ).toBeInTheDocument();
    const lien = screen.getByRole("link", { name: "Retour à la validation" });
    expect(lien).toHaveAttribute("href", "/validation");
  });

  test("erreur réseau : « Réessayer » relance l'appel", async () => {
    let appels = 0;
    installerApi((url) => {
      if (url === "/api/v1/validation/notes/1") {
        appels += 1;
        if (appels === 1) throw new Error("réseau");
        return jsonResponse(note({ id: 1 }));
      }
      if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Semaine 47" }),
    ).toBeInTheDocument();
    expect(appels).toBe(2);
  });

  test("erreur d'historique indépendante : « Réessayer » ne recharge que l'historique", async () => {
    let appelsNote = 0;
    let appelsHistorique = 0;
    installerApi((url) => {
      if (url === "/api/v1/validation/notes/1") {
        appelsNote += 1;
        return jsonResponse(note({ id: 1 }));
      }
      if (url === "/api/v1/notes/1/historique") {
        appelsHistorique += 1;
        if (appelsHistorique === 1) throw new Error("réseau");
        return jsonResponse([transition({ id: 1 })]);
      }
      return jsonResponse({ detail: "Introuvable" }, 404);
    });

    const utilisateur = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    const section = screen.getByRole("region", { name: "Historique" });
    await utilisateur.click(within(section).getByRole("button", { name: "Réessayer" }));

    expect(await within(section).findByText("Brouillon → Soumise")).toBeInTheDocument();
    expect(appelsNote).toBe(1);
    expect(appelsHistorique).toBe(2);
  });

  test("401 au chargement : la session est considérée expirée", async () => {
    installerApi(() => jsonResponse({ detail: "Session expirée." }, 401));

    const { onSessionExpiree } = renderPage();

    await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
  });
});

describe("actions CSV et impression sur le détail de validation (US-030)", () => {
  function installerApiStatut(statut: StatutNote) {
    return installerApi(
      apiAvecJustificatifsParDefaut((url) => {
        if (url === "/api/v1/validation/notes/1") {
          return jsonResponse(note({ id: 1, statut }));
        }
        if (url === "/api/v1/notes/1/historique") {
          return jsonResponse([
            transition({ id: 1, ancien_statut: "brouillon", nouveau_statut: statut }),
          ]);
        }
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );
  }

  test.each(["validee", "remboursee"] as const)(
    "statut %s : « Télécharger le CSV » et « Imprimer » sont disponibles",
    async (statut) => {
      installerApiStatut(statut);

      renderPage("/validation/1", "valideur");

      await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
      expect(screen.getByRole("button", { name: "Télécharger le CSV" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Imprimer" })).toBeInTheDocument();
    },
  );

  test.each(["soumise", "refusee"] as const)(
    "statut %s : aucune des deux actions n'est affichée",
    async (statut) => {
      installerApiStatut(statut);

      renderPage("/validation/1", "valideur");

      await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
      expect(
        screen.queryByRole("button", { name: "Télécharger le CSV" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Imprimer" })).not.toBeInTheDocument();
    },
  );

  test("« Télécharger le CSV » appelle le même helper (même URL, même nom de fichier) que le détail du dossier", async () => {
    const fetchMock = installerApi(
      apiAvecJustificatifsParDefaut((url) => {
        if (url === "/api/v1/validation/notes/1") {
          return jsonResponse(note({ id: 1, statut: "validee" }));
        }
        if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
        if (url === "/api/v1/notes/1/export.csv") {
          return new Response("date;libellé\n", {
            status: 200,
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="note-1.csv"',
            },
          });
        }
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    const utilisateur = userEvent.setup();
    renderPage("/validation/1", "valideur");

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Télécharger le CSV" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const appelExport = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1/export.csv" && (init?.method ?? "GET") === "GET",
    );
    expect(appelExport).toHaveLength(1);
    expect(appelExport[0][1]?.credentials).toBe("same-origin");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:apercu-ticket");
    // Aucune navigation : la page reste sur le détail de validation.
    expect(screen.getByRole("heading", { level: 1, name: "Semaine 47" })).toBeInTheDocument();
  });

  test("échec 404 de l'export : alerte role=alert avec le message de l'API", async () => {
    installerApi(
      apiAvecJustificatifsParDefaut((url) => {
        if (url === "/api/v1/validation/notes/1") {
          return jsonResponse(note({ id: 1, statut: "remboursee" }));
        }
        if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
        if (url === "/api/v1/notes/1/export.csv") {
          return jsonResponse({ detail: "Note introuvable." }, 404);
        }
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    const utilisateur = userEvent.setup();
    renderPage("/validation/1", "valideur");

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    await utilisateur.click(screen.getByRole("button", { name: "Télécharger le CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Note introuvable.");
    expect(screen.getByRole("heading", { level: 1, name: "Semaine 47" })).toBeInTheDocument();
  });

  test("« Imprimer » appelle window.print() une fois, sans aucune requête réseau", async () => {
    const fetchMock = installerApiStatut("validee");
    const printMock = vi.fn();
    vi.stubGlobal("print", printMock);

    const utilisateur = userEvent.setup();
    renderPage("/validation/1", "valideur");

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    const nbAppelsAvant = fetchMock.mock.calls.length;
    await utilisateur.click(screen.getByRole("button", { name: "Imprimer" }));

    expect(printMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.length).toBe(nbAppelsAvant);
  });

  test("impression : barre de navigation, actions, lien de retour et vignettes masqués ; en-tête, dépenses et historique conservent leurs contenus", async () => {
    installerApiStatut("validee");

    renderPageAvecMiseEnPage("admin");

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });

    // Barre de navigation masquée (classe posée par MiseEnPage, US-029).
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(nav.className).toContain("print:hidden");

    // Actions CSV/impression masquées (composant ActionsDossierFinalise, US-029).
    const boutonCsv = screen.getByRole("button", { name: "Télécharger le CSV" });
    const boutonImprimer = screen.getByRole("button", { name: "Imprimer" });
    expect(boutonCsv.closest("div")!.className).toContain("print:hidden");
    expect(boutonImprimer.closest("div")!.className).toContain("print:hidden");

    // Bouton de remboursement et barre d'actions « Valider/Refuser » masqués.
    const boutonRembourser = screen.getByRole("button", { name: "Marquer comme remboursé" });
    expect(boutonRembourser.closest("div")!.className).toContain("print:hidden");

    // Lien de retour masqué, mais la pastille de statut reste imprimable.
    const lienRetour = screen.getByRole("link", { name: "Retour à la validation" });
    expect(lienRetour.className).toContain("print:hidden");
    expect(screen.getByText("Validée").className).toContain("print:text-black");

    // Vignettes de justificatifs masquées (wrapper print:hidden autour de la vignette) :
    // attendre que le chargement des photos soit terminé avant de contrôler le wrapper.
    await screen.findAllByText("Aucune photo");
    const vignette = screen.getAllByText("Aucune photo")[0];
    let parentVignette: HTMLElement | null = vignette.parentElement;
    while (parentVignette !== null && !parentVignette.className.includes("print:hidden")) {
      parentVignette = parentVignette.parentElement;
    }
    expect(parentVignette).not.toBeNull();

    // En-tête, dépenses et historique conservent leurs contenus lisibles.
    expect(screen.getByText("Camille")).toBeInTheDocument();
    // Le total apparaît dans l'en-tête du dossier et dans l'encadré de remboursement (US-035).
    expect(screen.getAllByText("180,00 €").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Train")).toBeInTheDocument();
    expect(screen.getByText("Déjeuner")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Historique" })).toBeInTheDocument();
    expect(screen.getByText("Brouillon → Validée")).toBeInTheDocument();
  });
});

describe("remboursement (US-030)", () => {
  function installerApiRemboursement(
    reponseRembourser: (url: string, init?: RequestInit) => Response | Promise<Response>,
    statutInitial: StatutNote = "validee",
  ) {
    return installerApi(
      apiAvecJustificatifsParDefaut((url, init) => {
        if (url === "/api/v1/validation/notes/1") {
          return jsonResponse(note({ id: 1, statut: statutInitial }));
        }
        if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
        if (url === "/api/v1/notes/1/rembourser" && init?.method === "POST") {
          return reponseRembourser(url, init);
        }
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );
  }

  test("admin + statut validée : le bouton « Marquer comme remboursé » est visible", async () => {
    installerApiRemboursement(() => new Response(null, { status: 204 }));

    renderPage("/validation/1", "admin");

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    expect(
      screen.getByRole("button", { name: "Marquer comme remboursé" }),
    ).toBeInTheDocument();
  });

  test("valideur non admin + statut validée : le bouton est absent", async () => {
    installerApiRemboursement(() => new Response(null, { status: 204 }));

    renderPage("/validation/1", "valideur");

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    expect(
      screen.queryByRole("button", { name: "Marquer comme remboursé" }),
    ).not.toBeInTheDocument();
  });

  test.each(["soumise", "refusee", "remboursee"] as const)(
    "admin + statut %s : le bouton est absent",
    async (statut) => {
      installerApiRemboursement(() => new Response(null, { status: 204 }), statut);

      renderPage("/validation/1", "admin");

      await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
      expect(
        screen.queryByRole("button", { name: "Marquer comme remboursé" }),
      ).not.toBeInTheDocument();
    },
  );

  test("confirmation « Marquer ce dossier comme remboursé ? » avec Annuler / Confirmer ; confirmer envoie un seul POST (double clic = un appel)", async () => {
    let resolvePost!: (reponse: Response) => void;
    const fetchMock = installerApiRemboursement(
      () =>
        new Promise<Response>((resoudre) => {
          resolvePost = resoudre;
        }),
    );

    const utilisateur = userEvent.setup();
    renderPage("/validation/1", "admin");

    await utilisateur.click(
      await screen.findByRole("button", { name: "Marquer comme remboursé" }),
    );
    const dialogue = screen.getByRole("dialog");
    expect(
      within(dialogue).getByRole("heading", { name: "Marquer ce dossier comme remboursé ?" }),
    ).toBeInTheDocument();
    expect(within(dialogue).getByRole("button", { name: "Annuler" })).toBeInTheDocument();

    const confirmer = within(dialogue).getByRole("button", { name: "Confirmer" });
    await utilisateur.click(confirmer);

    // Pendant l'appel : bouton désactivé + aria-busy ; un second clic ne produit qu'un appel.
    const boutonEnCours = screen.getByRole("button", { name: "En cours…" });
    expect(boutonEnCours).toBeDisabled();
    expect(boutonEnCours).toHaveAttribute("aria-busy", "true");
    fireEvent.click(boutonEnCours);

    resolvePost(new Response(null, { status: 204 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const appelsPost = fetchMock.mock.calls.filter(
      ([entree, init]) =>
        String(entree) === "/api/v1/notes/1/rembourser" && init?.method === "POST",
    );
    expect(appelsPost).toHaveLength(1);
  });

  test("succès : statut « Remboursée », annonce « Dossier remboursé. » en zone aria-live, bouton disparu, actions CSV/impression toujours là", async () => {
    let appelsNote = 0;
    installerApi(
      apiAvecJustificatifsParDefaut((url, init) => {
        if (url === "/api/v1/validation/notes/1") {
          appelsNote += 1;
          const statut: StatutNote = appelsNote === 1 ? "validee" : "remboursee";
          return jsonResponse(note({ id: 1, statut }));
        }
        if (url === "/api/v1/notes/1/historique") {
          return jsonResponse([
            transition({ id: 1, ancien_statut: "brouillon", nouveau_statut: "soumise" }),
            transition({
              id: 2,
              acteur: { id: 3, display_name: "Admin" },
              ancien_statut: "validee",
              nouveau_statut: "remboursee",
            }),
          ]);
        }
        if (url === "/api/v1/notes/1/rembourser" && init?.method === "POST") {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    const utilisateur = userEvent.setup();
    renderPage("/validation/1", "admin");

    await utilisateur.click(
      await screen.findByRole("button", { name: "Marquer comme remboursé" }),
    );
    await utilisateur.click(screen.getByRole("button", { name: "Confirmer" }));

    // Annonce en zone aria-live.
    const annonce = await screen.findByText("Dossier remboursé.");
    expect(annonce).toHaveAttribute("role", "status");
    expect(annonce).toHaveAttribute("aria-live", "polite");

    // Le statut rechargé est reflété, le bouton de remboursement a disparu,
    // et les actions CSV/impression restent disponibles.
    await screen.findByText("Remboursée");
    expect(
      screen.queryByRole("button", { name: "Marquer comme remboursé" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Télécharger le CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeInTheDocument();
    // L'historique rechargé montre la transition.
    expect(screen.getByText("Validée → Remboursée")).toBeInTheDocument();
    expect(appelsNote).toBeGreaterThanOrEqual(2);
  });

  test("409 : message de l'API dans une alerte role=alert, puis détail et historique rechargés", async () => {
    let appelsNote = 0;
    let appelsHistorique = 0;
    installerApi(
      apiAvecJustificatifsParDefaut((url, init) => {
        if (url === "/api/v1/validation/notes/1") {
          appelsNote += 1;
          const statut: StatutNote = appelsNote === 1 ? "validee" : "remboursee";
          return jsonResponse(note({ id: 1, statut }));
        }
        if (url === "/api/v1/notes/1/historique") {
          appelsHistorique += 1;
          return jsonResponse([
            transition({ id: 1 }),
            transition({
              id: 2,
              ancien_statut: "validee",
              nouveau_statut: "remboursee",
              motif: "Déjà remboursé ailleurs",
            }),
          ]);
        }
        if (url === "/api/v1/notes/1/rembourser" && init?.method === "POST") {
          return jsonResponse({ detail: "Le dossier a déjà été remboursé." }, 409);
        }
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    const utilisateur = userEvent.setup();
    renderPage("/validation/1", "admin");

    await utilisateur.click(
      await screen.findByRole("button", { name: "Marquer comme remboursé" }),
    );
    await utilisateur.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le dossier a déjà été remboursé.",
    );
    // Resynchronisation : le statut rechargé s'affiche et le motif du conflit est visible.
    await screen.findByText("Remboursée");
    expect(screen.getByText("Déjà remboursé ailleurs")).toBeInTheDocument();
    expect(appelsNote).toBeGreaterThanOrEqual(2);
    expect(appelsHistorique).toBeGreaterThanOrEqual(2);
  });

  test("403 (rôle insuffisant) : message de l'API affiché tel quel, sans navigation", async () => {
    installerApiRemboursement(() =>
      jsonResponse({ detail: "Seul un administrateur peut rembourser un dossier." }, 403),
    );

    const utilisateur = userEvent.setup();
    renderPage("/validation/1", "admin");

    await utilisateur.click(
      await screen.findByRole("button", { name: "Marquer comme remboursé" }),
    );
    await utilisateur.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Seul un administrateur peut rembourser un dossier.",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Semaine 47" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/LISTE VALIDATION/)).not.toBeInTheDocument();
  });

  test("401 : onSessionExpiree appelé", async () => {
    installerApiRemboursement(() => jsonResponse({ detail: "Session expirée." }, 401));

    const utilisateur = userEvent.setup();
    const { onSessionExpiree } = renderPage("/validation/1", "admin");

    await utilisateur.click(
      await screen.findByRole("button", { name: "Marquer comme remboursé" }),
    );
    await utilisateur.click(screen.getByRole("button", { name: "Confirmer" }));

    await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
  });

  test("admin + statut validée : l'encadré « Virement effectué ? » affiche le montant et le bouton", async () => {
    installerApiRemboursement(() => new Response(null, { status: 204 }));

    renderPage("/validation/1", "admin");

    await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
    const titre = screen.getByText("Virement effectué ?");
    expect(titre.className).toContain("font-bold");
    const carte = titre.closest("[data-slot='card']") as HTMLElement;
    expect(within(carte).getByText("180,00 €")).toBeInTheDocument();
    const bouton = within(carte).getByRole("button", { name: "Marquer comme remboursé" });
    expect(bouton.className).toContain("bg-[var(--primary)]");
    expect(bouton.className).toContain("text-[var(--primary-foreground)]");
    // Cible ≥ 44 px et focus visible.
    expect(bouton.className).toContain("h-[56px]");
    expect(bouton.className).toContain("focus-visible:outline-2");
  });

  test.each(["valideur", "utilisateur"] as const)(
    "%s + statut validée : ni l'encadré « Virement effectué ? » ni le bouton ne sont affichés",
    async (role) => {
      installerApiRemboursement(() => new Response(null, { status: 204 }));

      renderPage("/validation/1", role);

      await screen.findByRole("heading", { level: 1, name: "Semaine 47" });
      expect(screen.queryByText("Virement effectué ?")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Marquer comme remboursé" }),
      ).not.toBeInTheDocument();
    },
  );

  test("succès : l'encadré « Virement effectué ? » disparaît avec le bouton", async () => {
    let appelsNote = 0;
    installerApi(
      apiAvecJustificatifsParDefaut((url, init) => {
        if (url === "/api/v1/validation/notes/1") {
          appelsNote += 1;
          const statut: StatutNote = appelsNote === 1 ? "validee" : "remboursee";
          return jsonResponse(note({ id: 1, statut }));
        }
        if (url === "/api/v1/notes/1/historique") return jsonResponse([]);
        if (url === "/api/v1/notes/1/rembourser" && init?.method === "POST") {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({ detail: "Introuvable" }, 404);
      }),
    );

    const utilisateur = userEvent.setup();
    renderPage("/validation/1", "admin");

    await utilisateur.click(
      await screen.findByRole("button", { name: "Marquer comme remboursé" }),
    );
    await utilisateur.click(screen.getByRole("button", { name: "Confirmer" }));

    await screen.findByText("Dossier remboursé.");
    await screen.findByText("Remboursée");
    expect(screen.queryByText("Virement effectué ?")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Marquer comme remboursé" }),
    ).not.toBeInTheDocument();
  });
});
