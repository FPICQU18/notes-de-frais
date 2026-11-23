import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";

import type { Categorie } from "../../api/client";
import { FormulaireDepense } from "./FormulaireDepense";

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

const MAINTENANT = new Date("2026-11-15T12:00:00Z");

interface Options {
  maintenant?: Date;
  onSessionExpiree?: () => void;
  onSucces?: (annonce: string | null) => void;
}

function renderFormulaire(options: Options = {}) {
  const onSessionExpiree = options.onSessionExpiree ?? vi.fn();
  const onSucces = options.onSucces ?? vi.fn();
  const utils = render(
    <MemoryRouter>
      <FormulaireDepense
        mode="creation"
        maintenant={options.maintenant ?? MAINTENANT}
        onSessionExpiree={onSessionExpiree}
        onSucces={onSucces}
      />
    </MemoryRouter>,
  );
  return { onSessionExpiree, onSucces, ...utils };
}

async function remplirFormulaireValide(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.type(screen.getByLabelText("Montant"), "24,50");
  await utilisateur.click(screen.getByRole("button", { name: "Repas" }));
  await utilisateur.type(screen.getByLabelText("Libellé"), "Déjeuner");
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("en-tête : bouton retour (aria-label « Retour ») et titre « Nouvelle dépense »", () => {
  renderFormulaire();
  expect(screen.getByRole("button", { name: "Retour" })).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { level: 1, name: "Nouvelle dépense" }),
  ).toBeInTheDocument();
});

test("formulaire vierge : montant/libellé vides, date du jour à Paris, aucune catégorie", () => {
  renderFormulaire({ maintenant: new Date("2026-11-23T23:30:00Z") });

  // 23 h 30 UTC = 00 h 30 le 24 novembre à Paris (UTC+1) → pas la veille.
  expect(screen.getByLabelText("Date")).toHaveValue("2026-11-24");
  expect(screen.getByLabelText("Montant")).toHaveValue("");
  expect(screen.getByLabelText("Libellé")).toHaveValue("");

  const tuiles = screen.getAllByRole("button", { pressed: false });
  expect(tuiles).toHaveLength(7);
});

test("champ montant : label « Montant », inputmode decimal, centré, tabular-nums", () => {
  renderFormulaire();
  const champ = screen.getByLabelText("Montant");
  expect(champ).toHaveAttribute("inputmode", "decimal");
  expect(champ.className).toContain("text-center");
  expect(champ.className).toContain("tabular-nums");
});

