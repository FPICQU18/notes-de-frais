import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import type {
  Depense,
  StatutNote,
  TransitionRead,
  ValidationNoteDetail,
} from "../api/client";
import { ValidationDetailPage } from "./ValidationDetailPage";
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

function renderPage(url = "/validation/1") {
  const onSessionExpiree = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/validation/:id"
          element={<ValidationDetailPage onSessionExpiree={onSessionExpiree} />}
        />
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
