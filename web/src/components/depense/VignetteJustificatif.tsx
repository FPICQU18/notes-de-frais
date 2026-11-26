import { useEffect, useState } from "react";
import { FileText, ImageOff, X } from "lucide-react";

import { ApiError, apiGetJustificatif } from "../../api/client";

type EtatJustificatif =
  | { statut: "chargement" }
  | { statut: "image"; url: string }
  | { statut: "pdf" }
  | { statut: "aucun" };

type Props = {
  idDepense: number;
  /** Libellé de la dépense, utilisé pour l'alternative accessible de l'image. */
  libelle: string;
  onSessionExpiree: () => void;
};

/**
 * Vignette de justificatif en lecture seule, pour l'écran de validation.
 * Affiche la photo (avec agrandissement au clic), un lien « Ouvrir le PDF »,
 * ou « Aucune photo » quand l'API répond 404. Un échec de chargement ne bloque
 * ni la page ni les autres dépenses : on retombe sur « Aucune photo ».
 */
export function VignetteJustificatif({ idDepense, libelle, onSessionExpiree }: Props) {
  const [etat, setEtat] = useState<EtatJustificatif>({ statut: "chargement" });
  const [agrandie, setAgrandie] = useState(false);

  useEffect(() => {
    let actif = true;
    let urlCreee: string | null = null;

    (async () => {
      try {
        const reponse = await apiGetJustificatif(idDepense);
        if (!actif) return;
        if (reponse === null) {
          setEtat({ statut: "aucun" });
          return;
        }
        const contentType = reponse.headers.get("Content-Type") ?? "";
        if (contentType.startsWith("image/")) {
          const blob = await reponse.blob();
          if (!actif) return;
          urlCreee = URL.createObjectURL(blob);
          setEtat({ statut: "image", url: urlCreee });
        } else {
          setEtat({ statut: "pdf" });
        }
      } catch (attrape) {
        if (!actif) return;
        if (attrape instanceof ApiError && attrape.status === 401) {
          onSessionExpiree();
          return;
        }
        // Échec de chargement : on n'affiche pas d'erreur bloquante.
        setEtat({ statut: "aucun" });
      }
    })();

    return () => {
      actif = false;
      if (urlCreee !== null) {
        URL.revokeObjectURL(urlCreee);
      }
    };
  }, [idDepense, onSessionExpiree]);

  if (etat.statut === "chargement") {
    return null;
  }

  if (etat.statut === "aucun") {
    return (
      <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-[var(--muted-foreground)]">
        <ImageOff aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
        Aucune photo
      </p>
    );
  }

  if (etat.statut === "pdf") {
    return (
      <a
        href={`/api/v1/depenses/${idDepense}/justificatif`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-[16px] bg-[var(--secondary)] px-3 text-[13px] font-bold text-[var(--primaire-fonce)] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        <FileText aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
        Ouvrir le PDF
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAgrandie(true)}
        aria-label={`Agrandir le justificatif : ${libelle}`}
        className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[16px] border-0 bg-[var(--secondary)] p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        <img
          src={etat.url}
          alt={`Justificatif : ${libelle}`}
          className="h-full w-full object-cover"
        />
      </button>

      {agrandie && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(26,26,46,0.85)] p-5"
          onClick={() => setAgrandie(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`Justificatif agrandi : ${libelle}`}
        >
          <button
            type="button"
            onClick={() => setAgrandie(false)}
            aria-label="Fermer"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--card)] text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            <X aria-hidden="true" strokeWidth={2} />
          </button>
          <img
            src={etat.url}
            alt={`Justificatif : ${libelle}`}
            className="max-h-full max-w-full rounded-[16px] object-contain"
            onClick={(evenement) => evenement.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
