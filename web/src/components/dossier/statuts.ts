import type { StatutNote } from "../../api/client";

/** Libellés français des statuts de dossier, affichés dans les pastilles. */
export const LIBELLES_STATUT: Record<StatutNote, string> = {
  brouillon: "Brouillon",
  soumise: "Soumise",
  validee: "Validée",
  refusee: "Refusée",
  remboursee: "Remboursée",
};
