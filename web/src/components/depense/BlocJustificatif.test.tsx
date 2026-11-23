import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  BlocJustificatif,
  TAILLE_MAX_JUSTIFICATIF_OCTETS,
} from "./BlocJustificatif";

function jsonResponse(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

const createObjectURL = vi.fn(() => "blob:apercu-ticket");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function rendBloc(props: {
  mode?: "creation" | "modification";
  idDepense?: number;
  desactive?: boolean;
  declencherAuMontage?: boolean;
  onSessionExpiree?: () => void;
} = {}) {
  const onSessionExpiree = props.onSessionExpiree ?? vi.fn();
  function Harness() {
    const [fichier, setFichier] = useState<File | null>(null);
    return (
      <BlocJustificatif
        mode={props.mode ?? "creation"}
        idDepense={props.idDepense}
        desactive={props.desactive ?? false}
        declencherAuMontage={props.declencherAuMontage}
        fichierChoisi={fichier}
        onFichierChoisi={setFichier}
        onSessionExpiree={onSessionExpiree}
      />
    );
  }
  return { onSessionExpiree, ...render(<Harness />) };
}

test("le champ fichier est associé à un label : type file, accept images+PDF, capture environment", () => {
  rendBloc();
  const input = screen.getByLabelText("Ajouter la photo du ticket");
  expect(input).toHaveAttribute("type", "file");
  expect(input).toHaveAttribute("accept", "image/*,application/pdf");
  expect(input).toHaveAttribute("capture", "environment");
});

test("sélection d'une image → aperçu local via object URL, aucun appel réseau", () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  rendBloc();
  const fichier = new File(["png"], "ticket.png", { type: "image/png" });

  fireEvent.change(screen.getByLabelText("Ajouter la photo du ticket"), {
    target: { files: [fichier] },
  });

  expect(createObjectURL).toHaveBeenCalledWith(fichier);
  expect(
    screen.getByRole("img", { name: "Aperçu du justificatif choisi" }),
  ).toHaveAttribute("src", "blob:apercu-ticket");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("sélection d'un PDF → nom de fichier et icône, pas d'aperçu image", () => {
  rendBloc();
  const fichier = new File(["%PDF"], "ticket.pdf", { type: "application/pdf" });

  fireEvent.change(screen.getByLabelText("Ajouter la photo du ticket"), {
    target: { files: [fichier] },
  });

  expect(screen.getByText("ticket.pdf")).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(createObjectURL).not.toHaveBeenCalled();
});

test("fichier > 10 Mo → message taille, aucun aperçu, fichier non retenu", () => {
  rendBloc();
  const fichier = new File(["x"], "gros.png", { type: "image/png" });
  Object.defineProperty(fichier, "size", { value: TAILLE_MAX_JUSTIFICATIF_OCTETS + 1 });

  fireEvent.change(screen.getByLabelText("Ajouter la photo du ticket"), {
    target: { files: [fichier] },
  });

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Le justificatif ne peut pas dépasser 10 Mo.",
  );
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(createObjectURL).not.toHaveBeenCalled();
});

test("fichier ni image ni PDF → message format, fichier non retenu", () => {
  rendBloc();
  const fichier = new File(["texte"], "note.txt", { type: "text/plain" });

  fireEvent.change(screen.getByLabelText("Ajouter la photo du ticket"), {
    target: { files: [fichier] },
  });

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Format de justificatif non pris en charge (JPEG, PNG, HEIC ou PDF).",
  );
  expect(createObjectURL).not.toHaveBeenCalled();
});

test("démontage → l'object URL de l'aperçu est révoqué", () => {
  const { unmount } = rendBloc();
  const fichier = new File(["png"], "ticket.png", { type: "image/png" });

  fireEvent.change(screen.getByLabelText("Ajouter la photo du ticket"), {
    target: { files: [fichier] },
  });
  expect(createObjectURL).toHaveBeenCalled();

  unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:apercu-ticket");
});

test("modification : GET 200 image → aperçu depuis la route dédiée et « Remplacer la photo »", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("", { status: 200, headers: { "Content-Type": "image/png" } }),
  );
  rendBloc({ mode: "modification", idDepense: 7 });

  const img = await screen.findByRole("img", { name: "Justificatif de la dépense" });
  expect(img).toHaveAttribute("src", "/api/v1/depenses/7/justificatif");
  expect(screen.getByLabelText("Remplacer la photo")).toBeInTheDocument();
});

test("modification : GET 200 PDF → lien « Ouvrir le PDF » en nouvel onglet", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("", { status: 200, headers: { "Content-Type": "application/pdf" } }),
  );
  rendBloc({ mode: "modification", idDepense: 7 });

  const lien = await screen.findByRole("link", { name: "Ouvrir le PDF" });
  expect(lien).toHaveAttribute("href", "/api/v1/depenses/7/justificatif");
  expect(lien).toHaveAttribute("target", "_blank");
  expect(lien).toHaveAttribute("rel", "noopener");
  expect(screen.getByLabelText("Remplacer la photo")).toBeInTheDocument();
});

test("modification : GET 404 → « Aucune photo jointe » et bouton « Ajouter la photo du ticket »", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({ detail: "Introuvable" }, 404),
  );
  rendBloc({ mode: "modification", idDepense: 7 });

  expect(await screen.findByText("Aucune photo jointe")).toBeInTheDocument();
  expect(screen.getByLabelText("Ajouter la photo du ticket")).toBeInTheDocument();
});

test("modification : GET 401 → onSessionExpiree", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({ detail: "Session expirée." }, 401),
  );
  const onSessionExpiree = vi.fn();
  rendBloc({ mode: "modification", idDepense: 7, onSessionExpiree });

  await waitFor(() => expect(onSessionExpiree).toHaveBeenCalled());
});

test("désactivé : aucun GET et l'input est désactivé", () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  rendBloc({ mode: "modification", idDepense: 7, desactive: true });

  expect(screen.getByLabelText("Ajouter la photo du ticket")).toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("declencherAuMontage → le sélecteur de fichier est ouvert au montage", () => {
  const clickSpy = vi
    .spyOn(HTMLInputElement.prototype, "click")
    .mockImplementation(() => {});
  rendBloc({ declencherAuMontage: true });

  expect(clickSpy).toHaveBeenCalled();
});
