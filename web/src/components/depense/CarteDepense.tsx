import type { KeyboardEvent } from "react";
import { Link } from "react-router";
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

type Props = {
  depense: Depense;
  /** Si fourni, la carte devient un lien de navigation vers ce chemin. */
  vers?: string;
};

function ContenuCarte({ depense }: { depense: Depense }) {
  const Icone = ICONES[depense.categorie];
  const classe = CLASSE_ICONE[depense.categorie];
  const aClasser = depense.note_id === null;

  return (
    <>
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
    </>
  );
}

export function CarteDepense({ depense, vers }: Props) {
  if (vers === undefined) {
    return (
      <li className="carte-depense">
        <ContenuCarte depense={depense} />
      </li>
    );
  }

  function gererTouche(evenement: KeyboardEvent<HTMLAnchorElement>) {
    if (evenement.key === " ") {
      evenement.preventDefault();
      evenement.currentTarget.click();
    }
  }

  return (
    <li className="m-0 list-none p-0">
      <Link
        to={vers}
        onKeyDown={gererTouche}
        className="carte-depense no-underline text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        <ContenuCarte depense={depense} />
      </Link>
    </li>
  );
}
