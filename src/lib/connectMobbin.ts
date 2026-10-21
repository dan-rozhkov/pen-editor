import { toast } from "sonner";

import { useMobbinAuthStore } from "@/store/mobbinAuthStore";

/** Starts the Mobbin OAuth popup and toasts a failure (shared by the File menu and Settings). */
export async function connectMobbinWithToast(): Promise<void> {
  await useMobbinAuthStore.getState().connect();
  const failure = useMobbinAuthStore.getState().error;
  if (failure) {
    toast(`Couldn't connect Mobbin — ${failure}`);
  }
}
