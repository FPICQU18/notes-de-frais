export interface UserRead {
  id: number;
  email: string;
  display_name: string;
  role: string;
}

export type Categorie =
  | "transport"
  | "repas"
  | "hebergement"
  | "carburant"
  | "peage_parking"
  | "fournitures"
  | "autre";

export type StatutNote =
  | "brouillon"
  | "soumise"
  | "validee"
  | "refusee"
  | "remboursee";

export interface Depense {
  id: number;
  libelle: string;
  /** Date de dépense au format `AAAA-MM-JJ`. */
  date_depense: string;
  montant_centimes: number;
  categorie: Categorie;
  commentaire: string | null;
  /** `null` signifie « à classer » (non rattachée à un dossier). */
  note_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: number;
  libelle: string;
  statut: StatutNote;
  total_centimes: number;
  nb_depenses: number;
  created_at: string;
  updated_at: string;
}

export const MESSAGE_RESEAU = "Serveur injoignable. Vérifiez votre connexion.";
export const MESSAGE_GENERIQUE = "Une erreur est survenue.";

export class ApiError extends Error {
  readonly status: number;
  /** Corps `detail` brut de la réponse d'erreur (chaîne ou tableau 422). */
  readonly detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface ErreurValidation {
  /** Nom du champ concerné (dernier élément de `loc`), `null` si absent. */
  champ: string | null;
  message: string;
}

/**
 * Extrait les erreurs de validation d'un corps `detail` 422 de FastAPI :
 * `[{ loc: ["body", "montant_centimes"], msg: "…" }, …]`.
 */
export function erreursDeDetail(detail: unknown): ErreurValidation[] {
  if (!Array.isArray(detail)) return [];
  const erreurs: ErreurValidation[] = [];
  for (const entree of detail) {
    if (entree === null || typeof entree !== "object") continue;
    const { loc, msg } = entree as { loc?: unknown; msg?: unknown };
    const message = typeof msg === "string" ? msg : MESSAGE_GENERIQUE;
    let champ: string | null = null;
    if (Array.isArray(loc)) {
      const dernier = loc[loc.length - 1];
      if (typeof dernier === "string") champ = dernier;
    }
    erreurs.push({ champ, message });
  }
  return erreurs;
}

type DetailValidation = { msg?: unknown };
type CorpsErreur = { detail?: unknown };

function messageDepuisDetail(detail: unknown): string {
  if (typeof detail === "string" && detail.length > 0) {
    return detail;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const premier = detail[0] as DetailValidation | undefined;
    if (
      premier !== null &&
      premier !== undefined &&
      typeof premier === "object" &&
      typeof premier.msg === "string"
    ) {
      return premier.msg;
    }
  }
  return MESSAGE_GENERIQUE;
}

async function lireErreur(
  response: Response,
): Promise<{ message: string; detail: unknown }> {
  try {
    const corps = (await response.json()) as CorpsErreur;
    if (corps !== null && typeof corps === "object" && "detail" in corps) {
      return { message: messageDepuisDetail(corps.detail), detail: corps.detail };
    }
  } catch {
    // Corps non JSON : on retombe sur le message générique.
  }
  return { message: MESSAGE_GENERIQUE, detail: undefined };
}

async function requete<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, MESSAGE_RESEAU);
  }
  if (!response.ok) {
    const { message, detail } = await lireErreur(response);
    throw new ApiError(response.status, message, detail);
  }
  // 204 No Content : pas de corps à lire.
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return requete<T>("GET", path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return requete<T>("POST", path, body);
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return requete<T>("PATCH", path, body);
}

export function apiDelete(path: string): Promise<void> {
  return requete<void>("DELETE", path);
}
