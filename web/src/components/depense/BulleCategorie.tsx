import { Receipt } from "lucide-react";

import type { Categorie } from "../../api/client";
import { CATEGORIES, cleCategorie } from "../../lib/categories";

/**
 * Bulle d'icône de catégorie en 32 px (tableau bureau, US-044), aux couleurs
 * d'`AGENTS.md` via les variables `--categorie-<clé>-fond/texte` : mêmes
 * icônes lucide et mêmes couleurs que la carte (`CarteDepense`, 44 px).
 */
export function BulleCategorie({ categorie }: { categorie: Categorie }) {
  const option = CATEGORIES.find((o) => o.valeur === categorie);
  const Icone = option?.icone ?? Receipt;
  const cle = cleCategorie(categorie);
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[16px]"
      style={{
        backgroundColor: `var(--categorie-${cle}-fond)`,
        color: `var(--categorie-${cle}-texte)`,
      }}
    >
      <Icone strokeWidth={2} className="h-4 w-4" />
    </span>
  );
}
