import { useEffect } from "react";

import { startSessionBridge } from "./sessionChannel";

// Mounted next to SessionSync (every route, accounts on only); renders nothing.
export default function SessionBridge() {
  useEffect(() => startSessionBridge(), []);
  return null;
}
