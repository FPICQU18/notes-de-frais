import { Link } from "react-router";

import { Badge } from "../ui/badge";
import type { NoteValidation, StatutValidation } from "../../api/client";
import {
  formatDateCourteHorodatage,
  formatMontant,
  initiales,
} from "../../lib/format";

const LIBELLES_STATUT: Record<StatutValidation, string> = {
  soumise: "Soumise",
  validee: "Validée",
  refusee: "Refusée",
  remboursee: "Remboursée",
};

type Props = {
  note: NoteValidation;
  /** Admin : affiche la pastille « À rembourser » sur les dossiers validés (US-035). */
  estAdmin?: boolean;
  /**
   * Mode maître-détail bureau (US-043) : la carte devient un bouton qui
   * sélectionne le dossier dans le panneau de droite, sans navigation.
   * `selectionnee` surligne la carte active (bordure primaire, maquette bureau).
   */
  selectionnable?: boolean;
  selectionnee?: boolean;
  onSelectionner?: (id: number) => void;
};

/** Carte d'un dossier de la file de validation : demandeur, titre, date, total et statut. */
export function CarteValidation({
  note,
  estAdmin = false,
  selectionnable = false,
  selectionnee = false,
  onSelectionner,
}: Props) {
  const dateEnvoi =
    note.soumise_at === null ? "—" : formatDateCourteHorodatage(note.soumise_at);

  const contenu = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[20px] bg-[var(--accent)] text-[13px] font-bold text-[var(--accent-foreground)]"
          >
            {initiales(note.proprietaire.display_name)}
          </span>
          <span className="truncate text-[13px] font-bold">
            {note.proprietaire.display_name}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {estAdmin && note.statut === "validee" && (
            <Badge className="min-h-11 px-3 text-[12px] font-semibold">
              À rembourser
            </Badge>
          )}
          <span
            className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-bold"
            style={{
              backgroundColor: `var(--statut-${note.statut}-fond)`,
              color: `var(--statut-${note.statut}-texte)`,
            }}
          >
            {LIBELLES_STATUT[note.statut]}
          </span>
        </div>
      </div>
      <p className="m-0 line-clamp-2 min-w-0 break-words text-[17px] font-extrabold leading-tight">
        {note.libelle}
      </p>
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 text-[13px] font-semibold text-[var(--muted-foreground)]">
          Envoyé le {dateEnvoi}
        </p>
        <p className="m-0 text-right text-[17px] font-extrabold tabular-nums">
          {formatMontant(note.total_centimes)}
        </p>
      </div>
    </>
  );

  const classesCarte =
    "flex min-h-[124px] w-full flex-col gap-2.5 rounded-[24px] bg-[var(--card)] p-[16px_18px] text-left text-inherit shadow-[var(--ombre-carte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]";

  if (selectionnable) {
    return (
      <li className="m-0 list-none p-0">
        <button
          type="button"
          onClick={() => onSelectionner?.(note.id)}
          aria-pressed={selectionnee}
          className={`${classesCarte} border-2 ${
            selectionnee ? "border-[var(--primary)]" : "border-transparent"
          } cursor-pointer active:opacity-90`}
        >
          {contenu}
        </button>
      </li>
    );
  }

  return (
    <li className="m-0 list-none p-0">
      <Link
        to={`/validation/${note.id}`}
        className={`${classesCarte} no-underline active:opacity-90`}
      >
        {contenu}
      </Link>
    </li>
  );
}
