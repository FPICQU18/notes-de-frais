import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check } from "lucide-react";
import { useLocation } from "react-router";

import {
  ApiError,
  apiGet,
  type NoteValidation,
  type StatutValidation,
  type UserRead,
} from "../api/client";
import { CarteValidation } from "../components/validation/CarteValidation";
import { PanneauDetailValidation } from "../components/validation/PanneauDetailValidation";
import { useBureau } from "../lib/useMediaQuery";

const STATUTS: StatutValidation[] = ["soumise", "validee", "refusee", "remboursee"];

const LIBELLES_ONGLET: Record<StatutValidation, string> = {
  soumise: "À traiter",
  validee: "Validés",
  refusee: "Refusés",
  remboursee: "Remboursés",
};

const LIBELLES_VIDE: Record<StatutValidation, string> = {
  soumise: "Aucun dossier à traiter.",
  validee: "Aucun dossier validé.",
  refusee: "Aucun dossier refusé.",
  remboursee: "Aucun dossier remboursé.",
};

interface EtatOnglet {
  donnees: NoteValidation[] | null;
  chargement: boolean;
  erreur: string | null;
}

const ETAT_INITIAL: EtatOnglet = { donnees: null, chargement: false, erreur: null };

type Props = {
  utilisateur: UserRead;
  onSessionExpiree: () => void;
};