test("bloc catégories : fieldset + legend, 7 tuiles dans l'ordre, aria-pressed", async () => {
  const utilisateur = userEvent.setup();
  renderFormulaire();

  const fieldset = screen.getByRole("group", { name: "Catégorie" });
  const tuiles = within(fieldset).getAllByRole("button");
  expect(tuiles.map((t) => t.textContent)).toEqual([
    "Transport",
    "Repas",
    "Hébergement",
    "Carburant",
    "Péage/Parking",
    "Fournitures",
    "Autre",
  ]);
  for (const tuile of tuiles) {
    expect(tuile).toHaveAttribute("aria-pressed", "false");
  }

  await utilisateur.click(within(fieldset).getByRole("button", { name: "Repas" }));
  expect(within(fieldset).getByRole("button", { name: "Repas" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(within(fieldset).getByRole("button", { name: "Transport" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("soumission valide : un seul POST, corps exact, montant « 24,50 » → 2450 centimes", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(jsonResponse({ id: 1 }, 201));
  const onSucces = vi.fn();
  const utilisateur = userEvent.setup();
  renderFormulaire({ onSucces });

  await remplirFormulaireValide(utilisateur);
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  await waitFor(() => expect(onSucces).toHaveBeenCalledWith("Dépense enregistrée."));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("/api/v1/depenses");
  expect(init?.method).toBe("POST");
  const corps = JSON.parse(String(init?.body));
  expect(corps).toEqual({
    libelle: "Déjeuner",
    date_depense: "2026-11-15",
    montant_centimes: 2450,
    categorie: "repas",
  });
  expect(corps).not.toHaveProperty("commentaire");
  expect(corps).not.toHaveProperty("note_id");
  expect(corps).not.toHaveProperty("user_id");
});

test("soumission valide : « 24.50 » est aussi converti en 2450 centimes", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(jsonResponse({ id: 1 }, 201));
  const utilisateur = userEvent.setup();
  renderFormulaire();

  await utilisateur.type(screen.getByLabelText("Montant"), "24.50");
  await utilisateur.click(screen.getByRole("button", { name: "Autre" }));
  await utilisateur.type(screen.getByLabelText("Libellé"), "Café");
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const corps = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  expect(corps.montant_centimes).toBe(2450);
});

test.each(["", "0", "abc"])(
  "montant « %s » → erreur et aucun appel réseau",
  async (saisie) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const utilisateur = userEvent.setup();
    renderFormulaire();

    if (saisie !== "") {
      await utilisateur.type(screen.getByLabelText("Montant"), saisie);
    }
    await utilisateur.click(screen.getByRole("button", { name: "Repas" }));
    await utilisateur.type(screen.getByLabelText("Libellé"), "Déjeuner");
    await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(
      await screen.findByText("Saisissez un montant supérieur à 0 €."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test("montant supérieur à 100 000 € → erreur, aucun appel, saisie conservée", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const utilisateur = userEvent.setup();
  renderFormulaire();

  await utilisateur.type(screen.getByLabelText("Montant"), "100000,01");
  await utilisateur.click(screen.getByRole("button", { name: "Repas" }));
  await utilisateur.type(screen.getByLabelText("Libellé"), "Déjeuner");
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(
    await screen.findByText("Le montant ne peut pas dépasser 100 000 €."),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Montant")).toHaveValue("100000,01");
});

test("montant « 12,345 » (3 décimales) → refusé, aucun appel", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const utilisateur = userEvent.setup();
  renderFormulaire();

  await utilisateur.type(screen.getByLabelText("Montant"), "12,345");
  await utilisateur.click(screen.getByRole("button", { name: "Repas" }));
  await utilisateur.type(screen.getByLabelText("Libellé"), "Déjeuner");
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(
    await screen.findByText("Saisissez un montant avec deux décimales au maximum."),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("date dans le futur → « La date ne peut pas être dans le futur. », aucun appel", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const utilisateur = userEvent.setup();
  renderFormulaire({ maintenant: new Date("2026-11-15T12:00:00Z") });

  await utilisateur.type(screen.getByLabelText("Montant"), "24,50");
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-16" } });
  await utilisateur.click(screen.getByRole("button", { name: "Repas" }));
  await utilisateur.type(screen.getByLabelText("Libellé"), "Déjeuner");
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(
    await screen.findByText("La date ne peut pas être dans le futur."),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("aucune catégorie → « Choisissez une catégorie. », aucun appel", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const utilisateur = userEvent.setup();
  renderFormulaire();

  await utilisateur.type(screen.getByLabelText("Montant"), "24,50");
  await utilisateur.type(screen.getByLabelText("Libellé"), "Déjeuner");
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(await screen.findByText("Choisissez une catégorie.")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("libellé vide → « Le libellé est requis. », aucun appel", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const utilisateur = userEvent.setup();
  renderFormulaire();

  await utilisateur.type(screen.getByLabelText("Montant"), "24,50");
  await utilisateur.click(screen.getByRole("button", { name: "Repas" }));
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(await screen.findByText("Le libellé est requis.")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("libellé > 200 caractères → « Le libellé est trop long… », aucun appel", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const utilisateur = userEvent.setup();
  renderFormulaire();

  await utilisateur.type(screen.getByLabelText("Montant"), "24,50");
  await utilisateur.click(screen.getByRole("button", { name: "Repas" }));
  await utilisateur.type(screen.getByLabelText("Libellé"), "a".repeat(201));
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(
    await screen.findByText("Le libellé est trop long (200 caractères maximum)."),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("double appui pendant l'envoi : un seul POST, bouton désactivé et aria-busy", async () => {
  let resolvePost!: (r: Response) => void;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    () => new Promise<Response>((resoudre) => {
      resolvePost = resoudre;
    }),
  );
  const utilisateur = userEvent.setup();
  const { onSucces } = renderFormulaire();

  await remplirFormulaireValide(utilisateur);
  const bouton = screen.getByRole("button", { name: "Enregistrer" });
  await utilisateur.click(bouton);

  const enCours = await screen.findByRole("button", { name: "Enregistrement…" });
  expect(enCours).toBeDisabled();
  expect(enCours).toHaveAttribute("aria-busy", "true");
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await utilisateur.click(enCours).catch(() => {});
  expect(fetchMock).toHaveBeenCalledTimes(1);

  resolvePost(jsonResponse({ id: 1 }, 201));
  await waitFor(() => expect(onSucces).toHaveBeenCalledWith("Dépense enregistrée."));
});

test("422 : messages détaillés par champ, valeurs conservées, bouton réactivé", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse(
      {
        detail: [
          { loc: ["body", "libelle"], msg: "Libellé serveur invalide." },
          { loc: ["body", "montant_centimes"], msg: "Montant serveur invalide." },
        ],
      },
      422,
    ),
  );
  const onSucces = vi.fn();
  const utilisateur = userEvent.setup();
  renderFormulaire({ onSucces });

  await remplirFormulaireValide(utilisateur);
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(await screen.findByText("Libellé serveur invalide.")).toBeInTheDocument();
  expect(screen.getByText("Montant serveur invalide.")).toBeInTheDocument();

  expect(screen.getByLabelText("Montant")).toHaveValue("24,50");
  expect(screen.getByLabelText("Libellé")).toHaveValue("Déjeuner");
  expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
  expect(onSucces).not.toHaveBeenCalled();
});

test("panne réseau : alerte « Serveur injoignable… » puis « Réessayer » rejoue le POST", async () => {
  let appels = 0;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    appels += 1;
    if (appels === 1) {
      throw new Error("réseau");
    }
    return jsonResponse({ id: 1 }, 201);
  });
  const onSucces = vi.fn();
  const utilisateur = userEvent.setup();
  renderFormulaire({ onSucces });

  await remplirFormulaireValide(utilisateur);
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  const alerte = await screen.findByRole("alert");
  expect(alerte).toHaveTextContent("Serveur injoignable. Vérifiez votre connexion.");
  expect(screen.getByLabelText("Montant")).toHaveValue("24,50");

  await utilisateur.click(screen.getByRole("button", { name: "Réessayer" }));
  await waitFor(() => expect(onSucces).toHaveBeenCalledWith("Dépense enregistrée."));

  expect(fetchMock).toHaveBeenCalledTimes(2);
  const corps1 = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  const corps2 = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
  expect(corps2).toEqual(corps1);
});

test("401 → onSessionExpiree appelé", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({ detail: "Session expirée." }, 401),
  );
  const onSessionExpiree = vi.fn();
  const utilisateur = userEvent.setup();
  renderFormulaire({ onSessionExpiree });

  await remplirFormulaireValide(utilisateur);
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
});

test("la valeur de catégorie choisie est envoyée telle quelle", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(jsonResponse({ id: 1 }, 201));
  const utilisateur = userEvent.setup();
  renderFormulaire();

  await utilisateur.type(screen.getByLabelText("Montant"), "8");
  await utilisateur.click(screen.getByRole("button", { name: "Péage/Parking" }));
  await utilisateur.type(screen.getByLabelText("Libellé"), "Parking");
  await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const corps = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
    categorie: Categorie;
    montant_centimes: number;
  };
  expect(corps.categorie).toBe("peage_parking");
  expect(corps.montant_centimes).toBe(800);
});
