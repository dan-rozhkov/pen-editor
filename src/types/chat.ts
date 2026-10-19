// Chat types are now provided by the `ai` package (Message, ToolInvocation).
// This file contains app-specific chat payloads shared across the UI/store.

export interface AttachedImage {
  dataUrl: string;
  name: string;
}

export interface ChatLaunchPayload {
  text: string;
  images?: AttachedImage[];
}
