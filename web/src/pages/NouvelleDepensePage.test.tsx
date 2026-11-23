import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, test, vi } from "vitest";

import { NouvelleDepensePage } from "./NouvelleDepensePage";

afterEach(() => {
  vi.restoreAllMocks();
});

function rendPage(entree: string) {
  return render(
    <MemoryRouter initialEntries={[entree]}>
      <Routes>
        <Route
          path="/depenses/nouvelle"
          element={<NouvelleDepensePage onSessionExpiree={vi.fn()} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

test("?scan=1 → le sélecteur de fichier est déclenché au montage", () => {
  const clickSpy = vi
    .spyOn(HTMLInputElement.prototype, "click")
    .mockImplementation(() => {});

  rendPage("/depenses/nouvelle?scan=1");

  expect(clickSpy).toHaveBeenCalled();
});

test("sans ?scan → aucun déclenchement programmatique du sélecteur", () => {
  const clickSpy = vi
    .spyOn(HTMLInputElement.prototype, "click")
    .mockImplementation(() => {});

  rendPage("/depenses/nouvelle");

  expect(clickSpy).not.toHaveBeenCalled();
});
