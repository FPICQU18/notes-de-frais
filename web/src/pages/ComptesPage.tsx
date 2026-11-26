import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Pencil, Plus, UserCheck, UserX } from "lucide-react";
import {
  ApiError,
  apiPatch,
  apiPost,
  erreursDeDetail,
  type UserRead,
} from "../api/client";
import { formatDateAnnee, initiales } from "../lib/format";
import { useApiGet } from "../lib/useApiGet";
import { useBureau } from "../lib/useMediaQuery";
import { BoutonRetour } from "../components/BoutonRetour";
import { TableauTriable, type ColonneTableau } from "../components/TableauTriable";

/** Compte renvoyé par `GET /api/v1/users` (admin seulement, tri `id` croissant). */
export interface CompteRead {
  id: number;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

const ROLES = ["utilisateur", "valideur", "admin"] as const;
type Role = (typeof ROLES)[number];

const LIBELLES_ROLE: Record<string, string> = {
  utilisateur: "Utilisateur",
  valideur: "Valideur",
  admin: "Admin",
};

function libelleRole(role: string): string {
  return LIBELLES_ROLE[role] ?? role;
}

type Props = {
  utilisateur: UserRead;
  onSessionExpiree: () => void;
};

type ChampForm = "display_name" | "email" | "role" | "password";

type CorpsCreation = {
  email: string;
  display_name: string;
  role: string;
  password: string;
};

/** Corps du PATCH d'édition (US-045) : nom, e-mail, rôle (mot de passe exclu). */
type CorpsEdition = {
  email: string;
  display_name: string;
  role: string;
};

type ResultatCreation =
  | { ok: true }
  | { ok: false; status: number; message: string; detail: unknown };

type ResultatEdition = ResultatCreation;

/** Pastille de statut du tableau bureau (mêmes couleurs que la liste mobile). */
function pastilleStatut(compte: CompteRead): string {
  return compte.is_active
    ? "bg-[var(--statut-validee-fond)] text-[var(--statut-validee-texte)]"
    : "bg-[var(--border)] text-[var(--muted-foreground)]";
}

/** Pastille de rôle du tableau bureau (même style que la liste mobile). */
const CLS_PASTILLE_ROLE =
  "inline-flex h-6 items-center whitespace-nowrap rounded-full bg-[var(--accent)] px-2.5 text-[12px] font-bold text-[var(--accent-foreground)]";

type PropsTableau = {
  compte: CompteRead;
  estMoi: boolean;
  busy: boolean;
  onModifier: () => void;
  onDesactiver: () => void;
  onReactiver: () => void;
};

/**
 * Cellule « actions » du tableau bureau (US-045) : « Modifier » ouvre la
 * feuille d'édition, « Désactiver »/« Réactiver » selon l'état (mêmes
 * comportements et erreurs que la liste mobile). Le compte de l'admin
 * connecté n'expose aucune action (comme la maquette).
 */
function CelluleActions({
  compte,
  estMoi,
  busy,
  onModifier,
  onDesactiver,
  onReactiver,
}: PropsTableau) {
  if (estMoi) {
    return <span className="text-[13px] font-semibold text-[var(--muted-foreground)]">—</span>;
  }
  return (
    <span className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onModifier}
        disabled={busy}
        className="flex h-11 items-center gap-1.5 rounded-[16px] bg-[var(--secondary)] px-4 text-[13px] font-bold whitespace-nowrap text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)]"
      >
        <Pencil aria-hidden strokeWidth={2} className="h-4 w-4" />
        Modifier
      </button>
      {compte.is_active ? (
        <button
          type="button"
          onClick={onDesactiver}
          disabled={busy}
          className="flex h-11 items-center gap-1.5 rounded-[16px] bg-[var(--erreur-fond)] px-4 text-[13px] font-bold whitespace-nowrap text-[var(--erreur-texte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <UserX aria-hidden strokeWidth={2} className="h-4 w-4" />
          Désactiver
        </button>
      ) : (
        <button
          type="button"
          onClick={onReactiver}
          disabled={busy}
          className="flex h-11 items-center gap-1.5 rounded-[16px] bg-[var(--statut-validee-fond)] px-4 text-[13px] font-bold whitespace-nowrap text-[var(--statut-validee-texte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <UserCheck aria-hidden strokeWidth={2} className="h-4 w-4" />
          Réactiver
        </button>
      )}
    </span>
  );
}

