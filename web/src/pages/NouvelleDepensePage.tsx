import { useNavigate, useSearchParams } from "react-router";

import { FormulaireDepense } from "../components/depense/FormulaireDepense";

type Props = {
  onSessionExpiree: () => void;
};

export function NouvelleDepensePage({ onSessionExpiree }: Props) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const scan = params.get("scan") === "1";

  return (
    <FormulaireDepense
      mode="creation"
      onSessionExpiree={onSessionExpiree}
      declencherAuMontage={scan}
      onSucces={(annonce) =>
        navigate("/depenses", {
          state: annonce === null ? null : { annonce },
        })
      }
    />
  );
}
