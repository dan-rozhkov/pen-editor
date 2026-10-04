import { useLocation } from "react-router";

/** Shows the router's current location so tests can assert where a page navigated. */
export function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}
