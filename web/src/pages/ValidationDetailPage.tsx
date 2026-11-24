import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Bed,
  Fuel,
  Receipt,
  ShoppingBag,
  SquareParking,
  Train,
  Utensils,
  type LucideIcon,
} from "lucide-react";

import {
  ApiError,
  apiPost,
  MESSAGE_GENERIQUE,
  type Categorie,
  type Depense,
  type StatutNote,
  type TransitionRead,
  type ValidationNoteDetail,
} from "../api/client";
import { VignetteJustificatif } from "../components/depense/VignetteJustificatif";
import { cleCategorie } from "../lib/categories";
import {
  formatDateCourte,
  formatDateHeure,
  formatMontant,
  formatNbDepenses,
  initiales,
} from "../lib/format";
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

const ICONES: Record<Categorie, LucideIcon> = {
  transport: Train,
  repas: Utensils,
  hebergement: Bed,
  carburant: Fuel,
  peage_parking: SquareParking,
  fournitures: ShoppingBag,
  autre: Receipt,
};

type Props = {
  onSessionExpiree: () => void;
};

/** Détail d'un dossier de la file de validation, et décision « Valider » / « Refuser ». */
export function ValidationDetailPage({ onSessionExpiree }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const refTitre = useRef<HTMLHeadingElement>(null);

  const note = useApiGet<ValidationNoteDetail>(`/v1/validation/notes/${id}`, onSessionExpiree);
  const historique = useApiGet<TransitionRead[]>(`/v1/notes/${id}/historique`, onSessionExpiree);
  const detail = note.donnees;

  const [messageAlerte, setMessageAlerte] = useState<string | null>(null);
  const [actionEnCours, setActionEnCours] = useState(false);
  const envoiEnCours = useRef(false);

  const [confirmationValidation, setConfirmationValidation] = useState(false);
  const [refusOuvert, setRefusOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [erreurMotif, setErreurMotif] = useState<string | null>(null);

  const idNote = detail?.id;

  useEffect(() => {
    refTitre.current?.focus();
  }, [idNote]);

  function ouvrirRefus() {
    setMotif("");
    setErreurMotif(null);
    setRefusOuvert(true);
  }

  async function valider() {
    if (detail === null || envoiEnCours.current) return;
    envoiEnCours.current = true;
    setActionEnCours(true);
    setMessageAlerte(null);
    try {
      await apiPost(`/v1/notes/${detail.id}/valider`);
      navigate("/validation", { state: { annonce: "Dossier validé." } });
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      setConfirmationValidation(false);
      setMessageAlerte(attrape instanceof ApiError ? attrape.message : MESSAGE_GENERIQUE);
      // 409 : le statut a déjà changé ailleurs, on resynchronise le détail et l'historique.
      if (attrape instanceof ApiError && attrape.status === 409) {
        note.reessayer();
        historique.reessayer();
      }
    } finally {
      envoiEnCours.current = false;
      setActionEnCours(false);
    }
  }

  async function refuser() {
    if (detail === null) return;
    const elague = motif.trim();
    if (elague === "") {
      setErreurMotif("Le motif est requis.");
      return;
    }
    if (envoiEnCours.current) return;
    envoiEnCours.current = true;
    setActionEnCours(true);
    setMessageAlerte(null);
    try {
      await apiPost(`/v1/notes/${detail.id}/refuser`, { motif: elague });
      navigate("/validation", { state: { annonce: "Dossier refusé." } });
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      // 422 : erreur sur le motif, on la montre au niveau du champ et on reste ouvert.
      if (attrape instanceof ApiError && attrape.status === 422) {
        setErreurMotif(attrape.message);
        return;
      }
      setRefusOuvert(false);
      setMessageAlerte(attrape instanceof ApiError ? attrape.message : MESSAGE_GENERIQUE);
      if (attrape instanceof ApiError && attrape.status === 409) {
        note.reessayer();
        historique.reessayer();
      }
    } finally {
      envoiEnCours.current = false;
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
            <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.01em]">
              Dossier introuvable
            </h1>
            <p
              role="alert"
              className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              Ce dossier n'existe pas ou vous n'y avez pas accès.
            </p>
            <Link
              to="/validation"
              className="inline-flex h-[52px] items-center justify-center rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              Retour à la validation
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
          <header className="mb-2 flex items-center justify-between gap-3">
            <Link
              to="/validation"
              aria-label="Retour à la validation"
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

          <p className="m-0 mt-2 flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[20px] bg-[var(--accent)] text-[13px] font-bold text-[var(--accent-foreground)]"
            >
              {initiales(detail.proprietaire.display_name)}
            </span>
            <span className="text-[13px] font-bold">{detail.proprietaire.display_name}</span>
          </p>

          <p className="m-0 mt-1 text-[13px] font-semibold text-[var(--muted-foreground)]">
            Envoyé le{" "}
            {detail.soumise_at === null ? "—" : formatDateHeure(detail.soumise_at)}
          </p>

          <div className="mt-4 rounded-[24px] bg-[var(--card)] p-[16px_18px] shadow-[var(--ombre-carte)]">
            <p className="m-0 text-[13px] font-bold text-[var(--muted-foreground)]">
              Total du dossier
            </p>
            <p className="m-0 mt-1 text-[34px] font-extrabold leading-tight tabular-nums">
              {formatMontant(detail.total_centimes)}
            </p>
          </div>

          {messageAlerte !== null && (
            <p
              role="alert"
              className="m-0 mt-4 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {messageAlerte}
            </p>
          )}

          <section aria-label="Dépenses" className="mt-6">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="m-0 text-[18px] font-extrabold tracking-[-0.01em]">Dépenses</h2>
              <span className="text-[13px] font-semibold text-[var(--muted-foreground)]">
                {formatNbDepenses(detail.nb_depenses)}
              </span>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {detail.depenses.map((depense) => (
                <CarteDepenseValidation
                  key={depense.id}
                  depense={depense}
                  onSessionExpiree={onSessionExpiree}
                />
              ))}
            </ul>
          </section>

          <section aria-label="Historique" className="mt-6">
            <h2 className="m-0 text-[18px] font-extrabold tracking-[-0.01em]">Historique</h2>

            {historique.chargement && (
              <p className="m-0 mt-2 text-[15px] text-[var(--muted-foreground)]">Chargement…</p>
            )}

            {!historique.chargement && historique.erreur !== null && (
              <div
                role="alert"
                className="m-0 mt-2 flex items-center justify-between gap-3 rounded-[16px] bg-[var(--erreur-fond)] p-3 text-[13px] font-semibold text-[var(--erreur-texte)]"
              >
                <span className="min-w-0 break-words">{historique.erreur}</span>
                <button
                  type="button"
                  onClick={historique.reessayer}
                  className="h-11 shrink-0 rounded-[16px] bg-[var(--card)] px-4 text-[13px] font-bold text-[var(--erreur-texte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                >
                  Réessayer
                </button>
              </div>
            )}

            {!historique.chargement && historique.erreur === null && historique.donnees !== null && (
              <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                {historique.donnees.map((transition) => (
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
                      <p className="m-0 mt-2 rounded-[12px] bg-[var(--secondary)] p-3 text-[14px] text-[var(--muted-foreground)]">
                        {transition.motif}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {detail.statut === "soumise" && (
            <div className="sticky bottom-0 mt-6 flex gap-3 bg-[var(--background)] pb-2 pt-2">
              <button
                type="button"
                onClick={ouvrirRefus}
                disabled={actionEnCours}
                className="h-[56px] flex-1 rounded-[20px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
              >
                Refuser
              </button>
              <button
                type="button"
                onClick={() => setConfirmationValidation(true)}
                disabled={actionEnCours}
                className="h-[56px] flex-1 rounded-[20px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] shadow-[var(--ombre-bouton-flottant)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
              >
                Valider
              </button>
            </div>
          )}
        </>
      )}

      {confirmationValidation && detail !== null && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(26,26,46,0.45)] sm:items-center sm:justify-center sm:px-5"
          onClick={() => setConfirmationValidation(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titre-confirmation-validation"
            className="w-full rounded-t-[26px] bg-[var(--card)] p-5 pb-8 shadow-[var(--ombre-carte)] sm:max-w-[420px] sm:rounded-[26px]"
            onClick={(evenement) => evenement.stopPropagation()}
          >
            <h2
              id="titre-confirmation-validation"
              className="m-0 mb-3 text-[20px] font-extrabold tracking-[-0.01em]"
            >
              Valider ce dossier ?
            </h2>
            <p className="m-0 text-[15px]">Le dossier sera marqué comme validé.</p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmationValidation(false)}
                disabled={actionEnCours}
                className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void valider()}
                disabled={actionEnCours}
                aria-busy={actionEnCours}
                className="h-[52px] rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
              >
                {actionEnCours ? "En cours…" : "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {refusOuvert && detail !== null && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(26,26,46,0.45)] sm:items-center sm:justify-center sm:px-5"
          onClick={() => setRefusOuvert(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titre-refus"
            className="w-full rounded-t-[26px] bg-[var(--card)] p-5 pb-8 shadow-[var(--ombre-carte)] sm:max-w-[420px] sm:rounded-[26px]"
            onClick={(evenement) => evenement.stopPropagation()}
          >
            <h2
              id="titre-refus"
              className="m-0 mb-3 text-[20px] font-extrabold tracking-[-0.01em]"
            >
              Refuser le dossier
            </h2>
            <label
              htmlFor="champ-motif"
              className="mb-1 block text-[13px] font-bold text-[var(--foreground)]"
            >
              Motif du refus
            </label>
            <textarea
              id="champ-motif"
              value={motif}
              onChange={(evenement) => setMotif(evenement.target.value)}
              maxLength={1000}
              rows={4}
              autoFocus
              aria-invalid={erreurMotif !== null}
              aria-describedby={erreurMotif !== null ? "erreur-motif" : undefined}
              className="w-full resize-none rounded-[18px] border-0 bg-[var(--secondary)] p-4 text-[15px] text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            />
            <p className="m-0 mt-1 text-right text-[13px] font-semibold text-[var(--muted-foreground)]">
              {motif.length} / 1000
            </p>
            {erreurMotif !== null && (
              <p
                id="erreur-motif"
                role="alert"
                className="m-0 mt-2 rounded-[16px] bg-[var(--erreur-fond)] p-3 text-[13px] font-semibold text-[var(--erreur-texte)]"
              >
                {erreurMotif}
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setRefusOuvert(false)}
                disabled={actionEnCours}
                className="h-[52px] rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void refuser()}
                disabled={actionEnCours || motif.trim() === ""}
                aria-busy={actionEnCours}
                className="h-[52px] rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
              >
                {actionEnCours ? "En cours…" : "Confirmer le refus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function CarteDepenseValidation({
  depense,
  onSessionExpiree,
}: {
  depense: Depense;
  onSessionExpiree: () => void;
}) {
  const Icone = ICONES[depense.categorie];
  const cle = cleCategorie(depense.categorie);

  return (
    <li className="m-0 list-none p-0">
      <div className="rounded-[22px] bg-[var(--card)] p-3 shadow-[var(--ombre-carte)]">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px]"
            style={{
              backgroundColor: `var(--categorie-${cle}-fond)`,
              color: `var(--categorie-${cle}-texte)`,
            }}
          >
            <Icone strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 font-semibold break-words">{depense.libelle}</p>
            <p className="m-0 text-[13px] text-[var(--muted-foreground)]">
              {formatDateCourte(depense.date_depense)}
            </p>
          </div>
          <p className="m-0 shrink-0 font-extrabold tabular-nums">
            {formatMontant(depense.montant_centimes)}
          </p>
        </div>
        <div className="mt-3">
          <VignetteJustificatif
            idDepense={depense.id}
            libelle={depense.libelle}
            onSessionExpiree={onSessionExpiree}
          />
        </div>
      </div>
    </li>
  );
}
