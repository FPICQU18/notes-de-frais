import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";

import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  MESSAGE_GENERIQUE,
  type NoteDetail,
  type StatutNote,
  type TransitionRead,
} from "../api/client";
import { CarteDepense } from "../components/depense/CarteDepense";
import { PanneauAjoutDepenses } from "../components/dossier/PanneauAjoutDepenses";
import { cleCategorie, libelleCategorie } from "../lib/categories";
import { formatDateHeure, formatMontant, formatNbDepenses } from "../lib/format";
import { calculerRepartition } from "../lib/repartition";
import { useApiGet } from "../lib/useApiGet";

const LIBELLES_STATUT: Record<StatutNote, string> = {
  brouillon: "Brouillon",
  soumise: "Soumise",
  validee: "Validée",
  refusee: "Refusée",
  remboursee: "Remboursée",
};

function libelleStatut(statut: string): string {
  return (LIBELLES_STATUT as Record<string, string>)[statut] ?? statut;
}

type Props = {
  onSessionExpiree: () => void;
};

/** Détail d'un dossier : consultation, et édition tant qu'il est en brouillon. */
export function DossierDetailPage({ onSessionExpiree }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const refTitre = useRef<HTMLHeadingElement>(null);

  const note = useApiGet<NoteDetail>(`/v1/notes/${id}`, onSessionExpiree);
  const detail = note.donnees;
  const enBrouillon = detail !== null && detail.statut === "brouillon";
  const enLectureSeule = detail !== null && detail.statut !== "brouillon";

  const [messageAlerte, setMessageAlerte] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState<string | null>(null);
  const [actionEnCours, setActionEnCours] = useState(false);

  const [panneauAjout, setPanneauAjout] = useState(false);
  const [renommage, setRenommage] = useState(false);
  const [confirmationSuppression, setConfirmationSuppression] = useState(false);
  const [confirmationEnvoi, setConfirmationEnvoi] = useState(false);

  const [historique, setHistorique] = useState<TransitionRead[] | null>(null);
  const [erreurHistorique, setErreurHistorique] = useState<string | null>(null);
  const [cleHistorique, setCleHistorique] = useState<string | null>(null);

  const idNote = detail?.id;

  // Le titre est focalisé à la première apparition du dossier (et au changement de dossier).
  useEffect(() => {
    refTitre.current?.focus();
  }, [idNote]);

  // Réinitialise l'historique à chaque changement de dossier : ajustement d'état
  // pendant le rendu (pattern recommandé par React, cf. « you might not need an effect »).
  const nouvelleCleHistorique =
    enLectureSeule && idNote !== undefined ? `note-${idNote}` : null;
  if (nouvelleCleHistorique !== cleHistorique) {
    setCleHistorique(nouvelleCleHistorique);
    setHistorique(null);
    setErreurHistorique(null);
  }

  // Historique : uniquement hors brouillon.
  useEffect(() => {
    if (!enLectureSeule || idNote === undefined) return;
    let actif = true;
    apiGet<TransitionRead[]>(`/v1/notes/${idNote}/historique`)
      .then((transitions) => {
        if (actif) setHistorique(transitions);
      })
      .catch((attrape: unknown) => {
        if (!actif) return;
        if (attrape instanceof ApiError && attrape.status === 401) {
          onSessionExpiree();
          return;
        }
        setErreurHistorique(attrape instanceof ApiError ? attrape.message : MESSAGE_GENERIQUE);
      });
    return () => {
      actif = false;
    };
  }, [enLectureSeule, idNote, onSessionExpiree]);

  const depenses = detail?.depenses ?? [];
  const total = detail?.total_centimes ?? 0;
  const segments = detail === null ? [] : calculerRepartition(detail.depenses);

  const motifRefus =
    detail !== null && detail.statut === "refusee" && historique !== null
      ? ([...historique].reverse().find(
          (transition) => transition.nouveau_statut === "refusee" && transition.motif !== null,
        )?.motif ?? null)
      : null;

  function surSessionExpireeOuErreur(attrape: unknown): boolean {
    if (attrape instanceof ApiError && attrape.status === 401) {
      onSessionExpiree();
      return true;
    }
    setMessageAlerte(attrape instanceof ApiError ? attrape.message : MESSAGE_GENERIQUE);
    return false;
  }

  async function retirerDepense(idDepense: number) {
    if (detail === null) return;
    setMessageAlerte(null);
    try {
      await apiDelete(`/v1/notes/${detail.id}/depenses/${idDepense}`);
      note.reessayer();
    } catch (attrape) {
      surSessionExpireeOuErreur(attrape);
      // Resynchronise quoi qu'il arrive (la dépense a pu être retirée côté serveur).
      note.reessayer();
    }
  }

  async function renommer(titre: string) {
    if (detail === null) return;
    setActionEnCours(true);
    setMessageAlerte(null);
    try {
      await apiPatch(`/v1/notes/${detail.id}`, { libelle: titre });
      setRenommage(false);
      note.reessayer();
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      setRenommage(false);
      setMessageAlerte(attrape instanceof ApiError ? attrape.message : MESSAGE_GENERIQUE);
      // 409 : le dossier n'est plus en brouillon, repasse en lecture seule.
      if (attrape instanceof ApiError && attrape.status === 409) {
        note.reessayer();
      }
    } finally {
      setActionEnCours(false);
    }
  }

  async function supprimer() {
    if (detail === null) return;
    setActionEnCours(true);
    setMessageAlerte(null);
    try {
      await apiDelete(`/v1/notes/${detail.id}`);
      navigate("/dossiers", { state: { annonce: "Dossier supprimé." } });
    } catch (attrape) {
      surSessionExpireeOuErreur(attrape);
      setActionEnCours(false);
    }
  }

  async function envoyer() {
    if (detail === null) return;
    setActionEnCours(true);
    setMessageAlerte(null);
    try {
      await apiPost(`/v1/notes/${detail.id}/soumettre`);
      setConfirmationEnvoi(false);
      setAnnonce("Dossier envoyé pour validation.");
      note.reessayer();
    } catch (attrape) {
      surSessionExpireeOuErreur(attrape);
    } finally {
      setActionEnCours(false);
    }
  }

  async function rouvrir() {
    if (detail === null) return;
    setActionEnCours(true);
    setMessageAlerte(null);
    try {
      await apiPost(`/v1/notes/${detail.id}/rouvrir`);
      setAnnonce("Dossier rouvert. Il est à nouveau modifiable.");
      note.reessayer();
    } catch (attrape) {
      surSessionExpireeOuErreur(attrape);
    } finally {
      setActionEnCours(false);
    }
  }

  return (
    <main className="page" aria-busy={note.chargement || undefined}>
      {note.chargement && detail === null && (
        <p className="chargement" role="status">
          Chargement…
        </p>
      )}

      {!note.chargement && note.erreur !== null && detail === null &&
        (note.erreurStatus === 404 ? (
          <section aria-label="Dossier introuvable" className="m-0 flex flex-col gap-3">
            <p
              role="alert"
              className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              Ce dossier est introuvable.
            </p>
            <Link
              to="/dossiers"
              className="inline-flex h-[52px] items-center justify-center rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              Retour aux dossiers
            </Link>
          </section>
        ) : (
          <section aria-label="Erreur" className="m-0 flex flex-col gap-3">
            <p
              role="alert"
              className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {note.erreur}
            </p>
            <button
              type="button"
              onClick={note.reessayer}
              className="h-[52px] rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              Réessayer
            </button>
          </section>
        ))}

      {detail !== null && (
        <>
          <header className="mb-2 flex items-center gap-3">
            <Link
              to="/dossiers"
              aria-label="Retour aux dossiers"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--card)] text-[var(--foreground)] shadow-[var(--ombre-carte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              <ArrowLeft size={22} strokeWidth={2} aria-hidden="true" />
            </Link>
            <span
              className="inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-bold"
              style={{
                backgroundColor: `var(--statut-${detail.statut}-fond)`,
                color: `var(--statut-${detail.statut}-texte)`,
              }}
            >
              {libelleStatut(detail.statut)}
            </span>
          </header>

          <h1
            ref={refTitre}
            tabIndex={-1}
            className="m-0 break-words text-[26px] font-extrabold leading-tight tracking-[-0.01em] focus:outline-none"
          >
            {detail.libelle}
          </h1>
          <p className="m-0 mt-1 text-[13px] font-semibold text-[var(--muted-foreground)]">
            {formatNbDepenses(detail.nb_depenses)}
          </p>

          {annonce !== null && (
            <p
              role="status"
              className="m-0 mt-3 rounded-[16px] bg-[var(--accent)] p-4 text-[13px] font-semibold text-[var(--accent-foreground)]"
            >
              {annonce}
            </p>
          )}

          {messageAlerte !== null && (
            <p
              role="alert"
              className="m-0 mt-3 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {messageAlerte}
            </p>
          )}

          {motifRefus !== null && (
            <div
              role="status"
              className="m-0 mt-3 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              <p className="m-0 text-[12px] font-bold uppercase tracking-wide opacity-80">
                Motif du refus
              </p>
              <p className="m-0 mt-1 text-[15px]">{motifRefus}</p>
            </div>
          )}

          <section
            aria-label="Total"
            className="mt-4 rounded-[26px] bg-[var(--card)] p-[20px] shadow-[var(--ombre-carte)]"
          >
            <p className="m-0 text-[13px] font-bold text-[var(--muted-foreground)]">Total</p>
            <p className="m-0 mt-1 text-[40px] font-extrabold leading-none tabular-nums">
              {formatMontant(total)}
            </p>

            {segments.length > 0 && (
              <>
                <div aria-hidden="true" className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full">
                  {segments.map((segment) => (
                    <div
                      key={segment.categorie}
                      style={{
                        width: `${segment.pourcentage}%`,
                        backgroundColor: `var(--categorie-${cleCategorie(segment.categorie)}-texte)`,
                      }}
                    />
                  ))}
                </div>
                <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
                  {segments.map((segment) => (
                    <li key={segment.categorie} className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 shrink-0 rounded-full"
                        style={{
                          backgroundColor: `var(--categorie-${cleCategorie(segment.categorie)}-texte)`,
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[15px]">
                        {libelleCategorie(segment.categorie)}
                      </span>
                      <span className="text-[15px] font-bold tabular-nums">
                        {formatMontant(segment.montantCentimes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <h2 className="m-0 mt-5 text-[18px] font-extrabold tracking-[-0.01em]">Dépenses</h2>

          {depenses.length === 0 ? (
            <p className="m-0 mt-2 text-[15px] text-[var(--muted-foreground)]">
              Aucune dépense dans ce dossier.
            </p>
          ) : (
            <ul className="m-0 mt-2 flex list-none flex-col gap-2.5 p-0">
              {depenses.map((depense) => (
                <CarteDepense
                  key={depense.id}
                  depense={depense}
                  vers={`/depenses/${depense.id}`}
                  action={
                    enBrouillon
                      ? {
                          libelle: "Retirer",
                          ariaLabel: `Retirer « ${depense.libelle} » du dossier`,
                          surClic: () => void retirerDepense(depense.id),
                        }
                      : undefined
                  }
                />
              ))}
            </ul>
          )}

          {enBrouillon && (
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => setPanneauAjout(true)}
                className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                Ajouter des dépenses
              </button>
              <button
                type="button"
                onClick={() => setRenommage(true)}
                className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                Renommer
              </button>
              <button
                type="button"
                onClick={() => setConfirmationSuppression(true)}
                className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--erreur-texte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                Supprimer le dossier
              </button>
            </div>
          )}

          {enLectureSeule && (
            <section aria-label="Historique" className="mt-5">
              <h2 className="m-0 text-[18px] font-extrabold tracking-[-0.01em]">Historique</h2>

              {erreurHistorique !== null && (
                <p
                  role="alert"
                  className="m-0 mt-2 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
                >
                  {erreurHistorique}
                </p>
              )}

              {historique === null && erreurHistorique === null && (
                <p className="m-0 mt-2 text-[15px] text-[var(--muted-foreground)]">Chargement…</p>
              )}

              {historique !== null && (
                <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {historique.map((transition) => (
                    <li
                      key={transition.id}
                      className="rounded-[20px] bg-[var(--card)] p-[14px_16px] shadow-[var(--ombre-carte)]"
                    >
                      <p className="m-0 text-[13px] font-semibold text-[var(--muted-foreground)]">
                        {formatDateHeure(transition.created_at)} · {transition.acteur.display_name}
                      </p>
                      <p className="m-0 mt-1 text-[15px] font-semibold">
                        {libelleStatut(transition.ancien_statut)} →{" "}
                        {libelleStatut(transition.nouveau_statut)}
                      </p>
                      {transition.motif !== null && (
                        <p className="m-0 mt-1 text-[14px] text-[var(--muted-foreground)]">
                          {transition.motif}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {detail.statut === "refusee" && (
            <button
              type="button"
              onClick={() => void rouvrir()}
              disabled={actionEnCours}
              className="mt-5 h-[52px] w-full rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
            >
              Rouvrir le dossier
            </button>
          )}

          {enBrouillon && (
            <div className="sticky bottom-0 mt-5 bg-[var(--background)] pb-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmationEnvoi(true)}
                disabled={actionEnCours}
                className="h-[56px] w-full rounded-[20px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] shadow-[var(--ombre-bouton-flottant)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
              >
                Envoyer pour validation
              </button>
            </div>
          )}
        </>
      )}

      {panneauAjout && detail !== null && (
        <PanneauAjoutDepenses
          idNote={detail.id}
          onFerme={() => setPanneauAjout(false)}
          onAjout={() => {
            setPanneauAjout(false);
            note.reessayer();
          }}
          onSessionExpiree={onSessionExpiree}
        />
      )}

      {renommage && detail !== null && (
        <DialogueRenommage
          libelleActuel={detail.libelle}
          enCours={actionEnCours}
          onFerme={() => setRenommage(false)}
          onRenomme={(titre) => void renommer(titre)}
        />
      )}

      {confirmationSuppression && detail !== null && (
        <VoileConfirmation
          titre="Supprimer le dossier"
          message="Supprimer ce dossier ? Les dépenses seront conservées et redeviendront à classer."
          libelleConfirme="Supprimer"
          enCours={actionEnCours}
          onAnnule={() => setConfirmationSuppression(false)}
          onConfirme={() => void supprimer()}
        />
      )}

      {confirmationEnvoi && detail !== null && (
        <VoileConfirmation
          titre="Envoyer pour validation"
          message="Envoyer ce dossier pour validation ? Il ne sera plus modifiable."
          libelleConfirme="Envoyer"
          enCours={actionEnCours}
          onAnnule={() => setConfirmationEnvoi(false)}
          onConfirme={() => void envoyer()}
        />
      )}
    </main>
  );
}

type PropsRenommage = {
  libelleActuel: string;
  enCours: boolean;
  onFerme: () => void;
  onRenomme: (titre: string) => void;
};

function DialogueRenommage({ libelleActuel, enCours, onFerme, onRenomme }: PropsRenommage) {
  const refTitre = useRef<HTMLHeadingElement>(null);
  const [titre, setTitre] = useState(libelleActuel);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  function valider() {
    const elague = titre.trim();
    if (elague === "") {
      setErreur("Le libellé est requis.");
      return;
    }
    onRenomme(elague);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(26,26,46,0.45)] sm:items-center sm:justify-center sm:px-5"
      onClick={onFerme}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-renommage"
        className="w-full rounded-t-[26px] bg-[var(--card)] p-5 pb-8 shadow-[var(--ombre-carte)] sm:max-w-[420px] sm:rounded-[26px]"
        onClick={(evenement) => evenement.stopPropagation()}
      >
        <h2
          ref={refTitre}
          tabIndex={-1}
          id="titre-renommage"
          className="m-0 mb-4 text-[20px] font-extrabold tracking-[-0.01em] focus:outline-none"
        >
          Renommer
        </h2>
        <label
          htmlFor="champ-titre"
          className="mb-1 block text-[13px] font-bold text-[var(--foreground)]"
        >
          Titre
        </label>
        <input
          id="champ-titre"
          type="text"
          value={titre}
          onChange={(evenement) => setTitre(evenement.target.value)}
          className="h-[52px] w-full rounded-[18px] border-0 bg-[var(--secondary)] px-4 text-[15px] text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        />
        {erreur !== null && (
          <p
            role="alert"
            className="m-0 mt-2 rounded-[16px] bg-[var(--erreur-fond)] p-3 text-[13px] font-semibold text-[var(--erreur-texte)]"
          >
            {erreur}
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onFerme}
            disabled={enCours}
            className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={valider}
            disabled={enCours}
            aria-busy={enCours}
            className="h-[52px] rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
          >
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

type PropsConfirmation = {
  titre: string;
  message: string;
  libelleConfirme: string;
  enCours: boolean;
  onAnnule: () => void;
  onConfirme: () => void;
};

function VoileConfirmation({
  titre,
  message,
  libelleConfirme,
  enCours,
  onAnnule,
  onConfirme,
}: PropsConfirmation) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(26,26,46,0.45)] sm:items-center sm:justify-center sm:px-5"
      onClick={onAnnule}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-confirmation"
        className="w-full rounded-t-[26px] bg-[var(--card)] p-5 pb-8 shadow-[var(--ombre-carte)] sm:max-w-[420px] sm:rounded-[26px]"
        onClick={(evenement) => evenement.stopPropagation()}
      >
        <h2
          id="titre-confirmation"
          className="m-0 mb-3 text-[20px] font-extrabold tracking-[-0.01em]"
        >
          {titre}
        </h2>
        <p className="m-0 text-[15px]">{message}</p>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onAnnule}
            disabled={enCours}
            className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirme}
            disabled={enCours}
            aria-busy={enCours}
            className="h-[52px] rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
          >
            {enCours ? "En cours…" : libelleConfirme}
          </button>
        </div>
      </div>
    </div>
  );
}
