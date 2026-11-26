import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, Lock, Trash2 } from "lucide-react";

import {
  ApiError,
  apiDelete,
  apiPatch,
  apiPost,
  apiUploadJustificatif,
  erreursDeDetail,
  type Categorie,
} from "../../api/client";
import { CATEGORIES } from "../../lib/categories";
import { dateIsoParis } from "../../lib/format";
import { formaterMontantSaisie, lireMontantCentimes } from "../../lib/montant";
import { BlocJustificatif } from "./BlocJustificatif";

type Champ = "montant" | "date" | "categorie" | "libelle";

type Erreurs = Record<Champ, string | null>;

type Corps = {
  libelle: string;
  date_depense: string;
  montant_centimes: number;
  categorie: Categorie;
};

export interface ValeurDepense {
  libelle: string;
  date_depense: string;
  montant_centimes: number;
  categorie: Categorie;
}

type Props = {
  mode: "creation" | "modification";
  idDepense?: number;
  valeurInitiale?: ValeurDepense;
  lectureSeule?: boolean;
  /** Vrai pendant que le statut du dossier est encore inconnu : champs figés sans message. */
  chargementStatut?: boolean;
  /** Source de temps pour la date du jour ; par défaut `new Date()`. */
  maintenant?: Date;
  onSessionExpiree: () => void;
  onSucces: (annonce: string | null) => void;
  /** 409 : le dossier n'est plus modifiable ; la page recharge en lecture seule. */
  onConflit?: (message: string) => void;
  /** Message du serveur à afficher après un conflit 409 (survit au rechargement). */
  messageConflit?: string | null;
  /** 404 : la dépense n'existe plus ; la page bascule sur l'écran dédié. */
  onIntrouvable?: () => void;
  /** Meilleur effort : déclenche le sélecteur de photo au montage (?scan=1). */
  declencherAuMontage?: boolean;
};

const CHAMP_VERS_CLE: Record<string, Champ> = {
  montant_centimes: "montant",
  date_depense: "date",
  categorie: "categorie",
  libelle: "libelle",
};

const ORDRE_CHAMPS: Champ[] = ["montant", "date", "categorie", "libelle"];

/** En-tête commun (bouton retour + titre focalisé) des écrans de dépense. */
export function EnTeteDepense({ titre }: { titre: string }) {
  const navigate = useNavigate();
  const refTitre = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  return (
    <header className="flex h-16 items-center gap-2 px-3">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Retour"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border-0 bg-[var(--secondary)] text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        <ChevronLeft aria-hidden strokeWidth={2} className="h-[22px] w-[22px]" />
      </button>
      <h1
        ref={refTitre}
        tabIndex={-1}
        className="flex-1 text-center text-[17px] font-extrabold leading-tight focus:outline-none"
      >
        {titre}
      </h1>
      <span className="w-11" aria-hidden="true" />
    </header>
  );
}