/** File de validation à quatre onglets ; en ≥ 1024 px, maître-détail avec panneau à droite (US-043). */
export function ValidationPage({ utilisateur, onSessionExpiree }: Props) {
  const refTitre = useRef<HTMLHeadingElement>(null);
  const refsOnglets = useRef<(HTMLButtonElement | null)[]>([]);
  const dejaDemandes = useRef<Set<StatutValidation>>(new Set());

  const location = useLocation();
  const annonceNavigation = (location.state as { annonce?: string } | null)?.annonce ?? null;

  // Mode bureau (≥ 1024 px, US-042/US-043) : maître-détail, sélection en état local.
  const bureau = useBureau();

  // Reflets mis à jour dans un effet pour les callbacks de chargement
  // (évite un setState dans un effet).
  const bureauRef = useRef(bureau);
  const utilisateurRef = useRef(utilisateur);
  useEffect(() => {
    bureauRef.current = bureau;
    utilisateurRef.current = utilisateur;
  }, [bureau, utilisateur]);

  const [ongletActif, setOngletActif] = useState<StatutValidation>("soumise");
  const [etats, setEtats] = useState<Record<StatutValidation, EtatOnglet>>({
    // « À traiter » est chargé au montage : on démarre déjà en chargement.
    soumise: { donnees: null, chargement: true, erreur: null },
    validee: ETAT_INITIAL,
    refusee: ETAT_INITIAL,
    remboursee: ETAT_INITIAL,
  });

  // Sélection du panneau détail en mode bureau (id du dossier, `null` = état vide).
  const [idSelectionne, setIdSelectionne] = useState<number | null>(null);
  // Annonce d'une décision prise dans le panneau (« Dossier validé. » / « Dossier refusé. »).
  const [annonceDecision, setAnnonceDecision] = useState<string | null>(null);

  const donneesSoumises = etats.soumise.donnees;
  // Dans « À traiter », on masque ses propres dossiers (le serveur continue de les renvoyer).
  const fileATraiter = (donneesSoumises ?? []).filter(
    (note) => note.proprietaire.id !== utilisateur.id,
  );

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  const charger = useCallback(
    (statut: StatutValidation, apres?: (donnees: NoteValidation[]) => void) => {
      dejaDemandes.current.add(statut);
      apiGet<NoteValidation[]>(`/v1/validation/notes?statut=${statut}`)
        .then((donnees) => {
          setEtats((precedent) => ({
            ...precedent,
            [statut]: { donnees, chargement: false, erreur: null },
          }));
          apres?.(donnees);
        })
        .catch((attrape: unknown) => {
          if (attrape instanceof ApiError && attrape.status === 401) {
            onSessionExpiree();
            return;
          }
          setEtats((precedent) => ({
            ...precedent,
            [statut]: {
              // Une erreur ne fait pas disparaître des cartes déjà affichées.
              donnees: precedent[statut].donnees,
              chargement: false,
              erreur:
                attrape instanceof ApiError ? attrape.message : "Une erreur est survenue.",
            },
          }));
        });
    },
    [onSessionExpiree],
  );

  // Charge le premier onglet (« À traiter ») au montage — et uniquement lui.
  // En mode bureau, le premier dossier de la file devient la sélection initiale.
  useEffect(() => {
    charger("soumise", (donnees) => {
      if (!bureauRef.current) return;
      const file = donnees.filter((note) => note.proprietaire.id !== utilisateurRef.current.id);
      if (file.length > 0) setIdSelectionne(file[0].id);
    });
  }, [charger]);

  // Après une décision dans le panneau bureau : on recharge la file « À traiter »,
  // on resélectionne le premier dossier restant (ou l'état vide s'il n'y en a plus).
  const apresDecision = useCallback(
    (annonce: string) => {
      setAnnonceDecision(annonce);
      charger("soumise", (donnees) => {
        const file = donnees.filter((note) => note.proprietaire.id !== utilisateur.id);
        setIdSelectionne(file.length > 0 ? file[0].id : null);
      });
    },
    [charger, utilisateur.id],
  );

  function marquerChargement(statut: StatutValidation) {
    setEtats((precedent) => ({
      ...precedent,
      [statut]: { ...precedent[statut], chargement: true, erreur: null },
    }));
  }

  function activer(statut: StatutValidation) {
    setOngletActif(statut);
    if (!dejaDemandes.current.has(statut)) {
      marquerChargement(statut);
      charger(statut);
    }
  }

  function reessayer() {
    marquerChargement(ongletActif);
    charger(ongletActif);
  }

  function gererTouches(event: KeyboardEvent<HTMLDivElement>) {
    const index = STATUTS.indexOf(ongletActif);
    let suivant: number | null = null;
    if (event.key === "ArrowRight") {
      suivant = (index + 1) % STATUTS.length;
    } else if (event.key === "ArrowLeft") {
      suivant = (index - 1 + STATUTS.length) % STATUTS.length;
    } else if (event.key === "Home") {
      suivant = 0;
    } else if (event.key === "End") {
      suivant = STATUTS.length - 1;
    }
    if (suivant !== null) {
      event.preventDefault();
      const statut = STATUTS[suivant];
      activer(statut);
      refsOnglets.current[suivant]?.focus();
    }
  }

  const annonce = annonceNavigation ?? annonceDecision;

  const file = (
    <>
      <div
        role="tablist"
        aria-label="Filtrer les dossiers par statut"
        onKeyDown={gererTouches}
        className="mb-5 flex gap-1.5 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {STATUTS.map((statut, index) => {
          const estActif = statut === ongletActif;
          return (
            <button
              key={statut}
              ref={(element) => {
                refsOnglets.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`validation-onglet-${statut}`}
              aria-selected={estActif}
              aria-controls={`validation-panel-${statut}`}
              tabIndex={estActif ? 0 : -1}
              onClick={() => activer(statut)}
              className={
                estActif
                  ? "h-11 shrink-0 whitespace-nowrap rounded-full bg-[var(--primary)] px-3 text-[13px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                  : "h-11 shrink-0 whitespace-nowrap rounded-full bg-[var(--card)] px-3 text-[13px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              }
            >
              {LIBELLES_ONGLET[statut]}
            </button>
          );
        })}
      </div>

      {STATUTS.map((statut) => {
        const etat = etats[statut];
        const estActif = statut === ongletActif;
        const donnees = etat.donnees ?? [];
        const donneesAffichees =
          statut === "soumise"
            ? donnees.filter((note) => note.proprietaire.id !== utilisateur.id)
            : donnees;

        return (
          <section
            key={statut}
            role="tabpanel"
            id={`validation-panel-${statut}`}
            aria-labelledby={`validation-onglet-${statut}`}
            aria-busy={etat.chargement || undefined}
            hidden={!estActif}
          >
            {etat.chargement && <p className="chargement">Chargement…</p>}

            {!etat.chargement && etat.erreur !== null && (
              <div className="flex flex-col gap-3">
                <p
                  role="alert"
                  className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-4 text-[13px] font-semibold text-[var(--erreur-texte)]"
                >
                  {etat.erreur}
                </p>
                <button
                  type="button"
                  onClick={reessayer}
                  className="h-12 w-full rounded-[18px] bg-[var(--primary)] text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                >
                  Réessayer
                </button>
              </div>
            )}

            {!etat.chargement && etat.erreur === null && donneesAffichees.length === 0 && (
              <div className="mt-16 flex flex-col items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)]"
                >
                  <Check strokeWidth={2} className="h-7 w-7" />
                </span>
                <p className="m-0 text-center text-[15px] font-bold">
                  {LIBELLES_VIDE[statut]}
                </p>
                {statut === "soumise" && (
                  <p className="m-0 text-center text-[14px] text-[var(--muted-foreground)]">
                    Les dossiers que vos collègues envoient en validation apparaîtront ici.
                  </p>
                )}
              </div>
            )}

            {donneesAffichees.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
                {donneesAffichees.map((note) => (
                  <CarteValidation
                    key={note.id}
                    note={note}
                    estAdmin={utilisateur.role === "admin"}
                    selectionnable={bureau}
                    selectionnee={bureau && note.id === idSelectionne}
                    onSelectionner={bureau ? (id) => setIdSelectionne(id) : undefined}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );

  // Panneau détail du maître-détail bureau (US-043) : dossier sélectionné, ou état
  // vide prévu par la maquette quand la file « À traiter » ne contient plus rien.
  const panneau = (
    <div className="min-w-0">
      {idSelectionne === null ? (
        <div className="mt-16 flex flex-col items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)]"
          >
            <Check strokeWidth={2} className="h-7 w-7" />
          </span>
          <p className="m-0 text-center text-[15px] font-bold">Aucun dossier sélectionné.</p>
          <p className="m-0 text-center text-[14px] text-[var(--muted-foreground)]">
            Sélectionnez un dossier dans la file.
          </p>
        </div>
      ) : (
        <PanneauDetailValidation
          key={idSelectionne}
          idNote={idSelectionne}
          utilisateur={utilisateur}
          onSessionExpiree={onSessionExpiree}
          variante="panneau"
          onApresDecision={apresDecision}
        />
      )}
    </div>
  );

  return (
    <main
      className={
        bureau
          ? "mx-auto w-full px-5 pb-10 pt-6"
          : "mx-auto w-full max-w-[560px] px-5 pb-28 pt-6"
      }
    >
      <header className="mb-5">
        <h1
          ref={refTitre}
          tabIndex={-1}
          className="m-0 text-2xl font-extrabold tracking-[-0.01em] focus:outline-none"
        >
          Validation
        </h1>
        {bureau && fileATraiter.length > 0 && (
          <p className="m-0 mt-1 text-[15px] font-semibold text-[var(--muted-foreground)]">
            {fileATraiter.length} dossier{fileATraiter.length > 1 ? "s" : ""} en attente
          </p>
        )}
      </header>

      {annonce !== null && (
        <p
          role="status"
          className="m-0 mb-4 rounded-[16px] bg-[var(--accent)] p-4 text-[13px] font-semibold text-[var(--accent-foreground)]"
        >
          {annonce}
        </p>
      )}

      {bureau ? (
        // Maître-détail (maquette bureau-validation.html) : file ~400 px à gauche,
        // panneau détail dans le reste des 1100 px de contenu.
        <div className="grid grid-cols-[400px_minmax(0,1fr)] items-start gap-10">
          <div className="min-w-0">{file}</div>
          {panneau}
        </div>
      ) : (
        file
      )}
    </main>
  );
}
