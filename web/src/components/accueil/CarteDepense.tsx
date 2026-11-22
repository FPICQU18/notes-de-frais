import {
  Bed,
  Fuel,
  Receipt,
  ShoppingBag,
  SquareParking,
  Train,
  Utensils,
  type LucideIcon,
} from "lucide-react";

import type { Categorie, Depense } from "../../api/client";
import { formatDateCourte, formatMontant, numeroSemaineIso } from "../../lib/format";

const ICONES: Record<Categorie, LucideIcon> = {
  transport: Train,
  repas: Utensils,
  hebergement: Bed,
  carburant: Fuel,
  peage_parking: SquareParking,
  fournitures: ShoppingBag,
  autre: Receipt,
};

const CLASSE_ICONE: Record<Categorie, string> = {
  transport: "categorie-transport",
  repas: "categorie-repas",
  hebergement: "categorie-hebergement",
  carburant: "categorie-carburant",
  peage_parking: "categorie-peage-parking",
  fournitures: "categorie-fournitures",
  autre: "categorie-autre",
};

export function CarteDepense({ depense }: { depense: Depense }) {
  const Icone = ICONES[depense.categorie];
  const classe = CLASSE_ICONE[depense.categorie];
  const aClasser = depense.note_id === null;

  return (
    <li className="carte-depense">
      <span className={`carte-depense__icone ${classe}`} aria-hidden="true">
        <Icone strokeWidth={2} />
      </span>
      <div className="carte-depense__corps">
        <p className="carte-depense__libelle">{depense.libelle}</p>
        <p className="carte-depense__detail">
          {formatDateCourte(depense.date_depense)} ·{" "}
          {aClasser ? (
            <span className="carte-depense__a-classer">À classer</span>
          ) : (
            <span>Semaine {numeroSemaineIso(depense.date_depense)}</span>
          )}
        </p>
      </div>
      <p className="carte-depense__montant">{formatMontant(depense.montant_centimes)}</p>
    </li>
  );
}