export function FormulaireDepense({
  mode,
  idDepense,
  valeurInitiale,
  lectureSeule = false,
  chargementStatut = false,
  maintenant,
  onSessionExpiree,
  onSucces,
  onConflit,
  onIntrouvable,
  messageConflit = null,
  declencherAuMontage = false,
}: Props) {
  const aujourdhuiIso = dateIsoParis(maintenant ?? new Date());
  const titre = mode === "creation" ? "Nouvelle dépense" : "Modifier la dépense";

  const [montant, setMontant] = useState(
    valeurInitiale ? formaterMontantSaisie(valeurInitiale.montant_centimes) : "",
  );
  const [dateDepense, setDateDepense] = useState(
    valeurInitiale?.date_depense ?? aujourdhuiIso,
  );
  const [categorie, setCategorie] = useState<Categorie | null>(
    valeurInitiale?.categorie ?? null,
  );
  const [libelle, setLibelle] = useState(valeurInitiale?.libelle ?? "");

  const [erreurs, setErreurs] = useState<Erreurs>({
    montant: null,
    date: null,
    categorie: null,
    libelle: null,
  });
  const [erreurHorsChamp, setErreurHorsChamp] = useState<string | null>(null);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const [confirmationOuverte, setConfirmationOuverte] = useState(false);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);

  const [fichier, setFichier] = useState<File | null>(null);
  const [idDepenseCree, setIdDepenseCree] = useState<number | null>(null);
  const [erreurJustificatif, setErreurJustificatif] = useState<string | null>(null);

  const refMontant = useRef<HTMLInputElement>(null);
  const refDate = useRef<HTMLInputElement>(null);
  const refPremiereTuile = useRef<HTMLButtonElement>(null);
  const refLibelle = useRef<HTMLInputElement>(null);
  const refSupprimer = useRef<HTMLButtonElement>(null);
  const refAnnuler = useRef<HTMLButtonElement>(null);
  const refEtaitOuverte = useRef(false);

  const desactive = lectureSeule || chargementStatut;

  useEffect(() => {
    if (confirmationOuverte) {
      refAnnuler.current?.focus();
      refEtaitOuverte.current = true;
    } else if (refEtaitOuverte.current) {
      refSupprimer.current?.focus();
      refEtaitOuverte.current = false;
    }
  }, [confirmationOuverte]);

  function focusChamp(champ: Champ) {
    (champ === "montant"
      ? refMontant
      : champ === "date"
        ? refDate
        : champ === "categorie"
          ? refPremiereTuile
          : refLibelle
    ).current?.focus();
  }

  function messageMontant(): string | null {
    const erreur = lireMontantCentimes(montant).erreur;
    if (erreur === "vide" || erreur === "invalide") {
      return "Saisissez un montant supérieur à 0\u00A0€.";
    }
    if (erreur === "decimales") {
      return "Saisissez un montant avec deux décimales au maximum.";
    }
    if (erreur === "tropGrand") {
      return "Le montant ne peut pas dépasser 100 000\u00A0€.";
    }
    return null;
  }

  function valider(): boolean {
    const nouvelles: Erreurs = {
      montant: messageMontant(),
      date: null,
      categorie: null,
      libelle: null,
    };
    if (dateDepense.trim() === "") {
      nouvelles.date = "Choisissez une date.";
    } else if (dateDepense > aujourdhuiIso) {
      nouvelles.date = "La date ne peut pas être dans le futur.";
    }
    if (categorie === null) {
      nouvelles.categorie = "Choisissez une catégorie.";
    }
    const libelleTrim = libelle.trim();
    if (libelleTrim === "") {
      nouvelles.libelle = "Le libellé est requis.";
    } else if (libelleTrim.length > 200) {
      nouvelles.libelle = "Le libellé est trop long (200 caractères maximum).";
    }
    setErreurs(nouvelles);
    const premier = ORDRE_CHAMPS.find((champ) => nouvelles[champ] !== null);
    if (premier !== undefined) {
      focusChamp(premier);
      return false;
    }
    return true;
  }

  function corpsSoumission(): Corps {
    return {
      libelle: libelle.trim(),
      date_depense: dateDepense,
      montant_centimes: lireMontantCentimes(montant).centimes as number,
      categorie: categorie as Categorie,
    };
  }

  function diffModification(corps: Corps): Record<string, unknown> {
    const diff: Record<string, unknown> = {};
    if (valeurInitiale === undefined) return corps;
    if (corps.libelle !== valeurInitiale.libelle) diff.libelle = corps.libelle;
    if (corps.date_depense !== valeurInitiale.date_depense) {
      diff.date_depense = corps.date_depense;
    }
    if (corps.montant_centimes !== valeurInitiale.montant_centimes) {
      diff.montant_centimes = corps.montant_centimes;
    }
    if (corps.categorie !== valeurInitiale.categorie) diff.categorie = corps.categorie;
    return diff;
  }

  function appliquerErreursServeur(detail: unknown) {
    const entrees = erreursDeDetail(detail);
    const nouvelles: Erreurs = {
      montant: null,
      date: null,
      categorie: null,
      libelle: null,
    };
    let horsChamp: string | null = null;
    for (const entree of entrees) {
      const cle = entree.champ !== null ? CHAMP_VERS_CLE[entree.champ] : undefined;
      if (cle !== undefined) {
        nouvelles[cle] = entree.message;
      } else {
        horsChamp = entree.message;
      }
    }
    setErreurs(nouvelles);
    setErreurHorsChamp(horsChamp);
    const premier = ORDRE_CHAMPS.find((champ) => nouvelles[champ] !== null);
    if (premier !== undefined) focusChamp(premier);
  }

  type ResultatJustificatif = "succes" | "reessayable" | "quitte";

  async function tenterJustificatif(id: number): Promise<ResultatJustificatif> {
    if (fichier === null) return "succes";
    setErreurJustificatif(null);
    try {
      await apiUploadJustificatif(id, fichier);
      return "succes";
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return "quitte";
      }
      if (attrape instanceof ApiError && attrape.status === 404) {
        onIntrouvable?.();
        return "quitte";
      }
      if (attrape instanceof ApiError && attrape.status === 409) {
        if (onConflit !== undefined) {
          onConflit(attrape.message);
          return "quitte";
        }
        setErreurJustificatif(attrape.message);
        return "reessayable";
      }
      setErreurJustificatif(
        attrape instanceof ApiError ? attrape.message : "Une erreur est survenue.",
      );
      return "reessayable";
    }
  }

  async function retenterJustificatif() {
    if (envoiEnCours) return;
    const id = idDepenseCree ?? idDepense;
    if (id === undefined || id === null) return;
    setEnvoiEnCours(true);
    const resultat = await tenterJustificatif(id);
    if (resultat === "quitte") return;
    if (resultat === "reessayable") {
      setEnvoiEnCours(false);
      return;
    }
    onSucces(mode === "creation" ? "Dépense enregistrée." : "Dépense modifiée.");
  }

  async function envoyer() {
    if (envoiEnCours || desactive) return;
    if (!valider()) return;
    const corps = corpsSoumission();
    setEnvoiEnCours(true);
    setErreurEnvoi(null);
    setErreurHorsChamp(null);
    setErreurJustificatif(null);
    try {
      if (mode === "creation") {
        // POST déjà réussi lors d'une tentative précédente : on ne recrée pas
        // la dépense, on ne rejoue que l'envoi du justificatif.
        if (idDepenseCree !== null) {
          const resultat = await tenterJustificatif(idDepenseCree);
          if (resultat === "quitte") return;
          if (resultat === "reessayable") {
            setEnvoiEnCours(false);
            return;
          }
          onSucces("Dépense enregistrée.");
          return;
        }
        const depense = await apiPost<{ id: number }>("/v1/depenses", corps);
        setIdDepenseCree(depense.id);
        const resultat = await tenterJustificatif(depense.id);
        if (resultat === "quitte") return;
        if (resultat === "reessayable") {
          setEnvoiEnCours(false);
          return;
        }
        onSucces("Dépense enregistrée.");
        return;
      }
      const diff = diffModification(corps);
      const aDiff = Object.keys(diff).length > 0;
      if (aDiff) {
        await apiPatch(`/v1/depenses/${idDepense}`, diff);
      }
      const resultat = await tenterJustificatif(idDepense as number);
      if (resultat === "quitte") return;
      if (resultat === "reessayable") {
        setEnvoiEnCours(false);
        return;
      }
      if (!aDiff && fichier === null) {
        onSucces(null);
        return;
      }
      onSucces("Dépense modifiée.");
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      if (attrape instanceof ApiError && attrape.status === 422) {
        appliquerErreursServeur(attrape.detail);
        setEnvoiEnCours(false);
        return;
      }
      if (attrape instanceof ApiError && attrape.status === 409) {
        if (onConflit !== undefined) {
          onConflit(attrape.message);
        } else {
          setErreurHorsChamp(attrape.message);
          setEnvoiEnCours(false);
        }
        return;
      }
      if (attrape instanceof ApiError && attrape.status === 404 && mode === "modification") {
        onIntrouvable?.();
        return;
      }
      setErreurEnvoi(attrape instanceof ApiError ? attrape.message : "Une erreur est survenue.");
      setEnvoiEnCours(false);
    }
  }

  function gererSoumission(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    void envoyer();
  }

  function ouvrirConfirmation() {
    setErreurSuppression(null);
    setConfirmationOuverte(true);
  }

  function annulerSuppression() {
    setConfirmationOuverte(false);
    setErreurSuppression(null);
  }

  function gererToucheConfirmation(evenement: KeyboardEvent<HTMLDivElement>) {
    if (evenement.key === "Escape") {
      evenement.preventDefault();
      annulerSuppression();
    }
  }

  async function supprimer() {
    if (suppressionEnCours) return;
    setSuppressionEnCours(true);
    setErreurSuppression(null);
    try {
      await apiDelete(`/v1/depenses/${idDepense}`);
      onSucces("Dépense supprimée.");
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      if (attrape instanceof ApiError && attrape.status === 404) {
        onIntrouvable?.();
        return;
      }
      if (attrape instanceof ApiError && attrape.status === 409) {
        if (onConflit !== undefined) {
          onConflit(attrape.message);
        } else {
          setConfirmationOuverte(false);
          setErreurSuppression(attrape.message);
        }
        return;
      }
      setErreurSuppression(
        attrape instanceof ApiError ? attrape.message : "Une erreur est survenue.",
      );
      setSuppressionEnCours(false);
    }
  }

  return (
    <div className="formulaire-depense min-h-[100svh] bg-[var(--card)]">
      <EnTeteDepense titre={titre} />

      {lectureSeule && !chargementStatut && (
        <div
          role="status"
          className="mx-5 mt-4 flex items-start gap-3 rounded-[18px] bg-[var(--accent)] px-4 py-3 text-[13px] font-semibold leading-snug text-[var(--accent-foreground)]"
        >
          <Lock aria-hidden strokeWidth={2} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Cette dépense appartient à un dossier qui n'est plus modifiable.</span>
        </div>
      )}

      {messageConflit !== null && messageConflit !== undefined && (
        <div
          role="alert"
          className="mx-5 mt-4 flex items-start gap-3 rounded-[16px] bg-[var(--erreur-fond)] px-4 py-3 text-[13px] font-semibold leading-snug text-[var(--erreur-texte)]"
        >
          <span>{messageConflit}</span>
        </div>
      )}

      <form
        id="formulaire-depense"
        onSubmit={gererSoumission}
        noValidate
        aria-busy={chargementStatut || undefined}
        className="flex flex-col gap-[18px] px-5 pt-1 pb-[56px]"
      >
        {erreurHorsChamp !== null && (
          <p
            role="alert"
            className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-3 text-[13px] font-semibold text-[var(--erreur-texte)]"
          >
            {erreurHorsChamp}
          </p>
        )}

        <div className="flex flex-col items-center gap-2.5 pt-2 pb-1">
          <label
            htmlFor="montant"
            className="text-[13px] font-semibold text-[var(--muted-foreground)]"
          >
            Montant
          </label>
          <div className="flex w-full items-center justify-center gap-2">
            <input
              ref={refMontant}
              id="montant"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={montant}
              onChange={(evenement) => setMontant(evenement.target.value)}
              disabled={desactive}
              aria-invalid={erreurs.montant !== null}
              aria-describedby={erreurs.montant !== null ? "montant-erreur" : undefined}
              className={`min-w-0 flex-1 rounded-[16px] border-0 bg-transparent py-1 text-center text-[44px] font-extrabold leading-[1.15] tracking-[-0.03em] tabular-nums text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)] ${
                erreurs.montant !== null ? "outline-2 outline-[var(--erreur-texte)]" : ""
              }`}
            />
            <span aria-hidden="true" className="shrink-0 text-[28px] font-extrabold text-[var(--muted-foreground)]">
              €
            </span>
          </div>
          {erreurs.montant !== null && (
            <p
              id="montant-erreur"
              className="m-0 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {erreurs.montant}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="date"
            className="text-[13px] font-bold text-[var(--muted-foreground)]"
          >
            Date
          </label>
          <input
            ref={refDate}
            id="date"
            type="date"
            max={aujourdhuiIso}
            value={dateDepense}
            onChange={(evenement) => setDateDepense(evenement.target.value)}
            disabled={desactive}
            aria-invalid={erreurs.date !== null}
            aria-describedby={erreurs.date !== null ? "date-erreur" : undefined}
            className="h-[52px] min-w-0 w-full appearance-none rounded-[18px] border-0 bg-[var(--secondary)] px-4 text-[15px] font-semibold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)]"
          />
          {erreurs.date !== null && (
            <p
              id="date-erreur"
              className="m-0 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {erreurs.date}
            </p>
          )}
        </div>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2.5 p-0 text-[13px] font-bold text-[var(--muted-foreground)]">
            Catégorie
          </legend>
          <div className="grid grid-cols-4 gap-2">
            {CATEGORIES.map((option, index) => {
              const Icone = option.icone;
              const choisie = categorie === option.valeur;
              return (
                <button
                  key={option.valeur}
                  type="button"
                  aria-pressed={choisie}
                  ref={index === 0 ? refPremiereTuile : undefined}
                  onClick={() => setCategorie(option.valeur)}
                  disabled={desactive}
                  className={`flex h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-[18px] px-1 text-center text-[12px] leading-[1.1] wrap-break-word cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed ${
                    choisie
                      ? "bg-[var(--primary)] font-bold text-[var(--primary-foreground)]"
                      : "bg-[var(--secondary)] font-semibold text-[var(--foreground)] hover:bg-[var(--accent)]"
                  }`}
                >
                  <Icone aria-hidden strokeWidth={2} className="h-5 w-5" />
                  <span>{option.libelle}</span>
                </button>
              );
            })}
          </div>
          {erreurs.categorie !== null && (
            <p
              id="categorie-erreur"
              className="mt-2 mb-0 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {erreurs.categorie}
            </p>
          )}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="libelle"
            className="text-[13px] font-bold text-[var(--muted-foreground)]"
          >
            Libellé
          </label>
          <input
            ref={refLibelle}
            id="libelle"
            type="text"
            autoComplete="off"
            placeholder="Ex. Restaurant Le Comptoir"
            value={libelle}
            onChange={(evenement) => setLibelle(evenement.target.value)}
            disabled={desactive}
            aria-invalid={erreurs.libelle !== null}
            aria-describedby={erreurs.libelle !== null ? "libelle-erreur" : undefined}
            className="h-[52px] w-full rounded-[18px] border-0 bg-[var(--secondary)] px-4 text-[15px] font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)]"
          />
          {erreurs.libelle !== null && (
            <p
              id="libelle-erreur"
              className="m-0 text-[13px] font-semibold text-[var(--erreur-texte)]"
            >
              {erreurs.libelle}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-[var(--muted-foreground)]">
            Justificatif
          </span>
          <BlocJustificatif
            mode={mode}
            idDepense={idDepense}
            desactive={desactive}
            fichierChoisi={fichier}
            onFichierChoisi={setFichier}
            declencherAuMontage={declencherAuMontage}
            onSessionExpiree={onSessionExpiree}
          />
        </div>

        {mode === "modification" && !desactive && (
          <div className="mt-[10px]">
            {confirmationOuverte ? (
              <div className="flex flex-col gap-3">
                {erreurSuppression !== null && (
                  <div
                    role="alert"
                    className="flex flex-col gap-2.5 rounded-[16px] bg-[var(--card)] p-3"
                  >
                    <p className="m-0 text-[13px] font-semibold text-[var(--erreur-texte)]">
                      {erreurSuppression}
                    </p>
                    <button
                      type="button"
                      onClick={() => void supprimer()}
                      disabled={suppressionEnCours}
                      className="h-11 rounded-[16px] bg-[var(--erreur-fond)] px-3 text-[14px] font-bold text-[var(--erreur-texte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    >
                      Réessayer
                    </button>
                  </div>
                )}
                <div
                  role="group"
                  aria-label="Confirmation de suppression"
                  onKeyDown={gererToucheConfirmation}
                  className="flex flex-col gap-3 rounded-[18px] bg-[var(--erreur-fond)] p-4"
                >
                  <p className="m-0 text-[13px] font-semibold leading-snug text-[var(--erreur-texte)]">
                    {"Supprimer cette dépense\u00A0? Cette action est irréversible."}
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      ref={refAnnuler}
                      onClick={annulerSuppression}
                      disabled={suppressionEnCours}
                      className="h-11 rounded-[16px] bg-[var(--card)] text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => void supprimer()}
                      disabled={suppressionEnCours}
                      aria-busy={suppressionEnCours}
                      className="h-11 rounded-[16px] bg-[var(--erreur-texte)] text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    >
                      {suppressionEnCours ? "Suppression…" : "Supprimer"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                ref={refSupprimer}
                onClick={ouvrirConfirmation}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[20px] bg-[var(--erreur-fond)] text-[15px] font-bold text-[var(--erreur-texte)] hover:bg-[var(--erreur-texte)] hover:text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                <Trash2 aria-hidden strokeWidth={2} className="h-5 w-5" />
                Supprimer
              </button>
            )}
          </div>
        )}
      </form>

      {!desactive && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[84px] z-[9] px-5">
          <div className="pointer-events-auto mx-auto flex w-full max-w-[26rem] flex-col gap-3 bg-[var(--card)] pt-3">
            {erreurEnvoi !== null && (
              <div className="flex flex-col gap-2.5 rounded-[16px] bg-[var(--erreur-fond)] p-3">
                <p
                  role="alert"
                  className="m-0 text-[13px] font-semibold text-[var(--erreur-texte)]"
                >
                  {erreurEnvoi}
                </p>
                <button
                  type="button"
                  onClick={() => void envoyer()}
                  className="h-11 rounded-[16px] bg-[var(--card)] px-3 text-[14px] font-bold text-[var(--erreur-texte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                >
                  Réessayer
                </button>
              </div>
            )}
            {erreurJustificatif !== null && (
              <div className="flex flex-col gap-2.5 rounded-[16px] bg-[var(--erreur-fond)] p-3">
                <p
                  role="alert"
                  className="m-0 text-[13px] font-semibold text-[var(--erreur-texte)]"
                >
                  {erreurJustificatif}
                </p>
                <button
                  type="button"
                  onClick={() => void retenterJustificatif()}
                  className="h-11 rounded-[16px] bg-[var(--card)] px-3 text-[14px] font-bold text-[var(--erreur-texte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                >
                  Réessayer
                </button>
              </div>
            )}
            <button
              type="submit"
              form="formulaire-depense"
              disabled={envoiEnCours}
              aria-busy={envoiEnCours}
              className="h-14 w-full rounded-[20px] bg-[var(--primary)] text-[15px] font-bold text-[var(--primary-foreground)] hover:bg-[var(--primaire-fonce)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:bg-[var(--muted)] disabled:text-[var(--muted-foreground)]"
            >
              {envoiEnCours
                ? "Enregistrement…"
                : mode === "creation"
                  ? "Enregistrer"
                  : "Enregistrer les modifications"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
