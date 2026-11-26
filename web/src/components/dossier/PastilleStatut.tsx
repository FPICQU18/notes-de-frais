import type { StatutNote } from "../../api/client";
import { LIBELLES_STATUT } from "./statuts";

/**
 * Pastille de statut d'un dossier, identique à celle de `CarteDossier`
 * (couleurs `--statut-<statut>-fond/texte` d'`AGENTS.md`) — réutilisée telle
 * quelle dans la colonne « Statut » du tableau bureau (US-044).
 */
export function PastilleStatut({ statut }: { statut: StatutNote }) {
  return (
    <span
      className="inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-bold"
      style={{
        backgroundColor: `var(--statut-${statut}-fond)`,
        color: `var(--statut-${statut}-texte)`,
      }}
    >
      {LIBELLES_STATUT[statut]}
    </span>
  );
}
