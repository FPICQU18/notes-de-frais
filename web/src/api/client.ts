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

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
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

async function messageErreur(response: Response): Promise<string> {
  try {
    const corps = (await response.json()) as CorpsErreur;
    if (corps !== null && typeof corps === "object" && "detail" in corps) {
      return messageDepuisDetail(corps.detail);
    }
  } catch {
    // Corps non JSON : on retombe sur le message générique.
  }
  return MESSAGE_GENERIQUE;
}

export async function apiGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, MESSAGE_RESEAU);
  }
  if (!response.ok) {
    throw new ApiError(response.status, await messageErreur(response));
  }
  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, MESSAGE_RESEAU);
  }
  if (!response.ok) {
    throw new ApiError(response.status, await messageErreur(response));
  }
  // 204 No Content (logout) : pas de corps à lire.
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
