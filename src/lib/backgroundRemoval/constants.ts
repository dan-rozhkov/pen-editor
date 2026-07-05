// Client-side background-removal model config.
//
// The model weights are intentionally NOT vendored in the repo (multi-MB
// binary). They are fetched lazily, on first use, from the Hugging Face CDN,
// and cached by the browser's HTTP cache / onnxruntime-web session across
// calls within a session. Keep this the single place the URL is declared so
// it's easy to swap (e.g. for a self-hosted mirror) without hunting through
// the codebase.
//
// Model: briaai/RMBG-1.4 (u2net-family salient-object segmentation), exported
// to ONNX. Quantized weights keep the download reasonably small for a
// browser fetch.
export const REMOVE_BG_MODEL_URL =
  "https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx";

// RMBG-1.4 expects a fixed square input.
export const REMOVE_BG_INPUT_SIZE = 1024;
