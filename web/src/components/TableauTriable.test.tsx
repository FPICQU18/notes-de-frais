import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { TableauTriable, type ColonneTableau } from "./TableauTriable";

type Ligne = { id: number; nom: string; date: string; montant: number };

const LIGNES: Ligne[] = [
  { id: 1, nom: "Charlie", date: "2026-11-20", montant: 3000 },
  { id: 2, nom: "Alice", date: "2026-11-26", montant: 1000 },
  { id: 3, nom: "Bob", date: "2026-11-23", montant: 2000 },
];

function colonnes(): ColonneTableau<Ligne>[] {
  return [
    {
      cle: "date",
      libelle: "Date",
      triable: true,
      valeurTri: (l) => l.date,
      cellule: (l) => <span>{l.date}</span>,
    },
    {
      cle: "nom",
      libelle: "Nom",
      cellule: (l) => <span>{l.nom}</span>,
    },
    {
      cle: "montant",
      libelle: "Montant",
      triable: true,
      valeurTri: (l) => l.montant,
      cellule: (l) => <span>{l.montant} €</span>,
    },
  ];
}

function renderTableau(lignes: Ligne[] = LIGNES) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <TableauTriable
              titre="Tous les éléments"
              colonnes={colonnes()}
              lignes={lignes}
              cleLigne={(l) => l.id}
              vers={(l) => `/elements/${l.id}`}
              etiquetteLigne={(l) => `Ouvrir ${l.nom}`}
            />
          }
        />
        <Route path="/elements/:id" element={<div>DÉTAIL ÉLÉMENT</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Noms affichés dans l'ordre des lignes du tableau (colonne « Nom »). */
function nomsDesLignes(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1) // sans l'en-tête
    .map((ligne) => within(ligne).getByText(/^(Alice|Bob|Charlie)$/).textContent ?? "");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TableauTriable (US-044)", () => {
  test("affiche le titre, le compteur de résultats et les 5 colonnes d'en-tête", () => {
    renderTableau();

    expect(screen.getByRole("heading", { level: 2, name: "Tous les éléments" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("3 résultats");
    for (const libelle of ["Date", "Nom", "Montant"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(libelle) })).toBeInTheDocument();
    }
    expect(screen.getByRole("table", { name: "Tous les éléments" })).toBeInTheDocument();
  });

  test("par défaut, conserve l'ordre des lignes tel que fourni (ordre serveur)", () => {
    renderTableau();

    expect(nomsDesLignes()).toEqual(["Charlie", "Alice", "Bob"]);
    // Aucune colonne triée : pas d'aria-sort.
    for (const entete of screen.getAllByRole("columnheader")) {
      expect(entete).not.toHaveAttribute("aria-sort");
    }
  });

  test("clic sur « Date » : tri ascendant (aria-sort=ascending), second clic : descendant", async () => {
    const utilisateur = userEvent.setup();
    renderTableau();

    const enteteDate = screen.getByRole("columnheader", { name: /Date/ });
    const boutonDate = within(enteteDate).getByRole("button", { name: /Date/ });

    await utilisateur.click(boutonDate);
    expect(enteteDate).toHaveAttribute("aria-sort", "ascending");
    expect(nomsDesLignes()).toEqual(["Charlie", "Bob", "Alice"]); // 20, 23, 26 nov.

    await utilisateur.click(boutonDate);
    expect(enteteDate).toHaveAttribute("aria-sort", "descending");
    expect(nomsDesLignes()).toEqual(["Alice", "Bob", "Charlie"]);
  });

  test("clic sur « Montant » : tri numérique ascendant puis descendant, aria-sort sur cette colonne seule", async () => {
    const utilisateur = userEvent.setup();
    renderTableau();

    const enteteMontant = screen.getByRole("columnheader", { name: /Montant/ });
    const boutonMontant = within(enteteMontant).getByRole("button", { name: /Montant/ });
    const enteteDate = screen.getByRole("columnheader", { name: /Date/ });

    await utilisateur.click(boutonMontant);
    expect(enteteMontant).toHaveAttribute("aria-sort", "ascending");
    expect(enteteDate).not.toHaveAttribute("aria-sort");
    expect(nomsDesLignes()).toEqual(["Alice", "Bob", "Charlie"]); // 1000, 2000, 3000

    await utilisateur.click(boutonMontant);
    expect(enteteMontant).toHaveAttribute("aria-sort", "descending");
    expect(nomsDesLignes()).toEqual(["Charlie", "Bob", "Alice"]);
  });

  test("changer de colonne triable repart en ascendant sur la nouvelle colonne", async () => {
    const utilisateur = userEvent.setup();
    renderTableau();

    const boutonDate = within(screen.getByRole("columnheader", { name: /Date/ })).getByRole(
      "button",
      { name: /Date/ },
    );
    const boutonMontant = within(
      screen.getByRole("columnheader", { name: /Montant/ }),
    ).getByRole("button", { name: /Montant/ });

    await utilisateur.click(boutonDate);
    await utilisateur.click(boutonDate); // date en descendant
    await utilisateur.click(boutonMontant); // nouvelle colonne → ascendant

    expect(screen.getByRole("columnheader", { name: /Montant/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(nomsDesLignes()).toEqual(["Alice", "Bob", "Charlie"]);
  });

  test("tri stable : les valeurs égales gardent leur ordre relatif", async () => {
    const utilisateur = userEvent.setup();
    renderTableau([
      { id: 1, nom: "Alice", date: "2026-11-20", montant: 1000 },
      { id: 2, nom: "Bob", date: "2026-11-20", montant: 2000 },
      { id: 3, nom: "Charlie", date: "2026-11-20", montant: 3000 },
    ]);

    const boutonDate = within(screen.getByRole("columnheader", { name: /Date/ })).getByRole(
      "button",
      { name: /Date/ },
    );
    await utilisateur.click(boutonDate);

    expect(nomsDesLignes()).toEqual(["Alice", "Bob", "Charlie"]);
  });

  test("chaque ligne est un lien unique vers le détail, avec un libellé accessible", () => {
    renderTableau();

    const liens = screen.getAllByRole("link");
    expect(liens).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Ouvrir Alice" })).toHaveAttribute(
      "href",
      "/elements/2",
    );
    expect(screen.getByRole("link", { name: "Ouvrir Bob" })).toHaveAttribute("href", "/elements/3");
  });

  test("clic sur une ligne navigue vers le détail (lien étendu à toute la ligne)", async () => {
    const utilisateur = userEvent.setup();
    renderTableau();

    // Le lien « stretched » (after:inset-0 sur la ligne relative) couvre toute
    // la ligne en navigateur ; en test on active le lien accessible de la ligne.
    await utilisateur.click(screen.getByRole("link", { name: "Ouvrir Alice" }));

    expect(await screen.findByText("DÉTAIL ÉLÉMENT")).toBeInTheDocument();
  });

  test("en-tête non triable (colonne « Nom ») : pas de bouton, pas d'aria-sort au clic", async () => {
    const utilisateur = userEvent.setup();
    renderTableau();

    const enteteNom = screen.getByRole("columnheader", { name: /Nom/ });
    expect(within(enteteNom).queryByRole("button")).not.toBeInTheDocument();
    await utilisateur.click(enteteNom);
    expect(enteteNom).not.toHaveAttribute("aria-sort");
    expect(nomsDesLignes()).toEqual(["Charlie", "Alice", "Bob"]);
  });
});
