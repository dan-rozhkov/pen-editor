import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ComponentType } from "react";

import { LocationProbe } from "./LocationProbe";

/** Renders `Page` at `url` inside a router, with a probe that shows where it navigated. */
export function renderAuthPage(Page: ComponentType, path: string, url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={<Page />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

export const currentLocation = () => screen.getByTestId("location").textContent;
