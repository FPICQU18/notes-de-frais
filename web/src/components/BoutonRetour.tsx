import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";

/**
 * Bouton « Retour » en haut de page, style identique au bouton rond des
 * pages de détail (US-034) : icône `ArrowLeft` + libellé « Retour », cible
 * 44 px, focus visible. Revient à la page précédente de l'historique.
 */
export function BoutonRetour({ libelleAria = "Retour" }: { libelleAria?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      aria-label={libelleAria}
      className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-[var(--card)] px-3 text-[15px] font-bold text-[var(--foreground)] shadow-[var(--ombre-carte)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
    >
      <ArrowLeft aria-hidden strokeWidth={2} className="h-[22px] w-[22px] shrink-0" />
      Retour
    </button>
  );
}
