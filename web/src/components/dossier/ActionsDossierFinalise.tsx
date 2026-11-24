import { useRef, useState } from "react";
import { Download, Printer } from "lucide-react";

import { ApiError, apiTelechargerCsv } from "../../api/client";

type Props = {
  idNote: number;
  /** Affiche les message d'erreur d'export dans une alerte de la page hôte. */
  onErreur: (message: string) => void;
  onSessionExpiree: () => void;
};

/**
 * Actions « Télécharger le CSV » et « Imprimer » d'un dossier finalisé
 * (validé ou remboursé). Réutilisable par le détail de validation (US-030).
 * Masquées à l'impression via `print:hidden`.
 */
export function ActionsDossierFinalise({ idNote, onErreur, onSessionExpiree }: Props) {
  const [telechargementEnCours, setTelechargementEnCours] = useState(false);
  // Garde synchrone : un double clic ne déclenche qu'un seul appel, même si
  // l'état React n'a pas encore été re-rendu entre les deux clics.
  const refEnCours = useRef(false);

  async function telechargerCsv() {
    if (refEnCours.current) return;
    refEnCours.current = true;
    setTelechargementEnCours(true);
    try {
      const { blob, nomFichier } = await apiTelechargerCsv(idNote);
      const urlObjet = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = urlObjet;
      lien.download = nomFichier;
      lien.click();
      URL.revokeObjectURL(urlObjet);
    } catch (attrape) {
      if (attrape instanceof ApiError && attrape.status === 401) {
        onSessionExpiree();
        return;
      }
      onErreur(attrape instanceof ApiError ? attrape.message : "Une erreur est survenue.");
    } finally {
      refEnCours.current = false;
      setTelechargementEnCours(false);
    }
  }

  return (
    <div className="mt-5 flex flex-col gap-2.5 print:hidden">
      <button
        type="button"
        onClick={() => void telechargerCsv()}
        disabled={telechargementEnCours}
        aria-busy={telechargementEnCours || undefined}
        className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--secondary)] px-4 text-[15px] font-bold text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
      >
        <Download size={20} strokeWidth={2} aria-hidden="true" />
        {telechargementEnCours ? "Téléchargement…" : "Télécharger le CSV"}
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--primary)] px-4 text-[15px] font-bold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        <Printer size={20} strokeWidth={2} aria-hidden="true" />
        Imprimer
      </button>
    </div>
  );
}
