/*
  Répartition des montants d'un dossier par catégorie, calculée côté client.

  Les pourcentages sont arrondis à l'entier par la méthode du plus fort reste,
  de sorte que leur somme fasse exactement 100 % (jamais 99 ni 101). Pure logique,
  sans dépendance à React ni à l'API.
*/

import type { Categorie } from "../api/client";

/** Ordre canonique des catégories, utilisé comme départage déterministe. */
const ORDRE_CATEGORIES: Categorie[] = [
  "transport",
  "repas",
  "hebergement",
  "carburant",
  "peage_parking",
  "fournitures",
  "autre",
];

function rang(categorie: Categorie): number {
  const indice = ORDRE_CATEGORIES.indexOf(categorie);
  return indice === -1 ? ORDRE_CATEGORIES.length : indice;
}

export interface SegmentRepartition {
  categorie: Categorie;
  montantCentimes: number;
  /** Pourcentage entier, 1..100. La somme des segments vaut toujours 100. */
  pourcentage: number;
}

/**
 * Regroupe des montants par catégorie et répartit 100 % entre les catégories
 * présentes (montant > 0) par la méthode du plus fort reste. Les catégories
 * absentes (aucune dépense) n'apparaissent jamais ; le résultat est trié par
 * montant décroissant, puis par ordre canonique.
 */
export function calculerRepartition(
  depenses: { categorie: Categorie; montant_centimes: number }[],
): SegmentRepartition[] {
  const total = depenses.reduce((somme, d) => somme + d.montant_centimes, 0);
  if (total <= 0) {
    return [];
  }

  const montants = new Map<Categorie, number>();
  for (const depense of depenses) {
    montants.set(depense.categorie, (montants.get(depense.categorie) ?? 0) + depense.montant_centimes);
  }

  const parts = [...montants.entries()]
    .filter(([, montant]) => montant > 0)
    .map(([categorie, montant]) => {
      const exact = (montant * 100) / total;
      return {
        categorie,
        montant,
        entier: Math.floor(exact),
        reste: exact - Math.floor(exact),
      };
    });

  const sommeEntiers = parts.reduce((somme, part) => somme + part.entier, 0);
  const aRepartir = 100 - sommeEntiers;

  // +1 % aux plus forts restes ; en cas d'égalité, départage par montant puis
  // par ordre canonique pour rester déterministe.
  const ordreReste = [...parts].sort(
    (a, b) => b.reste - a.reste || b.montant - a.montant || rang(a.categorie) - rang(b.categorie),
  );
  for (let i = 0; i < aRepartir; i += 1) {
    ordreReste[i].entier += 1;
  }

  return parts
    .map(({ categorie, montant, entier }) => ({
      categorie,
      montantCentimes: montant,
      pourcentage: entier,
    }))
    .sort((a, b) => b.montantCentimes - a.montantCentimes || rang(a.categorie) - rang(b.categorie));
}
