import { useNavigate } from "react-router";

import { FormulaireDepense } from "../components/depense/FormulaireDepense";

type Props = {
  onSessionExpiree: () => void;
};

export function NouvelleDepensePage({ onSessionExpiree }: Props) {
  const navigate = useNavigate();

  return (
    <FormulaireDepense
      mode="creation"
      onSessionExpiree={onSessionExpiree}
      onSucces={(annonce) =>
        navigate("/depenses", {
          state: annonce === null ? null : { annonce },
        })
      }
    />
  );
}
