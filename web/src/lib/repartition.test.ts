import { describe, expect, test } from "vitest";

import { cleCategorie, libelleCategorie } from "./categories";
import { calculerRepartition } from "./repartition";

describe("calculerRepartition", () => {
  test("aucune dépense → aucun segment", () => {
    expect(calculerRepartition([])).toEqual([]);
  });

  test("montants tous nuls → aucun segment (pas de segment à 0)", () => {
    expect(
      calculerRepartition([
        { categorie: "transport", montant_centimes: 0 },
        { categorie: "repas", montant_centimes: 0 },
      ]),
    ).toEqual([]);
  });

  test("une seule catégorie → 100 %", () => {
    expect(
      calculerRepartition([{ categorie: "transport", montant_centimes: 1500 }]),
    ).toEqual([{ categorie: "transport", montantCentimes: 1500, pourcentage: 100 }]);
  });

  test("regroupe les montants d'une même catégorie et calcule le pourcentage", () => {
    expect(
      calculerRepartition([
        { categorie: "transport", montant_centimes: 100 },
        { categorie: "transport", montant_centimes: 50 },
        { categorie: "repas", montant_centimes: 50 },
      ]),
    ).toEqual([
      { categorie: "transport", montantCentimes: 150, pourcentage: 75 },
      { categorie: "repas", montantCentimes: 50, pourcentage: 25 },
    ]);
  });

  test("répartition égale exacte : la somme vaut 100", () => {
    const segments = calculerRepartition([
      { categorie: "transport", montant_centimes: 100 },
      { categorie: "repas", montant_centimes: 100 },
    ]);
    expect(segments).toEqual([
      { categorie: "transport", montantCentimes: 100, pourcentage: 50 },
      { categorie: "repas", montantCentimes: 100, pourcentage: 50 },
    ]);
    expect(segments.reduce((somme, s) => somme + s.pourcentage, 0)).toBe(100);
  });

  test("plus fort reste : la somme vaut exactement 100 même avec 1/3", () => {
    const segments = calculerRepartition([
      { categorie: "transport", montant_centimes: 1 },
      { categorie: "repas", montant_centimes: 1 },
      { categorie: "hebergement", montant_centimes: 1 },
    ]);
    // 33,33 % chacun → 33/33/33 + 1 % attribué au plus fort reste (transport).
    expect(segments).toEqual([
      { categorie: "transport", montantCentimes: 1, pourcentage: 34 },
      { categorie: "repas", montantCentimes: 1, pourcentage: 33 },
      { categorie: "hebergement", montantCentimes: 1, pourcentage: 33 },
    ]);
    expect(segments.reduce((somme, s) => somme + s.pourcentage, 0)).toBe(100);
  });

  test("une catégorie absente n'apparaît jamais", () => {
    const segments = calculerRepartition([
      { categorie: "transport", montant_centimes: 100 },
      { categorie: "repas", montant_centimes: 0 },
    ]);
    expect(segments.map((s) => s.categorie)).toEqual(["transport"]);
  });
});

describe("cleCategorie / libelleCategorie", () => {
  test("peage_parking est la seule clé CSS avec un tiret", () => {
    expect(cleCategorie("peage_parking")).toBe("peage-parking");
    expect(cleCategorie("hebergement")).toBe("hebergement");
    expect(cleCategorie("fournitures")).toBe("fournitures");
  });

  test("libellé français", () => {
    expect(libelleCategorie("peage_parking")).toBe("Péage/Parking");
    expect(libelleCategorie("hebergement")).toBe("Hébergement");
  });
});
