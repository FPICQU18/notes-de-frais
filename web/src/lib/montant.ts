/*
  Conversion montant ↔ centimes, sans jamais passer par un float.
  Helper pur, sans dépendance à React ni à l'API.
*/

export type ErreurMontant = "vide" | "invalide" | "decimales" | "tropGrand";

export type LectureMontant =
  | { centimes: number; erreur: null }
  | { centimes: null; erreur: ErreurMontant };

const MONTANT_MAX_CENTIMES = 10_000_000;

/**
 * Convertit une saisie utilisateur (ex. « 24,50 ») en centimes entiers.
 *
 * Règles, dans l'ordre : trim → suppression des espaces de saisie (U+0020,
 * U+00A0, U+202F) → virgule remplacée par un point → vide ? « vide » → ne
 * correspond pas à `^\d+(\.\d+)?$` ? « invalide » → plus de deux décimales ?
 * « decimales » → centimes = partie entière × 100 + décimale complétée à
 * droite → 0 ? « invalide » → supérieur à 10 000 000 ? « tropGrand ».
 */
export function lireMontantCentimes(saisie: string): LectureMontant {
  const nettoye = saisie
    .trim()
    .replace(/[\u0020\u00A0\u202F]/g, "")
    .replace(",", ".");

  if (nettoye === "") {
    return { centimes: null, erreur: "vide" };
  }
  if (!/^\d+(\.\d+)?$/.test(nettoye)) {
    return { centimes: null, erreur: "invalide" };
  }

  const [partieEntiere, partieDecimale = ""] = nettoye.split(".");
  if (partieDecimale.length > 2) {
    return { centimes: null, erreur: "decimales" };
  }

  const centimes =
    Number(partieEntiere) * 100 + Number(partieDecimale.padEnd(2, "0"));
  if (centimes <= 0) {
    return { centimes: null, erreur: "invalide" };
  }
  if (centimes > MONTANT_MAX_CENTIMES) {
    return { centimes: null, erreur: "tropGrand" };
  }
  return { centimes, erreur: null };
}

/** `2450` → `"24,50"` — toujours deux décimales, virgule, sans devise. */
export function formaterMontantSaisie(centimes: number): string {
  const euros = Math.floor(centimes / 100);
  const centimesRestants = centimes % 100;
  return `${euros},${String(centimesRestants).padStart(2, "0")}`;
}
