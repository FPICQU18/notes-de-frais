/*
 * Helpers de routage purs : quelles routes sont des écrans de formulaire
 * de dépense (saisie / modification), où la barre de navigation flottante
 * doit être masquée pour ne pas chevaucher le bouton « Enregistrer ».
 */

/** Chemins exacts d'écrans de formulaire de dépense. */
const CHEMINS_FORMULAIRE_DEPENSE = ["/depenses/nouvelle"];

/**
 * Vrai pour les écrans de saisie (`/depenses/nouvelle`) et de modification
 * (`/depenses/:id`) d'une dépense.
 */
export function estRouteFormulaireDepense(chemin: string): boolean {
  return (
    CHEMINS_FORMULAIRE_DEPENSE.includes(chemin) || /^\/depenses\/\d+$/.test(chemin)
  );
}
