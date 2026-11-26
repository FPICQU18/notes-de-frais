import { Link } from "react-router";

import type { Note } from "../../api/client";
import { formatMontant, formatNbDepenses, formatPeriode } from "../../lib/format";
import { LIBELLES_STATUT } from "./statuts";

type Props = {
  note: Note;
};

/** Carte d'un dossier dans la liste : libellé, période, compteur, total et statut. */
export function CarteDossier({ note }: Props) {
  const periode = formatPeriode(note.derniere_depense_le);
  const nbDepenses = formatNbDepenses(note.nb_depenses);

  return (
    <li className="m-0 list-none p-0">
      <Link
        to={`/dossiers/${note.id}`}
        className="flex min-h-[88px] flex-col gap-2 rounded-[24px] bg-[var(--card)] p-[16px_18px] text-inherit no-underline shadow-[var(--ombre-carte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] active:opacity-90"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="m-0 line-clamp-2 min-w-0 break-words text-[16px] font-bold leading-tight">
            {note.libelle}
          </p>
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
        <div className="flex items-baseline justify-between gap-3">
          <p className="m-0 text-[13px] font-semibold text-[var(--muted-foreground)]">
            {periode} · {nbDepenses}
          </p>
          <p className="m-0 text-right text-[17px] font-extrabold tabular-nums">
            {formatMontant(note.total_centimes)}
          </p>
        </div>
      </Link>
    </li>
  );
}
