interface EyeDropperOpenResult {
  sRGBHex: string;
}

interface EyeDropperOpenOptions {
  signal?: AbortSignal;
}

declare class EyeDropper {
  constructor();
  open(options?: EyeDropperOpenOptions): Promise<EyeDropperOpenResult>;
}

interface Window {
  EyeDropper?: typeof EyeDropper;
}
