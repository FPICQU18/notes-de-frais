import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, FileText } from "lucide-react";

import { ApiError, apiGetJustificatif } from "../../api/client";

export const MESSAGE_JUSTIFICATIF_FORMAT =
  "Format de justificatif non pris en charge (JPEG, PNG, HEIC ou PDF).";
export const MESSAGE_JUSTIFICATIF_TAILLE = "Le justificatif ne peut pas dépasser 10 Mo.";
export const TAILLE_MAX_JUSTIFICATIF_OCTETS = 10 * 1024 * 1024;

type EtatExistant = { statut: "chargement" } | { statut: "aucun" } | { statut: "image" } | { statut: "pdf" };

type Props = {
  mode: "creation" | "modification";
  idDepense?: number;
  /** Vrai en lecture seule (dossier non brouillon) ou pendant le chargement du statut. */
  desactive: boolean;
  fichierChoisi: File | null;
  onFichierChoisi: (fichier: File | null) => void;
  /** Meilleur effort : déclenche le sélecteur de fichier au montage (?scan=1). */
  declencherAuMontage?: boolean;
  onSessionExpiree: () => void;
};

function estImage(fichier: File): boolean {
  return fichier.type.startsWith("image/");
}

export function BlocJustificatif({
  mode,
  idDepense,
  desactive,
  fichierChoisi,
  onFichierChoisi,
  declencherAuMontage = false,
  onSessionExpiree,
}: Props) {
  const refInput = useRef<HTMLInputElement>(null);
  const enModification = mode === "modification";
  const idInput = `fichier-justificatif-${idDepense ?? "creation"}`;

  const [etatExistant, setEtatExistant] = useState<EtatExistant>(
    enModification && !desactive && idDepense !== undefined
      ? { statut: "chargement" }
      : { statut: "aucun" },
  );
  const [erreurLocale, setErreurLocale] = useState<string | null>(null);
  const [apercuUrl, setApercuUrl] = useState<string | null>(null);
  // Miroir de l'URL d'aperçu pour la révoquer au démontage : la création et la
  // révocation restent pilotées par le gestionnaire de sélection (événement
  // utilisateur), jamais par un effet.
  const refApercuUrl = useRef<string | null>(null);

  // Déclenchement « meilleur effort » du sélecteur au montage ; si le navigateur
  // refuse l'ouverture programmatique, le bouton reste visible, actif et annoncé.
  useEffect(() => {
    if (declencherAuMontage && !desactive) {
      refInput.current?.click();
    }
  }, [declencherAuMontage, desactive]);

  // En modification : un GET dédié détermine l'état du justificatif existant.
  useEffect(() => {
    if (!enModification || desactive || idDepense === undefined) {
      return;
    }
    let actif = true;
    (async () => {
      try {
        const reponse = await apiGetJustificatif(idDepense);
        if (!actif) return;
        if (reponse === null) {
          setEtatExistant({ statut: "aucun" });
          return;
        }
        const contentType = reponse.headers.get("Content-Type") ?? "";
        setEtatExistant(
          contentType.startsWith("image/") ? { statut: "image" } : { statut: "pdf" },
        );
      } catch (attrape) {
        if (!actif) return;
        if (attrape instanceof ApiError && attrape.status === 401) {
          onSessionExpiree();
          return;
        }
        // Toute autre erreur de lecture : on n'affiche pas d'aperçu, sans bloquer.
        setEtatExistant({ statut: "aucun" });
      }
    })();
    return () => {
      actif = false;
    };
  }, [enModification, desactive, idDepense, onSessionExpiree]);

  // Révoque l'URL d'aperçu au démontage.
  useEffect(() => {
    return () => {
      if (refApercuUrl.current !== null) {
        URL.revokeObjectURL(refApercuUrl.current);
      }
    };
  }, []);

  // Crée ou libère l'aperçu local (object URL) d'un fichier choisi. Un PDF n'a
  // pas de miniature : l'URL précédente est révoquée et l'aperçu remis à null.
  function mettreAJourApercu(fichier: File | null) {
    if (refApercuUrl.current !== null) {
      URL.revokeObjectURL(refApercuUrl.current);
      refApercuUrl.current = null;
    }
    if (fichier !== null && estImage(fichier)) {
      refApercuUrl.current = URL.createObjectURL(fichier);
    }
    setApercuUrl(refApercuUrl.current);
  }

  function gererSelection(evenement: ChangeEvent<HTMLInputElement>) {
    const fichier = evenement.target.files?.[0] ?? null;
    // Autorise la re-sélection du même fichier après une erreur.
    evenement.target.value = "";
    if (fichier === null) return;
    setErreurLocale(null);
    if (fichier.size > TAILLE_MAX_JUSTIFICATIF_OCTETS) {
      setErreurLocale(MESSAGE_JUSTIFICATIF_TAILLE);
      mettreAJourApercu(null);
      onFichierChoisi(null);
      return;
    }
    if (!estImage(fichier) && fichier.type !== "application/pdf") {
      setErreurLocale(MESSAGE_JUSTIFICATIF_FORMAT);
      mettreAJourApercu(null);
      onFichierChoisi(null);
      return;
    }
    mettreAJourApercu(fichier);
    onFichierChoisi(fichier);
  }

  const aJustificatifExistant =
    enModification &&
    (etatExistant.statut === "image" || etatExistant.statut === "pdf");
  const libelleBouton = aJustificatifExistant
    ? "Remplacer la photo"
    : "Ajouter la photo du ticket";
  const urlJustificatif = `/api/v1/depenses/${idDepense ?? ""}/justificatif`;

  return (
    <div className="flex flex-col gap-2.5">
      {fichierChoisi !== null &&
        (apercuUrl !== null ? (
          <img
            src={apercuUrl}
            alt="Aperçu du justificatif choisi"
            className="h-28 w-full rounded-[18px] object-cover"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-[18px] bg-[var(--secondary)] px-4 py-3 text-[13px] font-semibold text-[var(--foreground)]">
            <FileText aria-hidden strokeWidth={2} className="h-5 w-5 shrink-0" />
            <span className="truncate">{fichierChoisi.name}</span>
          </div>
        ))}

      {fichierChoisi === null && enModification && !desactive && etatExistant.statut === "image" && (
        <img
          src={urlJustificatif}
          alt="Justificatif de la dépense"
          className="h-28 w-full rounded-[18px] object-cover"
        />
      )}
      {fichierChoisi === null && enModification && !desactive && etatExistant.statut === "pdf" && (
        <a
          href={urlJustificatif}
          target="_blank"
          rel="noopener"
          className="flex h-[52px] items-center justify-center gap-2 rounded-[18px] bg-[var(--secondary)] text-[15px] font-bold text-[var(--primaire-fonce)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          <FileText aria-hidden strokeWidth={2} className="h-5 w-5" />
          Ouvrir le PDF
        </a>
      )}
      {fichierChoisi === null && enModification && !desactive && etatExistant.statut === "aucun" && (
        <p className="m-0 text-[13px] font-semibold text-[var(--muted-foreground)]">
          Aucune photo jointe
        </p>
      )}

      {erreurLocale !== null && (
        <p
          role="alert"
          className="m-0 rounded-[16px] bg-[var(--erreur-fond)] p-3 text-[13px] font-semibold text-[var(--erreur-texte)]"
        >
          {erreurLocale}
        </p>
      )}

      <label
        htmlFor={idInput}
        className={`flex h-[52px] w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--secondary)] text-[15px] font-bold text-[var(--foreground)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--primary)] ${
          desactive ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
      >
        <Camera aria-hidden strokeWidth={2} className="h-5 w-5" />
        {libelleBouton}
      </label>
      <input
        ref={refInput}
        id={idInput}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        onChange={gererSelection}
        disabled={desactive}
        className="sr-only"
      />
    </div>
  );
}
