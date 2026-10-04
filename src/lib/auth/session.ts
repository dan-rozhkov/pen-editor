// The session hook comes straight from the Better Auth client; everything else
// in the app imports it from here so the client stays an implementation detail.
import { authClient } from "./authClient";

export const useSession = authClient.useSession;
export const signOut = () => authClient.signOut();
