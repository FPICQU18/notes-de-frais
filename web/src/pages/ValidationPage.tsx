import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check } from "lucide-react";

import {
  ApiError,
  apiGet,
  type NoteValidation,
  type StatutValidation,
  type UserRead,
} from "../api/client";
import { CarteValidation } from "../components/validation/CarteValidation";

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

/** File de validation à quatre onglets : les dossiers par statut, dans l'ordre du serveur. */
export function ValidationPage({ utilisateur, onSessionExpiree }: Props) {
  const refTitre = useRef<HTMLHeadingElement>(null);
  const refsOnglets = useRef<(HTMLButtonElement | null)[]>([]);
  const dejaDemandes = useRef<Set<StatutValidation>>(new Set());

  const [ongletActif, setOngletActif] = useState<StatutValidation>("soumise");
  const [etats, setEtats] = useState<Record<StatutValidation, EtatOnglet>>({
    // « À traiter » est chargé au montage : on démarre déjà en chargement.
    soumise: { donnees: null, chargement: true, erreur: null },
    validee: ETAT_INITIAL,
    refusee: ETAT_INITIAL,
    remboursee: ETAT_INITIAL,
  });

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  const charger = useCallback(
    (statut: StatutValidation) => {
      dejaDemandes.current.add(statut);
      apiGet<NoteValidation[]>(`/v1/validation/notes?statut=${statut}`)
        .then((donnees) => {
          setEtats((precedent) => ({
            ...precedent,
            [statut]: { donnees, chargement: false, erreur: null },
          }));
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
  useEffect(() => {
    charger("soumise");
  }, [charger]);

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

  return (
    <main className="mx-auto w-full max-w-[560px] px-5 pb-28 pt-6">
      <header className="mb-5">
        <h1
          ref={refTitre}
          tabIndex={-1}
          className="m-0 text-2xl font-extrabold tracking-[-0.01em] focus:outline-none"
        >
          Validation
        </h1>
      </header>

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
        // Dans « À traiter », on masque ses propres dossiers (le serveur continue de les renvoyer).
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
                  <CarteValidation key={note.id} note={note} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </main>
  );
}