/**
 * Colonnes du tableau bureau des comptes (US-045), dans l'ordre de la
 * maquette `bureau-comptes.html` : nom, e-mail, rôle, statut, date de
 * création, actions. Le rôle et le statut ne sont pas triables (la maquette
 * n'a pas d'en-tête cliquable) ; nom, e-mail et date le sont.
 */
function colonnesComptes(actions: {
  onModifier: (compte: CompteRead) => void;
  onDesactiver: (compte: CompteRead) => void;
  onReactiver: (compte: CompteRead) => void;
  estMoi: (compte: CompteRead) => boolean;
  busy: (compte: CompteRead) => boolean;
}): ColonneTableau<CompteRead>[] {
  return [
    {
      cle: "nom",
      libelle: "Nom",
      triable: true,
      classe: "min-w-[180px]",
      valeurTri: (compte) => compte.display_name,
      cellule: (compte) => (
        <span className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[20px] bg-[var(--accent)] text-[13px] font-extrabold text-[var(--accent-foreground)]"
          >
            {initiales(compte.display_name)}
          </span>
          <span className="block truncate text-[15px] font-bold">{compte.display_name}</span>
        </span>
      ),
    },
    {
      cle: "email",
      libelle: "E-mail",
      triable: true,
      classe: "min-w-[200px]",
      valeurTri: (compte) => compte.email,
      cellule: (compte) => (
        <span className="block truncate text-[14px] text-[var(--muted-foreground)]">
          {compte.email}
        </span>
      ),
    },
    {
      cle: "role",
      libelle: "Rôle",
      classe: "w-[130px]",
      cellule: (compte) => <span className={CLS_PASTILLE_ROLE}>{libelleRole(compte.role)}</span>,
    },
    {
      cle: "statut",
      libelle: "Statut",
      classe: "w-[110px]",
      cellule: (compte) => (
        <span
          className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-bold ${pastilleStatut(compte)}`}
        >
          {compte.is_active ? "Actif" : "Inactif"}
        </span>
      ),
    },
    {
      cle: "created_at",
      libelle: "Créé le",
      triable: true,
      classe: "w-[130px]",
      valeurTri: (compte) => compte.created_at,
      cellule: (compte) => (
        <span className="text-[14px] whitespace-nowrap text-[var(--muted-foreground)]">
          {formatDateAnnee(compte.created_at.slice(0, 10))}
        </span>
      ),
    },
    {
      cle: "actions",
      libelle: "Actions",
      classe: "w-[240px]",
      cellule: (compte) => (
        <CelluleActions
          compte={compte}
          estMoi={actions.estMoi(compte)}
          busy={actions.busy(compte)}
          onModifier={() => actions.onModifier(compte)}
          onDesactiver={() => actions.onDesactiver(compte)}
          onReactiver={() => actions.onReactiver(compte)}
        />
      ),
    },
  ];
}

/**
 * Page `/admin/comptes` : liste des comptes (ordre de l'API), création,
 * changement de rôle par ligne, désactivation / réactivation. Tous les refus
 * (403, 409, 422) viennent du serveur et sont affichés tels quels.
 */
export function ComptesPage({ utilisateur, onSessionExpiree }: Props) {
  const refTitre = useRef<HTMLHeadingElement>(null);
  const refNouveau = useRef<HTMLButtonElement>(null);
  const refFeuilleOuverte = useRef(false);

  const [annonce, setAnnonce] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [actionEnCours, setActionEnCours] = useState<number | null>(null);
  const [rolesChoisis, setRolesChoisis] = useState<Record<number, string>>({});
  /** Mises à jour locales appliquées aux lignes après un succès (rôle, état). */
  const [remplacements, setRemplacements] = useState<
    Record<number, { role?: string; is_active?: boolean }>
  >({});

  const [feuilleCreation, setFeuilleCreation] = useState(false);
  const [aDesactiver, setADesactiver] = useState<CompteRead | null>(null);
  const [aModifier, setAModifier] = useState<CompteRead | null>(null);
  const bureau = useBureau();

  // Le hook gère chargement, erreur et « Réessayer » ; `tentative` permet de
  // recharger la liste après une création réussie.
  const [tentative, setTentative] = useState(0);
  const listeApi = useApiGet<CompteRead[]>(`/v1/users?t=${tentative}`, onSessionExpiree);
  const recharger = useCallback(() => setTentative((valeur) => valeur + 1), []);

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  // Le focus revient au bouton « Nouveau compte » quand une feuille se ferme.
  useEffect(() => {
    const feuilleOuverte = feuilleCreation || aDesactiver !== null || aModifier !== null;
    if (!feuilleOuverte && refFeuilleOuverte.current) {
      refNouveau.current?.focus();
    }
    refFeuilleOuverte.current = feuilleOuverte;
  }, [feuilleCreation, aDesactiver, aModifier]);

  async function creerCompte(corps: CorpsCreation): Promise<ResultatCreation> {
    try {
      await apiPost<CompteRead>("/v1/users", corps);
      return { ok: true };
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return { ok: false, status: 401, message: "", detail: undefined };
      }
      if (attrape instanceof ApiError) {
        return {
          ok: false,
          status: attrape.status,
          message: attrape.message,
          detail: attrape.detail,
        };
      }
      return { ok: false, status: 0, message: "Une erreur est survenue.", detail: undefined };
    }
  }

  function apresCreation() {
    setFeuilleCreation(false);
    setAnnonce("Compte créé.");
    recharger();
  }

  /**
   * Édition d'un compte (US-045, feuille ouverte depuis le tableau bureau) :
   * PATCH nom/e-mail/rôle. Le mot de passe n'est pas modifiable ici. Les
   * erreurs 401/403/422 sont traitées comme pour la création.
   */
  async function modifierCompte(
    compte: CompteRead,
    corps: CorpsEdition,
  ): Promise<ResultatEdition> {
    try {
      await apiPatch(`/v1/users/${compte.id}`, corps);
      return { ok: true };
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return { ok: false, status: 401, message: "", detail: undefined };
      }
      if (attrape instanceof ApiError) {
        return {
          ok: false,
          status: attrape.status,
          message: attrape.message,
          detail: attrape.detail,
        };
      }
      return { ok: false, status: 0, message: "Une erreur est survenue.", detail: undefined };
    }
  }

  function apresEdition(compte: CompteRead, corps: CorpsEdition) {
    setAModifier(null);
    setRemplacements((precedent) => ({
      ...precedent,
      [compte.id]: { role: corps.role },
    }));
    setAnnonce("Compte modifié.");
    recharger();
  }

  async function changerRole(compte: CompteRead, nouveauRole: string) {
    if (actionEnCours !== null || nouveauRole === compte.role) return;
    setActionEnCours(compte.id);
    setErreurAction(null);
    setRolesChoisis((precedent) => ({ ...precedent, [compte.id]: nouveauRole }));
    try {
      await apiPatch(`/v1/users/${compte.id}/role`, { role: nouveauRole });
      setRemplacements((precedent) => ({
        ...precedent,
        [compte.id]: { role: nouveauRole },
      }));
      setAnnonce("Rôle modifié.");
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      setErreurAction(
        attrape instanceof ApiError ? attrape.message : "Une erreur est survenue.",
      );
      // La ligne revient à son rôle précédent.
      setRolesChoisis((precedent) => ({ ...precedent, [compte.id]: compte.role }));
    } finally {
      setActionEnCours(null);
    }
  }

  async function confirmerDesactivation() {
    const compte = aDesactiver;
    if (compte === null || actionEnCours !== null) return;
    setActionEnCours(compte.id);
    setErreurAction(null);
    try {
      await apiPost(`/v1/users/${compte.id}/deactivate`);
      setRemplacements((precedent) => ({
        ...precedent,
        [compte.id]: { is_active: false },
      }));
      setAnnonce("Compte désactivé.");
      setADesactiver(null);
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      setErreurAction(
        attrape instanceof ApiError ? attrape.message : "Une erreur est survenue.",
      );
      setADesactiver(null);
    } finally {
      setActionEnCours(null);
    }
  }

  async function reactiver(compte: CompteRead) {
    if (actionEnCours !== null) return;
    setActionEnCours(compte.id);
    setErreurAction(null);
    try {
      await apiPost(`/v1/users/${compte.id}/reactivate`);
      setRemplacements((precedent) => ({
        ...precedent,
        [compte.id]: { is_active: true },
      }));
      setAnnonce("Compte réactivé.");
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      setErreurAction(
        attrape instanceof ApiError ? attrape.message : "Une erreur est survenue.",
      );
    } finally {
      setActionEnCours(null);
    }
  }

  const listeBrute = listeApi.donnees ?? [];
  const liste = listeBrute.map((compte) => {
    const remplacement = remplacements[compte.id];
    return remplacement === undefined ? compte : { ...compte, ...remplacement };
  });
  const chargement = listeApi.chargement;
  const erreurListe = listeApi.erreur;
  const erreurStatus = listeApi.erreurStatus;
  const estVide = !chargement && erreurListe === null && liste.length === 0;

  return (
    <main className="mx-auto w-full max-w-[560px] px-5 pb-28 pt-6">
      <header className="mb-5 flex h-16 items-center gap-2">
        <BoutonRetour libelleAria="Retour au profil" />
        <h1
          ref={refTitre}
          tabIndex={-1}
          className="m-0 flex-1 text-2xl font-extrabold tracking-[-0.01em] focus:outline-none"
        >
          Comptes
        </h1>
      </header>

      <button
        type="button"
        ref={refNouveau}
        onClick={() => {
          setErreurAction(null);
          setFeuilleCreation(true);
        }}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--primary)] px-5 text-[15px] font-bold text-[var(--primary-foreground)] shadow-[var(--ombre-bouton-flottant)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        <Plus aria-hidden strokeWidth={2} className="h-5 w-5" />
        Nouveau compte
      </button>

      {annonce !== null && (
        <p
          role="status"
          aria-live="polite"
          className="m-0 mt-4 rounded-[16px] bg-[var(--accent)] p-4 text-[13px] font-semibold text-[var(--accent-foreground)]"
        >
          {annonce}
        </p>
      )}

      {erreurAction !== null && (
        <p
          role="alert"
          className="m-0 mt-4 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
        >
          {erreurAction}
        </p>
      )}

      <section aria-busy={chargement || undefined} aria-label="Comptes" className="mt-5">
        {chargement && <p className="chargement">Chargement…</p>}

        {!chargement && erreurListe !== null && (
          <div className="flex flex-col gap-3">
            <p
              role="alert"
              className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {erreurListe}
            </p>
            {/* « Réessayer » seulement pour une erreur réseau/serveur ; un 403
                (rôle insuffisant) est définitif : le serveur a refusé. */}
            {erreurStatus !== 403 && (
              <button
                type="button"
                onClick={listeApi.reessayer}
                className="h-12 w-full rounded-[18px] bg-[var(--primary)] text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                Réessayer
              </button>
            )}
          </div>
        )}

        {estVide && (
          <p className="m-0 text-center text-[15px] text-[var(--muted-foreground)]">
            Aucun compte.
          </p>
        )}

        {liste.length > 0 &&
          (bureau ? (
            <TableauTriable
              titre="Tous les comptes"
              colonnes={colonnesComptes({
                onModifier: (compte) => {
                  setErreurAction(null);
                  setAModifier(compte);
                },
                onDesactiver: (compte) => setADesactiver(compte),
                onReactiver: (compte) => void reactiver(compte),
                estMoi: (compte) => compte.id === utilisateur.id,
                busy: (compte) => actionEnCours === compte.id,
              })}
              lignes={liste}
              cleLigne={(compte) => compte.id}
              vers={(compte) => `/admin/comptes#${compte.id}`}
              etiquetteLigne={(compte) => `Modifier le compte ${compte.display_name}`}
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
              {liste.map((compte) => (
                <LigneCompte
                  key={compte.id}
                  compte={compte}
                  estMoi={compte.id === utilisateur.id}
                  roleAffiche={rolesChoisis[compte.id] ?? compte.role}
                  busy={actionEnCours === compte.id}
                  onChangerRole={(role) => void changerRole(compte, role)}
                  onDesactiver={() => setADesactiver(compte)}
                  onReactiver={() => void reactiver(compte)}
                />
              ))}
            </ul>
          ))}
      </section>

      {feuilleCreation && (
        <FeuilleNouveauCompte
          onFerme={() => setFeuilleCreation(false)}
          onCreer={creerCompte}
          onCree={apresCreation}
        />
      )}

      {aDesactiver !== null && (
        <FeuilleDesactivation
          compte={aDesactiver}
          busy={actionEnCours === aDesactiver.id}
          onAnnuler={() => setADesactiver(null)}
          onConfirmer={() => void confirmerDesactivation()}
        />
      )}

      {aModifier !== null && (
        <FeuilleEditionCompte
          compte={aModifier}
          onFerme={() => setAModifier(null)}
          onModifier={(corps) => modifierCompte(aModifier, corps)}
          onModifie={(corps) => apresEdition(aModifier, corps)}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */

type PropsLigne = {
  compte: CompteRead;
  estMoi: boolean;
  roleAffiche: string;
  busy: boolean;
  onChangerRole: (role: string) => void;
  onDesactiver: () => void;
  onReactiver: () => void;
};

function LigneCompte({
  compte,
  estMoi,
  roleAffiche,
  busy,
  onChangerRole,
  onDesactiver,
  onReactiver,
}: PropsLigne) {
  // Retirer son propre rôle admin est interdit : les autres rôles sont
  // désactivés dans le sélecteur de sa propre ligne (le serveur refuse, 403).
  const retraitPropreRole = estMoi && compte.role === "admin";
  const pastilleEtat = compte.is_active
    ? "bg-[var(--statut-validee-fond)] text-[var(--statut-validee-texte)]"
    : "bg-[var(--border)] text-[var(--muted-foreground)]";

  return (
    <li className="rounded-[22px] bg-[var(--card)] p-4 shadow-[var(--ombre-carte)]">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[20px] bg-[var(--accent)] text-[13px] font-extrabold text-[var(--accent-foreground)]"
        >
          {initiales(compte.display_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[15px] font-bold">{compte.display_name}</p>
          <p className="m-0 mt-0.5 truncate text-[13px] text-[var(--muted-foreground)]">
            {compte.email}
          </p>
        </div>
        <span
          className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-bold ${pastilleEtat}`}
        >
          {compte.is_active ? "Actif" : "Inactif"}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full bg-[var(--accent)] px-2.5 text-[12px] font-bold text-[var(--accent-foreground)]">
          {libelleRole(compte.role)}
        </span>
        {estMoi && (
          <span className="text-[12px] font-semibold text-[var(--muted-foreground)]">
            Votre compte
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`role-compte-${compte.id}`} className="sr-only">
            Changer le rôle de {compte.display_name}
          </label>
          <select
            id={`role-compte-${compte.id}`}
            value={roleAffiche}
            disabled={busy}
            onChange={(evenement) => onChangerRole(evenement.target.value)}
            className="h-11 w-full rounded-[16px] border-0 bg-[var(--secondary)] px-3 text-[13px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)]"
          >
            {ROLES.map((role) => (
              <option key={role} value={role} disabled={retraitPropreRole && role !== "admin"}>
                {libelleRole(role)}
              </option>
            ))}
          </select>
        </div>
        {compte.is_active ? (
          <button
            type="button"
            onClick={onDesactiver}
            disabled={busy || estMoi}
            aria-describedby={estMoi ? `aide-compte-${compte.id}` : undefined}
            className="h-11 shrink-0 rounded-[16px] bg-[var(--secondary)] px-3 text-[13px] font-bold whitespace-nowrap text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)]"
          >
            Désactiver
          </button>
        ) : (
          <button
            type="button"
            onClick={onReactiver}
            disabled={busy}
            className="h-11 shrink-0 rounded-[16px] bg-[var(--secondary)] px-3 text-[13px] font-bold whitespace-nowrap text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)]"
          >
            Réactiver
          </button>
        )}
      </div>

      {estMoi && (
        <div id={`aide-compte-${compte.id}`} className="mt-2 flex flex-col gap-0.5">
          <p className="m-0 text-[12px] text-[var(--muted-foreground)]">
            Vous ne pouvez pas désactiver votre propre compte.
          </p>
          {compte.role === "admin" && (
            <p className="m-0 text-[12px] text-[var(--muted-foreground)]">
              Vous ne pouvez pas retirer votre propre rôle admin.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */

/** Voile + feuille basse commune aux surcouches de la page. */
function Feuille({
  titre,
  onFerme,
  peutFermer,
  children,
}: {
  titre: string;
  onFerme: () => void;
  peutFermer: boolean;
  children: ReactNode;
}) {
  function gererTouche(evenement: KeyboardEvent<HTMLDivElement>) {
    if (evenement.key === "Escape" && peutFermer) {
      evenement.preventDefault();
      onFerme();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(26,26,46,0.45)] sm:items-center sm:justify-center sm:px-5"
      onClick={peutFermer ? onFerme : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-feuille"
        className="w-full rounded-t-[26px] bg-[var(--card)] p-5 pb-8 shadow-[var(--ombre-carte)] sm:max-w-[420px] sm:rounded-[26px]"
        onClick={(evenement) => evenement.stopPropagation()}
        onKeyDown={gererTouche}
      >
        <h2
          id="titre-feuille"
          className="m-0 mb-4 text-[20px] font-extrabold tracking-[-0.01em]"
        >
          {titre}
        </h2>
        {children}
      </div>
    </div>
  );
}

const CLS_CHAMP =
  "h-[52px] w-full rounded-[18px] border-0 bg-[var(--secondary)] px-4 text-[15px] text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]";
const CLS_LIBELLE = "mb-1.5 block text-[13px] font-bold text-[var(--muted-foreground)]";

function FeuilleNouveauCompte({
  onFerme,
  onCreer,
  onCree,
}: {
  onFerme: () => void;
  onCreer: (corps: CorpsCreation) => Promise<ResultatCreation>;
  onCree: () => void;
}) {
  const refPremierChamp = useRef<HTMLInputElement>(null);
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("utilisateur");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreurs, setErreurs] = useState<Record<ChampForm, string | null>>({
    display_name: null,
    email: null,
    role: null,
    password: null,
  });
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  useEffect(() => {
    refPremierChamp.current?.focus();
  }, []);

  async function envoyer() {
    if (envoiEnCours) return;
    setEnvoiEnCours(true);
    setErreurGlobale(null);
    setErreurs({ display_name: null, email: null, role: null, password: null });
    const resultat = await onCreer({
      email: email.trim(),
      display_name: nom.trim(),
      role,
      password: motDePasse,
    });
    if (resultat.ok) {
      // La feuille se ferme (démontée) : le mot de passe n'est conservé
      // dans aucun état.
      onCree();
      return;
    }
    if (resultat.status === 401) return; // onSessionExpiree() déjà appelé
    if (resultat.status === 422) {
      const nouvelles: Record<ChampForm, string | null> = {
        display_name: null,
        email: null,
        role: null,
        password: null,
      };
      for (const entree of erreursDeDetail(resultat.detail)) {
        if (entree.champ !== null && entree.champ in nouvelles) {
          nouvelles[entree.champ as ChampForm] = entree.message;
        } else {
          setErreurGlobale(entree.message);
        }
      }
      setErreurs(nouvelles);
    } else {
      // 409 (e-mail déjà pris) et autres : message du serveur, saisie conservée.
      setErreurGlobale(resultat.message);
    }
    setEnvoiEnCours(false);
  }

  function gererSoumission(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    void envoyer();
  }

  function messageErreur(champ: ChampForm, idErreur: string) {
    if (erreurs[champ] === null) return null;
    return (
      <p
        role="alert"
        id={idErreur}
        className="m-0 mb-1.5 text-[13px] font-semibold text-[var(--erreur-texte)]"
      >
        {erreurs[champ]}
      </p>
    );
  }

  return (
    <Feuille titre="Nouveau compte" onFerme={onFerme} peutFermer={!envoiEnCours}>
      <form onSubmit={gererSoumission} noValidate>
        {erreurGlobale !== null && (
          <p
            role="alert"
            className="m-0 mb-4 rounded-[16px] bg-[var(--erreur-fond)] p-3 text-[13px] font-semibold text-[var(--erreur-texte)]"
          >
            {erreurGlobale}
          </p>
        )}

        <div>
          <label htmlFor="nouveau-nom" className={CLS_LIBELLE}>
            Nom affiché
          </label>
          {messageErreur("display_name", "erreur-nouveau-nom")}
          <input
            ref={refPremierChamp}
            id="nouveau-nom"
            type="text"
            autoComplete="name"
            value={nom}
            onChange={(evenement) => setNom(evenement.target.value)}
            aria-invalid={erreurs.display_name !== null || undefined}
            aria-describedby={erreurs.display_name !== null ? "erreur-nouveau-nom" : undefined}
            className={CLS_CHAMP}
          />
        </div>

        <div className="mt-4">
          <label htmlFor="nouveau-email" className={CLS_LIBELLE}>
            E-mail
          </label>
          {messageErreur("email", "erreur-nouveau-email")}
          <input
            id="nouveau-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(evenement) => setEmail(evenement.target.value)}
            aria-invalid={erreurs.email !== null || undefined}
            aria-describedby={erreurs.email !== null ? "erreur-nouveau-email" : undefined}
            className={CLS_CHAMP}
          />
        </div>

        <div className="mt-4">
          <label htmlFor="nouveau-role" className={CLS_LIBELLE}>
            Rôle
          </label>
          {messageErreur("role", "erreur-nouveau-role")}
          <select
            id="nouveau-role"
            value={role}
            onChange={(evenement) => setRole(evenement.target.value as Role)}
            aria-invalid={erreurs.role !== null || undefined}
            aria-describedby={erreurs.role !== null ? "erreur-nouveau-role" : undefined}
            className={`${CLS_CHAMP} font-semibold`}
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {libelleRole(option)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <label htmlFor="nouveau-mdp" className={CLS_LIBELLE}>
            Mot de passe initial
          </label>
          {messageErreur("password", "erreur-nouveau-mdp")}
          <input
            id="nouveau-mdp"
            type="password"
            autoComplete="new-password"
            value={motDePasse}
            onChange={(evenement) => setMotDePasse(evenement.target.value)}
            aria-invalid={erreurs.password !== null || undefined}
            aria-describedby={`aide-nouveau-mdp${erreurs.password !== null ? " erreur-nouveau-mdp" : ""}`}
            className={CLS_CHAMP}
          />
          <p id="aide-nouveau-mdp" className="m-0 mt-1.5 text-[12px] text-[var(--muted-foreground)]">
            Au moins 12 caractères.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onFerme}
            disabled={envoiEnCours}
            className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={envoiEnCours}
            aria-busy={envoiEnCours}
            className="h-[52px] rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
          >
            {envoiEnCours ? "Création…" : "Créer le compte"}
          </button>
        </div>
      </form>
    </Feuille>
  );
}

/* ------------------------------------------------------------------ */

type ChampEdition = "display_name" | "email" | "role";

/**
 * Feuille d'édition d'un compte (US-045, ouverte depuis « Modifier » dans le
 * tableau bureau) : mêmes champs que la création sauf le mot de passe, mêmes
 * traitements d'erreurs 403/409/422 (message du serveur + détail par champ).
 */
function FeuilleEditionCompte({
  compte,
  onFerme,
  onModifier,
  onModifie,
}: {
  compte: CompteRead;
  onFerme: () => void;
  onModifier: (corps: CorpsEdition) => Promise<ResultatEdition>;
  onModifie: (corps: CorpsEdition) => void;
}) {
  const refPremierChamp = useRef<HTMLInputElement>(null);
  const [nom, setNom] = useState(compte.display_name);
  const [email, setEmail] = useState(compte.email);
  const [role, setRole] = useState<Role>((ROLES as readonly string[]).includes(compte.role) ? (compte.role as Role) : "utilisateur");
  const [erreurs, setErreurs] = useState<Record<ChampEdition, string | null>>({
    display_name: null,
    email: null,
    role: null,
  });
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  useEffect(() => {
    refPremierChamp.current?.focus();
  }, []);

  async function envoyer() {
    if (envoiEnCours) return;
    setEnvoiEnCours(true);
    setErreurGlobale(null);
    setErreurs({ display_name: null, email: null, role: null });
    const corps: CorpsEdition = {
      email: email.trim(),
      display_name: nom.trim(),
      role,
    };
    const resultat = await onModifier(corps);
    if (resultat.ok) {
      onModifie(corps);
      return;
    }
    if (resultat.status === 401) return; // onSessionExpiree() déjà appelé
    if (resultat.status === 422) {
      const nouvelles: Record<ChampEdition, string | null> = {
        display_name: null,
        email: null,
        role: null,
      };
      for (const entree of erreursDeDetail(resultat.detail)) {
        if (entree.champ !== null && entree.champ in nouvelles) {
          nouvelles[entree.champ as ChampEdition] = entree.message;
        } else {
          setErreurGlobale(entree.message);
        }
      }
      setErreurs(nouvelles);
    } else {
      setErreurGlobale(resultat.message);
    }
    setEnvoiEnCours(false);
  }

  function gererSoumission(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    void envoyer();
  }

  function messageErreur(champ: ChampEdition, idErreur: string) {
    if (erreurs[champ] === null) return null;
    return (
      <p
        role="alert"
        id={idErreur}
        className="m-0 mb-1.5 text-[13px] font-semibold text-[var(--erreur-texte)]"
      >
        {erreurs[champ]}
      </p>
    );
  }

  return (
    <Feuille titre={`Modifier ${compte.display_name}`} onFerme={onFerme} peutFermer={!envoiEnCours}>
      <form onSubmit={gererSoumission} noValidate>
        {erreurGlobale !== null && (
          <p
            role="alert"
            className="m-0 mb-4 rounded-[16px] bg-[var(--erreur-fond)] p-3 text-[13px] font-semibold text-[var(--erreur-texte)]"
          >
            {erreurGlobale}
          </p>
        )}

        <div>
          <label htmlFor="edition-nom" className={CLS_LIBELLE}>
            Nom affiché
          </label>
          {messageErreur("display_name", "erreur-edition-nom")}
          <input
            ref={refPremierChamp}
            id="edition-nom"
            type="text"
            autoComplete="name"
            value={nom}
            onChange={(evenement) => setNom(evenement.target.value)}
            aria-invalid={erreurs.display_name !== null || undefined}
            aria-describedby={erreurs.display_name !== null ? "erreur-edition-nom" : undefined}
            className={CLS_CHAMP}
          />
        </div>

        <div className="mt-4">
          <label htmlFor="edition-email" className={CLS_LIBELLE}>
            E-mail
          </label>
          {messageErreur("email", "erreur-edition-email")}
          <input
            id="edition-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(evenement) => setEmail(evenement.target.value)}
            aria-invalid={erreurs.email !== null || undefined}
            aria-describedby={erreurs.email !== null ? "erreur-edition-email" : undefined}
            className={CLS_CHAMP}
          />
        </div>

        <div className="mt-4">
          <label htmlFor="edition-role" className={CLS_LIBELLE}>
            Rôle
          </label>
          {messageErreur("role", "erreur-edition-role")}
          <select
            id="edition-role"
            value={role}
            onChange={(evenement) => setRole(evenement.target.value as Role)}
            aria-invalid={erreurs.role !== null || undefined}
            aria-describedby={erreurs.role !== null ? "erreur-edition-role" : undefined}
            className={`${CLS_CHAMP} font-semibold`}
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {libelleRole(option)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onFerme}
            disabled={envoiEnCours}
            className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={envoiEnCours}
            aria-busy={envoiEnCours}
            className="h-[52px] rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
          >
            {envoiEnCours ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </Feuille>
  );
}

/* ------------------------------------------------------------------ */

function FeuilleDesactivation({
  compte,
  busy,
  onAnnuler,
  onConfirmer,
}: {
  compte: CompteRead;
  busy: boolean;
  onAnnuler: () => void;
  onConfirmer: () => void;
}) {
  const refAnnuler = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    refAnnuler.current?.focus();
  }, []);

  return (
    <Feuille titre="Désactiver ce compte ?" onFerme={onAnnuler} peutFermer={!busy}>
      <p className="m-0 text-[14px] leading-relaxed text-[var(--muted-foreground)]">
        {`Désactiver ${compte.display_name} ? Ses sessions seront fermées.`}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          ref={refAnnuler}
          onClick={onAnnuler}
          disabled={busy}
          className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onConfirmer}
          disabled={busy}
          aria-busy={busy}
          className="h-[52px] rounded-[18px] bg-[var(--erreur-texte)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
        >
          {busy ? "Désactivation…" : "Désactiver"}
        </button>
      </div>
    </Feuille>
  );
}
