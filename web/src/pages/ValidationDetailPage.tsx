import { useNavigate, useParams } from "react-router";

import type { UserRead } from "../api/client";
import { PanneauDetailValidation } from "../components/validation/PanneauDetailValidation";

type Props = {
  utilisateur: UserRead;
  onSessionExpiree: () => void;
};

/**
 * Page détail mobile d'un dossier de la file de validation (`/validation/:id`).
 * Toute la logique métier (chargement, décisions, remboursement) vit dans
 * `PanneauDetailValidation` ; après une décision, retour à la file avec
 * l'annonce portée par la navigation. En bureau (≥ 1024 px), c'est
 * `ValidationPage` qui affiche ce panneau en maître-détail (US-043).
 */
export function ValidationDetailPage({ utilisateur, onSessionExpiree }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <PanneauDetailValidation
      idNote={id ?? ""}
      utilisateur={utilisateur}
      onSessionExpiree={onSessionExpiree}
      variante="page"
      onApresDecision={(annonce) => navigate("/validation", { state: { annonce } })}
    />
  );
}
