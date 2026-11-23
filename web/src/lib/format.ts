/*
  Helpers de formatage purs : montants en centimes, dates et semaines ISO.
  Aucune dépendance à React ni à l'API.
*/

const FORMAT_MONTANT = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

const MS_PAR_JOUR = 86_400_000;

export function formatMontant(centimes: number): string {
  return FORMAT_MONTANT.format(centimes / 100);
}

/** « 18 nov. » — date courte française, sans décalage de fuseau. */
export function formatDateCourte(dateIso: string): string {
  const [annee, mois, jour] = dateIso.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(annee, mois - 1, jour)));
}

/** Numéro de semaine ISO 8601 (lundi = 1 … dimanche = 7). */
export function numeroSemaineIso(dateIso: string): number {
  const [annee, mois, jour] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  const jourDeSemaine = date.getUTCDay() || 7;
  // Se place sur le jeudi de la semaine, dont l'année détermine la semaine ISO.
  date.setUTCDate(date.getUTCDate() + 4 - jourDeSemaine);
  const debutAnnee = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - debutAnnee.getTime()) / MS_PAR_JOUR + 1) / 7);
}

/** Mois calendaire courant, dans le fuseau `Europe/Paris`. */
export function moisCourant(maintenant: Date): { annee: number; mois: number } {
  const parties = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "numeric",
  }).formatToParts(maintenant);
  const annee = Number(parties.find((partie) => partie.type === "year")?.value ?? 0);
  const mois = Number(parties.find((partie) => partie.type === "month")?.value ?? 0);
  return { annee, mois };
}

export function nomMois(mois: number): string {
  return MOIS[mois - 1] ?? "";
}

/** « Dimanche 22 novembre » — initiale en majuscule, fuseau `Europe/Paris`. */
export function dateDuJour(maintenant: Date): string {
  const texte = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(maintenant);
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** Somme des `montant_centimes` dont la date appartient au mois courant. */
export function totalDepensesMois(
  depenses: { date_depense: string; montant_centimes: number }[],
  maintenant: Date,
): number {
  const { annee, mois } = moisCourant(maintenant);
  const prefixe = `${annee}-${String(mois).padStart(2, "0")}`;
  return depenses
    .filter((depense) => depense.date_depense.startsWith(prefixe))
    .reduce((total, depense) => total + depense.montant_centimes, 0);
}

/** Initiales (jusqu'à 2 lettres) du nom affiché, pour l'avatar. */
export function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  return mots.slice(0, 2).map((mot) => mot.charAt(0).toUpperCase()).join("") || "?";
}
