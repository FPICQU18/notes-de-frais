import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
});

test("affiche l'API disponible quand /api/health répond ok", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
  );
  render(<App />);
  expect(await screen.findByText("API : disponible")).toBeInTheDocument();
});

test("affiche l'API injoignable en cas d'erreur réseau", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau"));
  render(<App />);
  expect(await screen.findByText("API : injoignable")).toBeInTheDocument();
});
