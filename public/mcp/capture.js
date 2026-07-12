"use strict";
(() => {
  // src/types.ts
  var NodeKind = {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3
  };

  // src/constants.ts
  var KEPT_ATTRIBUTES = /* @__PURE__ */ new Set([
    "alt",
    "checked",
    "currentSrc",
    "disabled",
    "for",
    "href",
    "id",
    "multiple",
    "open",
    "placeholder",
    "poster",
    "readonly",
    "rel",
    "required",
    "reversed",
    "role",
    "selected",
    "start",
    "target",
    "title",
    "type",
    "value"
  ]);
  var PLACEHOLDER_INPUT_TYPES = /* @__PURE__ */ new Set([
    "text",
    "search",
    "tel",
    "url",
    "email",
    "password",
    "number"
  ]);
  var SKIPPED_TAGS = /* @__PURE__ */ new Set(["HEAD", "SCRIPT", "STYLE", "NOSCRIPT"]);
  var DEFAULT_OPTIONS = {
    assertLayoutValid: true,
    skipRemoteAssetSerialization: false,
    devtools: void 0
  };
  var CAPTURE_TIMEOUT_MS = 1e4;
  var FIGH2D_OPEN = "<!--(figh2d)";
  var FIGH2D_CLOSE = "(/figh2d)-->";
  var FIGMETA_OPEN = "<!--(figmeta)";
  var FIGMETA_CLOSE = "(/figmeta)-->";
  var H2D_SPAN_OPEN = '<span data-h2d="' + FIGH2D_OPEN;
  var H2D_SPAN_CLOSE = FIGH2D_CLOSE + '"></span>';
  var META_SPAN_OPEN = '<span data-metadata="' + FIGMETA_OPEN;
  var META_SPAN_CLOSE = FIGMETA_CLOSE + '"></span>';
  var SUPPRESS_BEFORE_ATTR = "data-h2d-suppress-before";
  var SUPPRESS_AFTER_ATTR = "data-h2d-suppress-after";

  // src/analytics.ts
  function createTimer() {
    const start = performance.now();
    const buckets = { sb: 0, cssv: 0, fl: 0, sp: 0, i: 0, dd: 0 };
    const add = (label2, from) => {
      buckets[label2] += performance.now() - from;
    };
    function time(label2, thunk) {
      const from = performance.now();
      const result = thunk();
      if (result instanceof Promise || typeof result === "object" && result !== null && typeof result.then === "function") {
        return result.finally(
          () => add(label2, from)
        );
      }
      add(label2, from);
      return result;
    }
    return {
      time,
      finalize: () => ({ ...buckets, total: performance.now() - start })
    };
  }

  // src/nodeId.ts
  var counter = 0;
  var cache = /* @__PURE__ */ new WeakMap();
  function resetNodeIds() {
    counter = 0;
    cache = /* @__PURE__ */ new WeakMap();
  }
  function nodeId(node) {
    if (node !== null) {
      const existing = cache.get(node);
      if (existing) return existing;
    }
    const id = `h2d-node-${++counter}`;
    if (node !== null) cache.set(node, id);
    return id;
  }

  // src/errors.ts
  var H2DError = class extends Error {
    code;
    metadata;
    constructor(message, code, metadata) {
      super(message);
      this.code = code;
      this.metadata = metadata;
      this.name = "H2DError";
    }
  };

  // src/assets.ts
  var ASSET_TIMEOUT_MS = 8e3;
  var REENCODE_MIME_TYPES = /* @__PURE__ */ new Set(["image/avif", "image/heif", "image/heic"]);
  function collectElementAssets(el, styles, collector) {
    collectImgElementSrc(el, collector);
    collectVideoElementAssets(el, collector);
    collectBackgroundImageUrls(collector, styles);
  }
  function collectImgElementSrc(el, collector) {
    if (el instanceof HTMLImageElement) collector.addImage(el.currentSrc);
  }
  function collectVideoElementAssets(el, collector) {
    if (!(el instanceof HTMLVideoElement)) return;
    if (el.poster) collector.addImage(el.poster);
    if (el.currentSrc && !isShowingPoster(el)) collector.addVideo(el);
  }
  function isShowingPoster(video) {
    return video.poster ? video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.currentTime === 0 && video.paused : false;
  }
  var BACKGROUND_IMAGE_URL_RE = /url\("(.*?)"\)/g;
  function collectBackgroundImageUrls(collector, styles) {
    const matches = styles.backgroundImage?.matchAll(BACKGROUND_IMAGE_URL_RE);
    if (!matches) return;
    for (const [, url] of matches) collector.addImage(url);
  }
  async function fetchImageBlob(url) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Failed to fetch image: ${url} - ${res.status}`);
    let blob = await res.blob();
    if (REENCODE_MIME_TYPES.has(blob.type)) blob = await reencodeBlobToWebp(blob);
    return { url, blob };
  }
  async function reencodeBlobToWebp(blob) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get canvas context for image conversion");
      ctx.drawImage(img, 0, 0);
      return await canvasToWebpBlob(canvas);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  function canvasToWebpBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to create blob from canvas"));
        },
        "image/webp",
        1
      );
    });
  }
  function isSameOrigin(url) {
    try {
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  function clearVideoSrc(video) {
    video.src = "";
  }
  async function cloneCrossOriginVideoFrame(video) {
    const src = video.currentSrc || video.src;
    if (isSameOrigin(src) || video.crossOrigin !== null) return null;
    const clone = document.createElement("video");
    clone.crossOrigin = "anonymous";
    clone.src = src;
    clone.muted = true;
    clone.preload = "auto";
    clone.style.position = "absolute";
    clone.style.visibility = "hidden";
    clone.style.pointerEvents = "none";
    return new Promise((resolve, reject) => {
      const targetTime = video.currentTime;
      let seeked = false;
      let frameReady = false;
      let frameCallbackHandle = null;
      const timeoutHandle = setTimeout(onTimeout, ASSET_TIMEOUT_MS);
      clone.addEventListener("error", onError);
      if (targetTime === 0) {
        seeked = true;
        frameCallbackHandle = clone.requestVideoFrameCallback(onFrame);
        clone.play().then(() => clone.pause()).catch(onError);
      } else if (clone.readyState >= HTMLMediaElement.HAVE_METADATA) {
        onMetadataReady();
      } else {
        clone.addEventListener("loadedmetadata", onMetadataReady, { once: true });
      }
      function onMetadataReady() {
        clone.currentTime = targetTime;
        clone.addEventListener("seeked", onSeeked, { once: true });
        frameCallbackHandle = clone.requestVideoFrameCallback(onFrame);
      }
      function onFrame() {
        frameReady = true;
        maybeResolve();
      }
      function onSeeked() {
        seeked = true;
        maybeResolve();
      }
      function maybeResolve() {
        if (seeked && frameReady) {
          cleanup();
          resolve(clone);
        }
      }
      function cleanup() {
        clearTimeout(timeoutHandle);
        clone.removeEventListener("error", onError);
        clone.removeEventListener("loadedmetadata", onMetadataReady);
        clone.removeEventListener("seeked", onSeeked);
        if (frameCallbackHandle !== null) clone.cancelVideoFrameCallback(frameCallbackHandle);
      }
      function onError() {
        const err = new Error(
          `Video error: code: ${clone.error?.code}, message: ${clone.error?.message} (readyState: ${clone.readyState})`
        );
        cleanup();
        clearVideoSrc(clone);
        reject(err);
      }
      function onTimeout() {
        cleanup();
        clearVideoSrc(clone);
        reject(new H2DError("Video loading timeout", "VIDEO_TIMEOUT"));
      }
    });
  }
  async function captureVideoFrame(video) {
    const clone = await cloneCrossOriginVideoFrame(video);
    const source = clone ?? video;
    try {
      if (source.videoWidth === 0 || source.videoHeight === 0) {
        throw new Error("Video has invalid dimensions");
      }
      const canvas = document.createElement("canvas");
      canvas.width = source.videoWidth;
      canvas.height = source.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get canvas context");
      ctx.drawImage(source, 0, 0);
      return await canvasToWebpBlob(canvas);
    } finally {
      if (clone) clearVideoSrc(clone);
    }
  }
  function isSkippableRemoteUrl(url) {
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("//")) {
      return isSkippableRemoteUrl(window.location.href);
    }
    try {
      const hostname = new URL(url, window.location.href).hostname;
      return !(hostname === "0.0.0.0" || hostname === "localhost" || hostname.startsWith("127.") || hostname === "[::1]" || hostname === "::1" || hostname.endsWith(".local"));
    } catch {
      return false;
    }
  }
  var ImageCollector = class {
    constructor(options) {
      this.options = options;
    }
    options;
    promises = /* @__PURE__ */ new Map();
    rasterizedId = 0;
    addPromise(url, promise) {
      this.promises.set(
        url,
        promise.catch((err) => ({ url, blob: null, error: String(err) }))
      );
    }
    addImage(url) {
      if (!url || this.promises.has(url)) return void 0;
      const promise = this.options.skipRemoteAssetSerialization && isSkippableRemoteUrl(url) ? Promise.resolve({ url, blob: null }) : fetchImageBlob(url);
      this.addPromise(url, promise);
      return void 0;
    }
    addCanvas(canvas) {
      const url = this.getRasterizedImageUrl();
      const promise = canvasToWebpBlob(canvas).then((blob) => ({ url, blob }));
      this.addPromise(url, promise);
      return url;
    }
    addVideo(video) {
      const url = video.currentSrc;
      if (!url || this.promises.has(url)) return void 0;
      const promise = captureVideoFrame(video).then((blob) => ({ url, blob }));
      this.addPromise(url, promise);
      return void 0;
    }
    getRasterizedImageUrl() {
      return `rasterized:${this.rasterizedId++}`;
    }
    async getBlobMap() {
      const entries = await Promise.all(
        Array.from(this.promises, async ([url, promise]) => [url, await promise])
      );
      return new Map(entries);
    }
  };

  // src/fonts.ts
  function resolveFontStretchKeyword(value) {
    if (!value.endsWith("%")) return value.toLowerCase();
    const n = parseFloat(value);
    if (isNaN(n)) return "normal";
    if (n <= 50) return "ultra-condensed";
    if (n <= 62.5) return "extra-condensed";
    if (n <= 75) return "condensed";
    if (n <= 87.5) return "semi-condensed";
    if (n <= 100) return "normal";
    if (n <= 112.5) return "semi-expanded";
    if (n <= 125) return "expanded";
    if (n <= 150) return "extra-expanded";
    return "ultra-expanded";
  }
  function parseFontFamilyList(value) {
    const result = [];
    const re = /(?:"([^"]+)"|'([^']+)'|([^,\s][^,]*))/g;
    let m;
    while ((m = re.exec(value)) !== null) {
      const candidate = (m[1] ?? m[2] ?? m[3])?.trim();
      if (candidate) result.push(candidate);
    }
    return result;
  }
  function resolveLineBoxHeight(collector, styles) {
    return collector.getLineBoxHeight(
      styles.fontFamily ?? "Times",
      styles.fontStretch ?? "100%",
      styles.fontStyle === "italic" ? "italic" : "normal",
      styles.fontWeight ?? "400",
      styles.fontSize ?? "16px"
    );
  }
  var FontCollector = class {
    /** Map<lowercaseFamily, entry> (L319). Iteration order == first-registration order. */
    families = /* @__PURE__ */ new Map();
    /** Dedup key set for `addUsage` (L320). */
    processedUsages = /* @__PURE__ */ new Set();
    /** `${originalFamilyCss}|stretch|style|weight|size` -> ascent+descent (L321). */
    lineBoxHeightCache = /* @__PURE__ */ new Map();
    /** Negative-availability cache, keyed like the `addFontFamily` dedup key (L322). */
    unavailable = /* @__PURE__ */ new Set();
    canvas = null;
    canvasCtx = null;
    /** Lazily-created offscreen canvas 2D context (L326-333, the `ctx` getter). */
    get ctx() {
      if (!this.canvasCtx) {
        this.canvas = document.createElement("canvas");
        this.canvasCtx = this.canvas.getContext("2d");
      }
      return this.canvasCtx;
    }
    /**
     * `Tt` (L267-277): registers font usage from a style diff, applying the
     * same defaults as `resolveLineBoxHeight`/`sn`.
     */
    register(styles, sampleText) {
      this.addFontFamily(
        styles.fontFamily ?? "Times",
        styles.fontStretch ?? "100%",
        styles.fontStyle === "italic" ? "italic" : "normal",
        styles.fontWeight ?? "400",
        styles.fontSize ?? "16px",
        sampleText
      );
    }
    getLineBoxHeight(fontFamily, fontStretch, fontStyle, fontWeight, fontSize) {
      const key = `${fontFamily}|${fontStretch}|${fontStyle}|${fontWeight}|${fontSize}`;
      return this.lineBoxHeightCache.get(key) ?? void 0;
    }
    getFonts() {
      this.collectWebFontFaces();
      return Object.fromEntries(this.families);
    }
    /** L349: empty method body in the source build — no @font-face/webfont enumeration. */
    collectWebFontFaces() {
    }
    /**
     * `addFontFamily` (L350-372): walks the comma-separated `font-family`
     * candidate list looking for the first one the browser actually renders.
     * `sampleTextSeed` mirrors the source's optional third argument — when the
     * family list has exactly one candidate and a seed is given, it is
     * expanded/truncated to a 32-char probe string (L352-355); `register()`
     * above never passes a seed (matches the unconditional 2-arg `Tt` call
     * sites documented for `xm`), so this path is exercised only by direct
     * callers of `addFontFamily`.
     */
    addFontFamily(family, stretch, style, weight, size, sampleTextSeed) {
      const candidates = parseFontFamilyList(family);
      const sample = candidates.length === 1 && sampleTextSeed ? Array.from(sampleTextSeed.repeat(32)).slice(0, 32).join("") : void 0;
      for (const candidate of candidates) {
        const lower = candidate.toLowerCase();
        const key = `${lower}|${stretch}|${style}|${weight}|${sample ? "sample" : "latin"}`;
        if (this.unavailable.has(key)) continue;
        if (this.families.has(lower)) {
          this.addUsage(lower, stretch, style, weight, size, family, sample);
          return;
        }
        if (!this.checkFontAvailable(candidate, stretch, style, weight, sample)) {
          this.unavailable.add(key);
          continue;
        }
        this.families.set(lower, { familyName: candidate, faces: [], usages: [] });
        this.addUsage(lower, stretch, style, weight, size, family, sample);
        return;
      }
    }
    /**
     * `checkFontAvailable` (L334-348): classic canvas width-comparison
     * font-detection trick. For each generic base (`monospace`, `sans-serif`,
     * `serif`) it measures a probe string once with the bare generic and once
     * with `"<family>", <generic>` at a fixed 72px size — if the width ever
     * differs, the named family is genuinely available/rendered by the
     * browser for at least one generic fallback.
     */
    checkFontAvailable(family, stretch, style, weight, sampleText) {
      const ctx = this.ctx;
      if (!ctx) return false;
      const sample = sampleText ?? "mmmmmmmmmmlli";
      const size = "72px";
      const stretchKeyword = resolveFontStretchKeyword(stretch);
      const generics = ["monospace", "sans-serif", "serif"];
      for (const generic of generics) {
        ctx.font = `${stretchKeyword} ${style} ${weight} ${size} ${generic}`;
        const withoutFamily = ctx.measureText(sample).width;
        ctx.font = `${stretchKeyword} ${style} ${weight} ${size} "${family}", ${generic}`;
        const withFamily = ctx.measureText(sample).width;
        if (withoutFamily !== withFamily) return true;
      }
      return false;
    }
    /**
     * `measureMetrics` (L373-384): sets `ctx.font` to the *resolved*
     * `familyName` (not the raw candidate string) and measures `"Hg"` (or the
     * seeded sample) to get ascent/descent for line-box height — not glyph
     * metrics.
     */
    measureMetrics(familyKey, stretch, style, weight, size, sampleText) {
      const ctx = this.ctx;
      if (!ctx) return void 0;
      const entry = this.families.get(familyKey.toLowerCase());
      if (!entry) return void 0;
      const stretchKeyword = resolveFontStretchKeyword(stretch);
      ctx.font = `${stretchKeyword} ${style} ${weight} ${size} "${entry.familyName}"`;
      const metrics = ctx.measureText(sampleText ?? "Hg");
      return {
        fontBoundingBoxAscent: metrics.fontBoundingBoxAscent,
        fontBoundingBoxDescent: metrics.fontBoundingBoxDescent
      };
    }
    /**
     * `addUsage` (L390-411): dedups by full usage key, pushes the usage record,
     * and — when metrics were measured — caches the line-box height under the
     * *original* (pre-split) `font-family` CSS value, not the resolved
     * candidate name.
     */
    addUsage(familyKey, stretch, style, weight, size, originalFamilyCss, sampleText) {
      const usageKey = `${familyKey}|${stretch}|${style}|${weight}|${size}`;
      if (this.processedUsages.has(usageKey)) return;
      this.processedUsages.add(usageKey);
      const entry = this.families.get(familyKey);
      if (!entry) return;
      const metrics = this.measureMetrics(familyKey, stretch, style, weight, size, sampleText);
      entry.usages.push({
        fontWeight: weight,
        fontStyle: style,
        fontStretch: stretch,
        fontSize: size,
        metrics
      });
      if (metrics) {
        const lineBoxHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
        const cacheKey = `${originalFamilyCss}|${stretch}|${style}|${weight}|${size}`;
        this.lineBoxHeightCache.set(cacheKey, lineBoxHeight);
      }
    }
  };

  // src/style/defaults.ts
  var DEFAULT_STYLE_VALUES = {
    accentColor: "auto",
    alignContent: "normal",
    alignItems: "normal",
    alignSelf: "auto",
    appearance: "none",
    aspectRatio: "auto",
    backdropFilter: "none",
    backgroundAttachment: "scroll",
    backgroundBlendMode: "normal",
    backgroundClip: "border-box",
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPositionX: "0%",
    backgroundPositionY: "0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto",
    borderBottomColor: "rgb(0, 0, 0)",
    borderBottomLeftRadius: "0px",
    borderBottomRightRadius: "0px",
    borderBottomStyle: "none",
    borderBottomWidth: "0px",
    borderCollapse: "separate",
    borderImageOutset: "0",
    borderImageRepeat: "stretch",
    borderImageSlice: "100%",
    borderImageSource: "none",
    borderImageWidth: "1",
    borderLeftColor: "rgb(0, 0, 0)",
    borderLeftStyle: "none",
    borderLeftWidth: "0px",
    borderRightColor: "rgb(0, 0, 0)",
    borderRightStyle: "none",
    borderRightWidth: "0px",
    borderSpacing: "0px",
    borderTopColor: "rgb(0, 0, 0)",
    borderTopLeftRadius: "0px",
    borderTopRightRadius: "0px",
    borderTopStyle: "none",
    borderTopWidth: "0px",
    bottom: "auto",
    boxShadow: "none",
    boxSizing: "content-box",
    clear: "none",
    clip: "auto",
    clipPath: "none",
    clipRule: "nonzero",
    color: "rgb(0, 0, 0)",
    colorScheme: "normal",
    columnCount: "auto",
    columnFill: "balance",
    columnGap: "normal",
    columnRuleColor: "rgb(0, 0, 0)",
    columnRuleStyle: "none",
    columnRuleWidth: "0px",
    columnSpan: "none",
    columnWidth: "auto",
    contain: "none",
    containerType: "normal",
    content: "normal",
    contentVisibility: "visible",
    display: "",
    filter: "none",
    flexBasis: "auto",
    flexDirection: "row",
    flexGrow: "0",
    flexShrink: "1",
    flexWrap: "nowrap",
    float: "none",
    fontFamily: "Times",
    fontFeatureSettings: "normal",
    fontKerning: "auto",
    fontOpticalSizing: "auto",
    fontPalette: "normal",
    fontSize: "16px",
    fontSizeAdjust: "none",
    fontStretch: "100%",
    fontStyle: "normal",
    fontVariationSettings: "normal",
    fontWeight: "400",
    gridAutoColumns: "auto",
    gridAutoFlow: "row",
    gridAutoRows: "auto",
    gridColumnEnd: "auto",
    gridColumnStart: "auto",
    gridRowEnd: "auto",
    gridRowStart: "auto",
    gridTemplateAreas: "none",
    gridTemplateColumns: "none",
    gridTemplateRows: "none",
    height: "auto",
    isolation: "auto",
    justifyItems: "normal",
    justifySelf: "auto",
    justifyContent: "normal",
    left: "auto",
    letterSpacing: "normal",
    lineBreak: "auto",
    lineHeight: "normal",
    listStyleImage: "none",
    listStylePosition: "outside",
    listStyleType: "disc",
    marginBottom: "0px",
    marginLeft: "0px",
    marginRight: "0px",
    marginTop: "0px",
    maxHeight: "none",
    maxWidth: "none",
    minHeight: "auto",
    minWidth: "auto",
    mixBlendMode: "normal",
    objectFit: "fill",
    opacity: "1",
    order: "0",
    outlineColor: "rgb(0, 0, 0)",
    outlineOffset: "0px",
    outlineStyle: "none",
    outlineWidth: "0px",
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
    position: "static",
    paddingBottom: "0px",
    paddingLeft: "0px",
    paddingRight: "0px",
    paddingTop: "0px",
    quotes: "auto",
    right: "auto",
    rowGap: "normal",
    strokeDasharray: "none",
    strokeDashoffset: "0px",
    strokeLinecap: "butt",
    strokeLinejoin: "miter",
    strokeMiterlimit: "4",
    strokeOpacity: "1",
    strokeWidth: "1px",
    textAlign: "start",
    textDecorationColor: "rgb(0, 0, 0)",
    textDecorationLine: "none",
    textDecorationStyle: "solid",
    textIndent: "0px",
    textShadow: "none",
    textTransform: "none",
    textWrapStyle: "auto",
    top: "auto",
    perspective: "none",
    perspectiveOrigin: "50% 50%",
    transform: "none",
    transformOrigin: "auto",
    transformStyle: "flat",
    translate: "none",
    backfaceVisibility: "visible",
    transitionProperty: "all",
    verticalAlign: "baseline",
    visibility: "visible",
    webkitTextFillColor: "",
    whiteSpace: "normal",
    width: "auto",
    willChange: "auto",
    writingMode: "horizontal-tb",
    zIndex: "auto",
    rotate: "none",
    scale: "none"
  };
  var DEFAULT_STYLE_ENTRIES = Object.freeze(
    Object.entries(DEFAULT_STYLE_VALUES)
  );
  var BOX_SIZE_PROPERTIES = [
    "width",
    "height",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight"
  ];
  var MARGIN_PROPERTIES = [
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft"
  ];
  var BORDER_SIDE_PROPERTIES = [
    { style: "borderTopStyle", width: "borderTopWidth", color: "borderTopColor" },
    { style: "borderRightStyle", width: "borderRightWidth", color: "borderRightColor" },
    { style: "borderBottomStyle", width: "borderBottomWidth", color: "borderBottomColor" },
    { style: "borderLeftStyle", width: "borderLeftWidth", color: "borderLeftColor" }
  ];
  var GRID_PROPERTIES = [
    "gridTemplateColumns",
    "gridTemplateRows",
    "gridColumnStart",
    "gridColumnEnd",
    "gridRowStart",
    "gridRowEnd",
    "columnGap",
    "rowGap",
    "gridAutoFlow",
    "gridTemplateAreas",
    "gridAutoColumns",
    "gridAutoRows"
  ];
  var TRANSFORM_PROPERTIES = [
    "transform",
    "translate",
    "rotate",
    "scale",
    "transformOrigin",
    "perspectiveOrigin"
  ];
  var CAMEL_TO_KEBAB = {};
  var KEBAB_TO_CAMEL = /* @__PURE__ */ new Map();
  for (const key of Object.keys(DEFAULT_STYLE_VALUES)) {
    const hyphenated = key.replace(/([A-Z])/g, "-$1").toLowerCase();
    const kebab = key.startsWith("webkit") ? `-${hyphenated}` : hyphenated;
    CAMEL_TO_KEBAB[key] = kebab;
    KEBAB_TO_CAMEL.set(kebab, key);
  }

  // src/style/extract.ts
  function refineIntoComputedStyles(properties, styleMap, styles, computedStyles) {
    for (const prop of properties) {
      const value = styleMap.get(CAMEL_TO_KEBAB[prop])?.toString();
      if (value && value !== DEFAULT_STYLE_VALUES[prop] && value !== styles[prop]) {
        computedStyles[prop] = value;
      }
    }
  }
  function extractStyles(el, pseudo) {
    const styles = {};
    const computed = window.getComputedStyle(el, pseudo);
    if ((pseudo === "::before" || pseudo === "::after") && (computed.content === "none" || computed.content === "normal" || computed.content === "no-open-quote" || computed.content === "no-close-quote")) {
      return null;
    }
    for (const [prop, defaultValue] of DEFAULT_STYLE_ENTRIES) {
      const value = computed[prop];
      if (value !== defaultValue) {
        styles[prop] = value;
      }
    }
    const computedStyles = {};
    const styleMap = "computedStyleMap" in el && !pseudo ? el.computedStyleMap() : null;
    if (styleMap) {
      for (const prop of BOX_SIZE_PROPERTIES) {
        const value = styleMap.get(CAMEL_TO_KEBAB[prop])?.toString();
        if (value) {
          if (value === DEFAULT_STYLE_VALUES[prop]) {
            delete styles[prop];
          } else if (value !== styles[prop]) {
            computedStyles[prop] = value;
          }
        }
      }
      refineIntoComputedStyles(GRID_PROPERTIES, styleMap, styles, computedStyles);
      refineIntoComputedStyles(TRANSFORM_PROPERTIES, styleMap, styles, computedStyles);
      for (const prop of MARGIN_PROPERTIES) {
        const value = styleMap.get(CAMEL_TO_KEBAB[prop])?.toString();
        if (value === "auto") {
          styles[prop] = "auto";
        }
      }
    }
    for (const side of BORDER_SIDE_PROPERTIES) {
      if (styles[side.width] == null) {
        delete styles[side.style];
        delete styles[side.color];
      }
    }
    if (styles.outlineWidth == null) {
      delete styles.outlineStyle;
      delete styles.outlineColor;
    }
    if (styles.perspective == null) {
      delete styles.perspectiveOrigin;
      delete computedStyles.perspectiveOrigin;
    }
    if (styles.webkitTextFillColor != null && styles.webkitTextFillColor === computed.color) {
      delete styles.webkitTextFillColor;
    }
    return { styles, computedStyles };
  }

  // src/geometry.ts
  function hasTransform(styles) {
    return Boolean(
      styles.rotate && styles.rotate !== "none" || styles.scale && styles.scale !== "none" || styles.transform && styles.transform !== "none" || styles.translate && styles.translate !== "none"
    );
  }
  function boxSize(el, styles, hasParentTransform) {
    if (el instanceof HTMLElement && (hasTransform(styles) || hasParentTransform)) {
      return { width: el.offsetWidth, height: el.offsetHeight };
    }
    if (el instanceof HTMLElement) {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    } else if (el instanceof SVGSVGElement) {
      const r = getComputedStyle(el);
      return {
        width: parseFloat(r.width) || el.width.baseVal.value,
        height: parseFloat(r.height) || el.height.baseVal.value
      };
    } else if (el instanceof SVGGraphicsElement) {
      const r = el.getBBox();
      return { width: r.width, height: r.height };
    } else if (el instanceof MathMLElement) {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    } else {
      if (el instanceof Text) {
        throw new Error(
          "Text nodes should be handled separately with their range contexts, not as regular elements with dimensions"
        );
      }
      return { width: 0, height: 0 };
    }
  }
  function resolvePercent(length, reference) {
    return length.endsWith("%") ? `${parseFloat(length) / 100 * reference}px` : length;
  }
  function parseTranslate(size, translate) {
    if (!translate) return new DOMMatrix();
    const parts = translate.trim().split(/\s+/);
    if (parts.length === 0) return new DOMMatrix();
    if (parts.length > 3) throw new Error(`Invalid translate value: ${translate}`);
    const x = resolvePercent(parts[0] ?? "0px", size.width);
    const y = resolvePercent(parts[1] ?? "0px", size.height);
    const z = parts[2] ?? "0px";
    return new DOMMatrix(`translate3d(${x}, ${y}, ${z})`);
  }
  function parseScale(scale) {
    if (!scale) return new DOMMatrix();
    const parts = scale.trim().split(/\s+/);
    if (parts.length === 0) return new DOMMatrix();
    if (parts.length > 3) throw new Error(`Invalid scale value: ${scale}`);
    const sx = parts[0];
    const sy = parts[1] ?? parts[0];
    const sz = parts[2] ?? "1";
    return new DOMMatrix(`scale3d(${sx}, ${sy}, ${sz})`);
  }
  function parseRotate(rotate) {
    if (!rotate) return new DOMMatrix();
    const parts = rotate.trim().split(/\s+/);
    if (parts.length === 0) return new DOMMatrix();
    if (parts.length === 1) return new DOMMatrix(`rotate(${parts[0]})`);
    if (parts.length === 2) {
      switch (parts[0]) {
        case "x":
          return new DOMMatrix(`rotateX(${parts[1]})`);
        case "y":
          return new DOMMatrix(`rotateY(${parts[1]})`);
        case "z":
          return new DOMMatrix(`rotateZ(${parts[1]})`);
        default:
          return new DOMMatrix();
      }
    }
    return parts.length === 4 ? new DOMMatrix(`rotate3d(${parts[0]}, ${parts[1]}, ${parts[2]}, ${parts[3]})`) : new DOMMatrix();
  }
  function parseTransformProperty(transform) {
    if (!transform || transform === "none") return new DOMMatrix();
    return new DOMMatrix(transform);
  }
  function localMatrix(size, styles) {
    if (!hasTransform(styles)) return null;
    try {
      const [ox = "0px", oy = "0px", oz = "0px"] = styles.transformOrigin?.trim().split(/\s+/) ?? [];
      const origin = new DOMMatrix(`translate3d(${ox}, ${oy}, ${oz})`);
      return origin.multiply(parseTranslate(size, styles.translate)).multiply(parseRotate(styles.rotate)).multiply(parseScale(styles.scale)).multiply(parseTransformProperty(styles.transform)).multiply(origin.inverse());
    } catch {
      return null;
    }
  }
  function childInverseTransform(parentInverse, matrix, origin) {
    if (!matrix) return parentInverse;
    try {
      let r = matrix.inverse();
      if (origin) {
        const { x, y } = origin;
        r = new DOMMatrix().translate(x, y).multiply(r).translate(-x, -y);
      }
      return parentInverse ? r.multiply(parentInverse) : r;
    } catch {
      return parentInverse;
    }
  }
  function untransformedOrigin(rect, width, height, parentInverse, matrix) {
    const rectCenter = new DOMPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const boxCenter = new DOMPoint(width / 2, height / 2);
    const c = parentInverse ? rectCenter.matrixTransform(parentInverse) : rectCenter;
    const l = matrix ? boxCenter.matrixTransform(matrix) : boxCenter;
    return { x: c.x - l.x, y: c.y - l.y };
  }
  function isNonIdentity(m) {
    const EPS = 1e-6;
    return Math.abs(m.a - 1) > EPS || Math.abs(m.b) > EPS || Math.abs(m.c) > EPS || Math.abs(m.d - 1) > EPS || Math.abs(m.e) > EPS || Math.abs(m.f) > EPS || Math.abs(m.m13) > EPS || Math.abs(m.m14) > EPS || Math.abs(m.m23) > EPS || Math.abs(m.m24) > EPS || Math.abs(m.m31) > EPS || Math.abs(m.m32) > EPS || Math.abs(m.m33 - 1) > EPS || Math.abs(m.m34) > EPS || Math.abs(m.m43) > EPS || Math.abs(m.m44 - 1) > EPS;
  }
  function transformQuad(quad, matrix) {
    return new DOMQuad(
      quad.p1.matrixTransform(matrix),
      quad.p2.matrixTransform(matrix),
      quad.p3.matrixTransform(matrix),
      quad.p4.matrixTransform(matrix)
    );
  }
  function buildQuad(matrix, width, height, corner) {
    const box = DOMQuad.fromQuad({
      p1: { x: 0, y: 0 },
      p2: { x: width, y: 0 },
      p3: { x: width, y: height },
      p4: { x: 0, y: height }
    });
    const transformed = transformQuad(box, matrix);
    const translated = transformQuad(
      transformed,
      new DOMMatrix().translate(corner.x, corner.y)
    );
    return {
      p1: { x: translated.p1.x, y: translated.p1.y, z: translated.p1.z },
      p2: { x: translated.p2.x, y: translated.p2.y, z: translated.p2.z },
      p3: { x: translated.p3.x, y: translated.p3.y, z: translated.p3.z },
      p4: { x: translated.p4.x, y: translated.p4.y, z: translated.p4.z }
    };
  }
  function computeRect(el, size, matrix, parentInverse) {
    const rect = el.getBoundingClientRect();
    if (!parentInverse && !matrix) {
      return { x: rect.x, y: rect.y, width: size.width, height: size.height };
    }
    const width = Math.max(size.width, 0.01);
    const height = Math.max(size.height, 0.01);
    try {
      const corner = untransformedOrigin(rect, width, height, parentInverse, matrix);
      const result = {
        x: corner.x,
        y: corner.y,
        width: size.width,
        height: size.height
      };
      if (matrix && isNonIdentity(matrix)) {
        try {
          result.quad = buildQuad(matrix, width, height, corner);
        } catch {
        }
      }
      return result;
    } catch {
      return { x: rect.x, y: rect.y, width: size.width, height: size.height };
    }
  }

  // src/text.ts
  function invertLinear2x2(m) {
    const det = m.a * m.d - m.b * m.c;
    return Math.abs(det) < 1e-10 ? null : { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det };
  }
  function fitBoxToLinear(width, height, inv) {
    const absA = Math.abs(inv.a);
    const absB = Math.abs(inv.b);
    const absC = Math.abs(inv.c);
    const absD = Math.abs(inv.d);
    const det = absA * absD - absB * absC;
    if (Math.abs(det) < 1e-10) return null;
    const w = (width * absD - height * absC) / det;
    const h = (height * absA - width * absB) / det;
    return w <= 0 || h <= 0 ? null : { width: w, height: h };
  }
  function fitRectsAABB(rects, matrix, fit) {
    const result = [];
    for (const rect of rects) {
      const size = fit(rect);
      if (!size) continue;
      const center = new DOMPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).matrixTransform(matrix);
      result.push(new DOMRect(center.x - size.width / 2, center.y - size.height / 2, size.width, size.height));
    }
    return result.length > 0 ? result : null;
  }
  function fitRectsWithKnownHeight(rects, matrix, inv, lineBoxHeight) {
    const absA = Math.abs(inv.a);
    const absB = Math.abs(inv.b);
    const absC = Math.abs(inv.c);
    const absD = Math.abs(inv.d);
    const horizontalDominant = absA >= absB;
    const scale = horizontalDominant ? absA : absB;
    if (scale < 1e-10) return null;
    return fitRectsAABB(rects, matrix, (rect) => {
      const w = horizontalDominant ? (rect.width - absC * lineBoxHeight) / absA : (rect.height - absD * lineBoxHeight) / absB;
      return w <= 0 ? null : { width: w, height: lineBoxHeight };
    });
  }
  function fitRectsToInverse(rects, matrix, inv) {
    return fitRectsAABB(rects, matrix, (rect) => fitBoxToLinear(rect.width, rect.height, inv));
  }
  function unionRect(rects) {
    if (rects.length === 0) return null;
    return rects.reduce((acc, r) => {
      const x = Math.min(acc.x, r.x);
      const y = Math.min(acc.y, r.y);
      return new DOMRect(x, y, Math.max(acc.x + acc.width, r.x + r.width) - x, Math.max(acc.y + acc.height, r.y + r.height) - y);
    });
  }
  function clusterLineCount(rects, isVertical) {
    const intervals = rects.map((r) => isVertical ? { start: r.left, end: r.right } : { start: r.top, end: r.bottom }).filter(({ start, end }) => end > start).sort((a, b) => a.start - b.start);
    let count = 0;
    let lastMid = -Infinity;
    for (const { start, end } of intervals) {
      const mid = (start + end) / 2;
      if (Math.abs(mid - lastMid) >= 1) {
        count++;
        lastMid = mid;
      }
    }
    return count;
  }
  function measureText(node, inverseTransform, lineBoxHeight, writingMode) {
    const range = document.createRange();
    if (Array.isArray(node)) {
      const first = node[0];
      const last = node[node.length - 1];
      if (first && last) {
        range.setStart(first, 0);
        range.setEnd(last, last.length);
      }
    } else {
      range.selectNode(node);
    }
    const boundingRect = range.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
    const isVertical = range.commonAncestorContainer instanceof HTMLElement && writingMode != null ? writingMode.startsWith("vertical") : false;
    range.detach();
    if (clientRects.length > 0 && inverseTransform) {
      const inv = invertLinear2x2(inverseTransform);
      if (inv) {
        const fitted = lineBoxHeight != null ? fitRectsWithKnownHeight(clientRects, inverseTransform, inv, lineBoxHeight) : fitRectsToInverse(clientRects, inverseTransform, inv);
        if (fitted) {
          const union = unionRect(fitted) ?? boundingRect;
          const lineCount2 = clusterLineCount(fitted, isVertical);
          return { x: union.x, y: union.y, width: union.width, height: union.height, lineCount: lineCount2 };
        }
        console.warn("Failed to solve text bounding box with AABB method, falling back to DOMRect");
      }
    }
    const lineCount = clusterLineCount(clientRects, isVertical);
    return { x: boundingRect.x, y: boundingRect.y, width: boundingRect.width, height: boundingRect.height, lineCount };
  }
  function buildTextNode(ctx, node, parent) {
    const lineBoxHeight = parent ? resolveLineBoxHeight(ctx.collectedFonts, parent.styles ?? {}) : null;
    const measured = measureText(node, parent?.inverseTransform ?? null, lineBoxHeight, parent?.styles?.writingMode);
    const { lineCount, ...rect } = measured;
    const text = Array.isArray(node) ? node.map((n) => n.textContent || "").join("") : node.textContent || "";
    const idSource = Array.isArray(node) ? node.length === 1 ? node[0] ?? null : null : node;
    return {
      nodeType: NodeKind.TEXT_NODE,
      id: nodeId(idSource),
      text,
      rect,
      lineCount
    };
  }

  // src/pseudo.ts
  var PSEUDOS = ["::before", "::after"];
  var suppressAttr = (pseudo) => pseudo === "::before" ? SUPPRESS_BEFORE_ATTR : SUPPRESS_AFTER_ATTR;
  function unescapeCssString(s) {
    return s.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, hex, ch) => {
      if (!hex) return ch != null ? ch : "";
      const code = parseInt(hex, 16);
      return code <= 1114111 ? String.fromCodePoint(code) : "\uFFFD";
    });
  }
  function parseContent(content, quotes) {
    if (!content) return null;
    if (content === "open-quote" || content === "close-quote") {
      const pool = quotes && quotes !== "auto" ? Array.from(
        quotes.matchAll(/"((?:[^"\\]|\\.)*)"/g),
        (m2) => unescapeCssString(m2[1])
      ) : ["\u201C", "\u201D", "\u2018", "\u2019"];
      return content === "open-quote" ? pool[0] ?? "\u201C" : pool[1] ?? "\u201D";
    }
    const m = content.match(/^"((?:[^"\\]|\\.)*)"/);
    return m ? unescapeCssString(m[1]) : null;
  }
  var PseudoElementCollector = class {
    #fonts;
    #queue = [];
    constructor(fonts) {
      this.#fonts = fonts;
    }
    collect(el, inverseTransform, pseudo) {
      const extracted = extractStyles(el, pseudo);
      if (extracted === null) return void 0;
      const styles = extracted.styles;
      const content = styles.content ?? "normal";
      const pseudoText = parseContent(content, styles.quotes);
      this.#fonts.register(styles, pseudoText != null ? pseudoText : void 0);
      const root = el.getRootNode();
      if (!(root instanceof Document || root instanceof ShadowRoot)) return void 0;
      const holder = {};
      this.#queue.push({
        el,
        pseudo,
        styles,
        pseudoText,
        id: nodeId(el) + pseudo,
        inverseParentTransform: inverseTransform,
        holder
      });
      return holder;
    }
    measure() {
      if (this.#queue.length === 0) return;
      const sheets = /* @__PURE__ */ new Map();
      try {
        for (const pseudo of PSEUDOS) {
          const sentinels = [];
          try {
            for (const m of this.#queue) {
              if (m.pseudo !== pseudo) continue;
              const root = m.el.getRootNode();
              if (!(root instanceof Document || root instanceof ShadowRoot)) continue;
              if (!sheets.has(root)) {
                const sheet = new CSSStyleSheet();
                sheet.insertRule(
                  `[${SUPPRESS_BEFORE_ATTR}]::before { content: none !important; }`
                );
                sheet.insertRule(
                  `[${SUPPRESS_AFTER_ATTR}]::after { content: none !important; }`
                );
                root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
                sheets.set(root, sheet);
              }
              const span = document.createElement("span");
              span.style.all = "initial";
              Object.assign(span.style, m.styles);
              span.style.removeProperty("content");
              span.textContent = m.pseudoText;
              m.el.setAttribute(suppressAttr(pseudo), "");
              sentinels.push({ measurement: m, sentinel: span });
              if (pseudo === "::before") m.el.prepend(span);
              else m.el.append(span);
            }
            for (const { measurement, sentinel } of sentinels) {
              const { styles, inverseParentTransform, id, holder } = measurement;
              const size = boxSize(sentinel, styles, inverseParentTransform != null);
              const matrix = localMatrix(size, styles);
              const rect = computeRect(sentinel, size, matrix, inverseParentTransform);
              const childInverse = childInverseTransform(inverseParentTransform, matrix, {
                x: rect.x,
                y: rect.y
              });
              const childNodes = [];
              for (const child of Array.from(sentinel.childNodes)) {
                if (child.nodeType === Node.TEXT_NODE) {
                  const measured = measureText(
                    child,
                    childInverse ?? null,
                    resolveLineBoxHeight(this.#fonts, styles),
                    styles.writingMode
                  );
                  const { lineCount, ...textRect } = measured;
                  childNodes.push({
                    nodeType: NodeKind.TEXT_NODE,
                    id: id + "-text",
                    text: child.textContent || "",
                    rect: textRect,
                    lineCount
                  });
                  break;
                }
              }
              Object.assign(holder, {
                nodeType: NodeKind.ELEMENT_NODE,
                id,
                tag: "SPAN",
                attributes: {},
                styles,
                rect,
                childNodes
              });
            }
          } finally {
            for (const { measurement, sentinel } of sentinels) {
              sentinel.remove();
              measurement.el.removeAttribute(suppressAttr(pseudo));
            }
          }
        }
      } finally {
        for (const [root, sheet] of sheets) {
          try {
            root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
              (s) => s !== sheet
            );
          } catch {
          }
        }
        this.#queue = [];
      }
    }
  };

  // src/scrollbar.ts
  var SCROLLBAR_HIDE_CSS = `
  *, *::before, *::after { scrollbar-width: none !important; }
  *::-webkit-scrollbar { display: none !important; }
`;
  function measureScrollbarWidth() {
    const container = document.body ?? document.documentElement;
    if (!container) return 0;
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;top:-9999px;left:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden;pointer-events:none;";
    container.appendChild(probe);
    const width = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    return width;
  }
  function collectDescendantShadowRoots(root) {
    const result = [];
    const walk = (node) => {
      if (node instanceof Element && node.shadowRoot) {
        result.push(node.shadowRoot);
        walk(node.shadowRoot);
      }
      for (const child of node.querySelectorAll("*")) {
        if (child.shadowRoot) {
          result.push(child.shadowRoot);
          walk(child.shadowRoot);
        }
      }
    };
    walk(root instanceof Document ? root.documentElement : root);
    return result;
  }
  var ScrollbarManager = class {
    analyticsTimer;
    sheet = null;
    adopted = [];
    constructor(opts = {}) {
      this.analyticsTimer = opts.analyticsTimer ?? ((fn) => fn());
    }
    hide(container) {
      this.analyticsTimer(() => {
        if (this.sheet || measureScrollbarWidth() <= 0) return;
        const roots = /* @__PURE__ */ new Set();
        let node = container.getRootNode();
        for (; ; ) {
          if (node instanceof ShadowRoot) {
            roots.add(node);
            node = node.host.getRootNode();
          } else {
            if (node instanceof Document) roots.add(node);
            break;
          }
        }
        for (const shadowRoot2 of collectDescendantShadowRoots(container)) {
          roots.add(shadowRoot2);
        }
        if (roots.size === 0) return;
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(SCROLLBAR_HIDE_CSS);
        this.sheet = sheet;
        try {
          for (const root of roots) {
            root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
            this.adopted.push(root);
          }
        } catch (err) {
          this.removeSheet();
          throw err;
        }
      });
    }
    show() {
      this.analyticsTimer(() => this.removeSheet());
    }
    removeSheet() {
      const sheet = this.sheet;
      if (sheet) {
        for (const root of this.adopted) {
          root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
        }
        this.adopted = [];
        this.sheet = null;
      }
    }
  };

  // src/cssvars/engine.ts
  var SHORTHAND_GROUPS = [
    { css: "padding", js: "padding", longhands: ["padding-top", "padding-right", "padding-bottom", "padding-left"] },
    { css: "margin", js: "margin", longhands: ["margin-top", "margin-right", "margin-bottom", "margin-left"] },
    {
      css: "border-color",
      js: "borderColor",
      longhands: ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"]
    },
    {
      css: "border-width",
      js: "borderWidth",
      longhands: ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"]
    },
    {
      css: "border-radius",
      js: "borderRadius",
      longhands: [
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-right-radius",
        "border-bottom-left-radius"
      ]
    },
    { css: "gap", js: "gap", longhands: ["row-gap", "column-gap"] }
  ];
  var SHORTHAND_GROUPS_BY_CSS = new Map(
    SHORTHAND_GROUPS.map((group) => [group.css, group])
  );
  var TRACKED_PROPERTIES = [
    { css: "color", inheritable: true },
    { css: "font-family", inheritable: true },
    { css: "font-size", inheritable: true },
    { css: "font-weight", inheritable: true },
    { css: "line-height", inheritable: true },
    { css: "letter-spacing", inheritable: true },
    { css: "background-color", inheritable: false },
    { css: "opacity", inheritable: false },
    { css: "row-gap", inheritable: false },
    { css: "column-gap", inheritable: false },
    { css: "padding-top", inheritable: false },
    { css: "padding-right", inheritable: false },
    { css: "padding-bottom", inheritable: false },
    { css: "padding-left", inheritable: false },
    { css: "border-top-color", inheritable: false },
    { css: "border-right-color", inheritable: false },
    { css: "border-bottom-color", inheritable: false },
    { css: "border-left-color", inheritable: false },
    { css: "border-top-width", inheritable: false },
    { css: "border-right-width", inheritable: false },
    { css: "border-bottom-width", inheritable: false },
    { css: "border-left-width", inheritable: false },
    { css: "border-top-left-radius", inheritable: false },
    { css: "border-top-right-radius", inheritable: false },
    { css: "border-bottom-right-radius", inheritable: false },
    { css: "border-bottom-left-radius", inheritable: false }
  ];
  var TRACKED_PROPERTY_SET = new Set(TRACKED_PROPERTIES.map((p) => p.css));
  var INHERITABLE_PROPERTY_SET = new Set(
    TRACKED_PROPERTIES.filter((p) => p.inheritable).map((p) => p.css)
  );
  var VAR_NAME_RE = /var\(\s*(--[^,)\s]+)/;
  var EMPTY_INHERITED_VARIABLES = /* @__PURE__ */ new Map();
  var DISABLED_RESULT = {
    variableStyles: null,
    inheritedVariables: EMPTY_INHERITED_VARIABLES
  };
  var EMPTY_RULES_BY_ELEMENT = /* @__PURE__ */ new Map();
  var EMPTY_ROOT_INDEX = {
    selectorRules: [],
    cssVariableProperties: /* @__PURE__ */ new Set(),
    selectorRulesByElement: EMPTY_RULES_BY_ELEMENT
  };
  function splitTopLevelCommas(selectorList) {
    const parts = [];
    let depth = 0;
    let current = "";
    for (const ch of selectorList) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts.filter((p) => p.length > 0);
  }
  function findMatchingParen(text, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }
  var LEGACY_PSEUDO_ELEMENTS = /* @__PURE__ */ new Set(["before", "after", "first-line", "first-letter"]);
  var SPECIFICITY_FORWARDING_PSEUDOS = /* @__PURE__ */ new Set(["not", "is", "has", "matches"]);
  function addSpecificity(target, add) {
    target.a += add.a;
    target.b += add.b;
    target.c += add.c;
  }
  function maxSpecificity(a, b) {
    return compareSpecificity(a, b) >= 0 ? a : b;
  }
  function computeSpecificity(selector) {
    const spec = { a: 0, b: 0, c: 0 };
    const s = selector.trim();
    let i = 0;
    const isIdentChar = (ch) => /[-\w\\]/.test(ch);
    while (i < s.length) {
      const ch = s[i];
      if (ch === void 0) break;
      if (/\s/.test(ch) || ch === ">" || ch === "+" || ch === "~") {
        i++;
        continue;
      }
      if (ch === "*") {
        i++;
        continue;
      }
      if (ch === "#" || ch === ".") {
        let j = i + 1;
        while (j < s.length && isIdentChar(s[j])) j++;
        spec[ch === "#" ? "a" : "b"] += 1;
        i = j;
        continue;
      }
      if (ch === "[") {
        const close = s.indexOf("]", i);
        i = close === -1 ? s.length : close + 1;
        spec.b += 1;
        continue;
      }
      if (ch === ":") {
        const doubleColon = s[i + 1] === ":";
        let j = doubleColon ? i + 2 : i + 1;
        const nameStart = j;
        while (j < s.length && isIdentChar(s[j])) j++;
        const name = s.slice(nameStart, j).toLowerCase();
        let argsEnd = j;
        let argText = null;
        if (s[j] === "(") {
          const close = findMatchingParen(s, j);
          argsEnd = close === -1 ? s.length : close + 1;
          argText = s.slice(j + 1, close === -1 ? s.length : close);
        }
        if (doubleColon || LEGACY_PSEUDO_ELEMENTS.has(name)) {
          spec.c += 1;
        } else if (name === "where") {
        } else if (SPECIFICITY_FORWARDING_PSEUDOS.has(name) && argText !== null) {
          let best = { a: 0, b: 0, c: 0 };
          for (const branch of splitTopLevelCommas(argText)) {
            best = maxSpecificity(best, computeSpecificity(branch));
          }
          addSpecificity(spec, best);
        } else {
          spec.b += 1;
        }
        i = argsEnd;
        continue;
      }
      if (isIdentChar(ch)) {
        let j = i + 1;
        while (j < s.length && isIdentChar(s[j])) j++;
        spec.c += 1;
        i = j;
        continue;
      }
      i++;
    }
    return spec;
  }
  function compareSpecificity(x, y) {
    if (x.a !== y.a) return x.a - y.a;
    if (x.b !== y.b) return x.b - y.b;
    return x.c - y.c;
  }
  function parseSelectorList(selectorText) {
    return splitTopLevelCommas(selectorText).map((selectorString) => ({
      selectorString,
      value: computeSpecificity(selectorString)
    }));
  }
  function referencesVar(value) {
    return value.includes("var(");
  }
  function extractVarName(value) {
    const t2 = value.trim();
    if (!t2.startsWith("var(")) return null;
    const m = t2.match(VAR_NAME_RE);
    return m?.[1] ?? null;
  }
  function splitShorthandValue(value) {
    const tokens = [];
    let depth = 0;
    let current = "";
    for (const ch of value) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth === 0 && ch === " ") {
        if (current) tokens.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current.trim());
    return tokens;
  }
  function expandShorthandValue(longhands, rawValue) {
    const tokens = splitShorthandValue(rawValue);
    if (longhands.length === 4) {
      if (tokens.length === 1) return [tokens[0], tokens[0], tokens[0], tokens[0]];
      if (tokens.length === 2) return [tokens[0], tokens[1], tokens[0], tokens[1]];
      if (tokens.length === 3) return [tokens[0], tokens[1], tokens[2], tokens[1]];
      if (tokens.length >= 4) return [tokens[0], tokens[1], tokens[2], tokens[3]];
    }
    if (longhands.length === 2) {
      if (tokens.length === 1) return [tokens[0], tokens[0]];
      if (tokens.length >= 2) return [tokens[0], tokens[1]];
    }
    return longhands.map(() => rawValue);
  }
  function resolveNestedSelector(selectorText, parentSelector) {
    if (parentSelector && selectorText.includes("&")) {
      return selectorText.split("&").join(`:is(${parentSelector})`);
    }
    return selectorText;
  }
  function mediaDoesNotMatch(mediaText, doc) {
    if (!mediaText) return false;
    try {
      const win = doc.defaultView;
      return !!win && !win.matchMedia(mediaText).matches;
    } catch {
      return false;
    }
  }
  function collectVarTrackedProperties(style, into) {
    for (let n = 0; n < style.length; n++) {
      const prop = style[n];
      const value = style.getPropertyValue(prop);
      if (!referencesVar(value)) continue;
      if (TRACKED_PROPERTY_SET.has(prop)) into.add(prop);
      const group = SHORTHAND_GROUPS_BY_CSS.get(prop);
      if (group) {
        for (const longhand of group.longhands) {
          if (TRACKED_PROPERTY_SET.has(longhand)) into.add(longhand);
        }
      }
    }
  }
  function collectInlineVarTrackedProperties(scope) {
    const props = /* @__PURE__ */ new Set();
    for (const el of scope.querySelectorAll("[style]")) {
      if (el instanceof HTMLElement) collectVarTrackedProperties(el.style, props);
    }
    if (scope instanceof HTMLElement) collectVarTrackedProperties(scope.style, props);
    return props;
  }
  function getActiveStylesheets(root, doc) {
    const byKey = /* @__PURE__ */ new Map();
    for (const sheet of [...root.styleSheets, ...root.adoptedStyleSheets]) {
      if (sheet.disabled || mediaDoesNotMatch(sheet.media.mediaText, doc)) continue;
      const key = sheet.href ?? sheet;
      byKey.delete(key);
      byKey.set(key, sheet);
    }
    return [...byKey.values()];
  }
  function walkRules(rules, visit, doc, parentSelector, layered) {
    for (const rule of rules) {
      let resolved;
      if (rule instanceof CSSStyleRule) {
        resolved = resolveNestedSelector(rule.selectorText, parentSelector);
        visit(rule, resolved, layered ?? false);
      }
      if (rule instanceof CSSGroupingRule) {
        if (rule instanceof CSSMediaRule && mediaDoesNotMatch(rule.media.mediaText, doc)) continue;
        const isLayerBlock = typeof CSSLayerBlockRule !== "undefined" && rule instanceof CSSLayerBlockRule;
        try {
          walkRules(rule.cssRules, visit, doc, resolved ?? parentSelector, (layered ?? false) || isLayerBlock);
        } catch {
        }
      }
    }
  }
  function collectStylesheetRules(root) {
    const doc = root instanceof Document ? root : root.ownerDocument;
    const cssVariableProperties = /* @__PURE__ */ new Set();
    const stylesheetRules = [];
    let order = 0;
    for (const sheet of getActiveStylesheets(root, doc)) {
      let cssRules;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue;
      }
      walkRules(
        cssRules,
        (rule, resolvedSelector, layered) => {
          stylesheetRules.push({ rule, resolvedSelector, order: order++, layered });
          collectVarTrackedProperties(rule.style, cssVariableProperties);
        },
        doc,
        void 0,
        void 0
      );
    }
    return { stylesheetRules, cssVariableProperties };
  }
  function extractTrackedDeclarations(style, tracked) {
    const result = /* @__PURE__ */ new Map();
    for (let n = 0; n < style.length; n++) {
      const prop = style[n];
      const group = SHORTHAND_GROUPS_BY_CSS.get(prop);
      const isTracked = tracked.has(prop);
      if (!group && !isTracked) continue;
      const rawValue = style.getPropertyValue(prop);
      if (!rawValue) continue;
      const important = style.getPropertyPriority(prop) === "important";
      const usesVar = referencesVar(rawValue);
      if (group && usesVar) {
        const expanded = expandShorthandValue(group.longhands, rawValue);
        for (let p = 0; p < group.longhands.length; p++) {
          const longhand = group.longhands[p];
          if (tracked.has(longhand) && !result.has(longhand)) {
            const value = expanded[p];
            result.set(longhand, { value, important, isVar: referencesVar(value) });
          }
        }
      }
      if (isTracked) result.set(prop, { value: rawValue, important, isVar: usesVar });
    }
    return result;
  }
  function buildSelectorRules(entry, tracked) {
    const declarations = extractTrackedDeclarations(entry.rule.style, tracked);
    if (declarations.size === 0) return [];
    const result = [];
    try {
      for (const parsed of parseSelectorList(entry.resolvedSelector)) {
        result.push({
          selectorText: parsed.selectorString,
          specificity: parsed.value,
          order: entry.order,
          layered: entry.layered,
          isInline: false,
          declarations,
          // Substitution 2 (see module header): selectorSubject is always null.
          selectorSubject: null
        });
      }
    } catch {
      result.push({
        selectorText: entry.resolvedSelector,
        specificity: { a: 0, b: 0, c: 0 },
        order: entry.order,
        layered: entry.layered,
        isInline: false,
        declarations,
        selectorSubject: null
      });
    }
    return result;
  }
  function inlineStyleRule(el, tracked) {
    if (!(el instanceof HTMLElement) || el.style.length === 0) return null;
    const declarations = extractTrackedDeclarations(el.style, tracked);
    if (declarations.size === 0) return null;
    return {
      selectorText: "",
      specificity: { a: 0, b: 0, c: 0 },
      order: -1,
      layered: false,
      isInline: true,
      declarations,
      selectorSubject: null
    };
  }
  function compareCascadeCandidates(candidateRule, candidateDecl, bestRule, bestDecl) {
    if (candidateDecl.important !== bestDecl.important) return candidateDecl.important ? 1 : -1;
    if (candidateRule.layered !== bestRule.layered) {
      return candidateRule.layered === candidateDecl.important ? 1 : -1;
    }
    if (candidateRule.isInline !== bestRule.isInline) return candidateRule.isInline ? 1 : -1;
    const specCompare = compareSpecificity(candidateRule.specificity, bestRule.specificity);
    return specCompare !== 0 ? specCompare : candidateRule.order - bestRule.order;
  }
  function resolveDeclarationValue(prop, rules) {
    let best = null;
    for (const rule of rules) {
      const decl = rule.declarations.get(prop);
      if (decl && (!best || compareCascadeCandidates(rule, decl, best.rule, best.decl) > 0)) {
        best = { rule, decl };
      }
    }
    return best?.decl.value.trim() ?? null;
  }
  function safeMatches(el, selector) {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }
  function subjectKeysFor(el) {
    const keys = [];
    if (el.id) keys.push("#" + el.id);
    for (const cls of el.classList) keys.push("." + cls);
    keys.push(el.tagName.toLowerCase());
    return keys;
  }
  function indexRulesBySubject(rules) {
    const rulesBySubject = /* @__PURE__ */ new Map();
    const rulesWithoutSubject = [];
    for (const rule of rules) {
      const subject = rule.selectorSubject;
      if (subject === null) {
        rulesWithoutSubject.push(rule);
      } else {
        const bucket = rulesBySubject.get(subject);
        if (bucket) bucket.push(rule);
        else rulesBySubject.set(subject, [rule]);
      }
    }
    return { rulesBySubject, rulesWithoutSubject };
  }
  function buildSelectorRulesByElement(rules, scopeRoot) {
    if (rules.length === 0) return EMPTY_RULES_BY_ELEMENT;
    let host2 = null;
    if (scopeRoot instanceof ShadowRoot) {
      host2 = scopeRoot.host;
    } else {
      const rootNode = scopeRoot.getRootNode();
      if (rootNode instanceof ShadowRoot) host2 = rootNode.host;
    }
    const subjectKeys = /* @__PURE__ */ new Set();
    const addKeys = (el) => {
      if (el.id) subjectKeys.add("#" + el.id);
      for (const cls of el.classList) subjectKeys.add("." + cls);
      subjectKeys.add(el.tagName.toLowerCase());
    };
    if (scopeRoot instanceof Element) addKeys(scopeRoot);
    for (const el of scopeRoot.querySelectorAll("*")) addKeys(el);
    if (host2) addKeys(host2);
    const byElement = /* @__PURE__ */ new Map();
    for (const rule of rules) {
      if (rule.selectorSubject !== null && !subjectKeys.has(rule.selectorSubject)) continue;
      const selector = rule.selectorText;
      let matched;
      try {
        matched = [...scopeRoot.querySelectorAll(selector)];
      } catch {
        continue;
      }
      if (scopeRoot instanceof Element && safeMatches(scopeRoot, selector)) matched.push(scopeRoot);
      if (host2 && selector.startsWith(":host") && (selector === ":host" || safeMatches(host2, selector))) {
        matched.push(host2);
      }
      for (const el of matched) {
        const bucket = byElement.get(el);
        if (bucket) bucket.push(rule);
        else byElement.set(el, [rule]);
      }
    }
    return byElement;
  }
  function buildRootIndex(root, scopeElement) {
    const { stylesheetRules, cssVariableProperties } = collectStylesheetRules(root);
    for (const prop of collectInlineVarTrackedProperties(scopeElement)) cssVariableProperties.add(prop);
    if (cssVariableProperties.size === 0) return EMPTY_ROOT_INDEX;
    const selectorRules = [];
    for (const entry of stylesheetRules) selectorRules.push(...buildSelectorRules(entry, cssVariableProperties));
    return {
      selectorRules,
      cssVariableProperties,
      selectorRulesByElement: buildSelectorRulesByElement(selectorRules, scopeElement)
    };
  }
  function resolveVariableScope(lightRules, shadowRules, trackedProps, inheritedIn, computedStyle, parentComputedStyle) {
    const inheritedOut = /* @__PURE__ */ new Map();
    const candidateProps = new Set(trackedProps);
    for (const prop of inheritedIn.keys()) candidateProps.add(prop);
    for (const prop of candidateProps) {
      const resolved = resolveDeclarationValue(prop, lightRules) ?? (shadowRules ? resolveDeclarationValue(prop, shadowRules) : null);
      let varName;
      if (!resolved || resolved === "unset") {
        const inheritedCandidate = INHERITABLE_PROPERTY_SET.has(prop) ? inheritedIn.get(prop) : void 0;
        if (inheritedCandidate && computedStyle && parentComputedStyle) {
          const ownValue = computedStyle.getPropertyValue(prop);
          const parentValue = parentComputedStyle.getPropertyValue(prop);
          varName = ownValue && parentValue && ownValue !== parentValue ? void 0 : inheritedCandidate;
        } else {
          varName = inheritedCandidate;
        }
      } else if (resolved === "inherit") {
        varName = inheritedIn.get(prop);
      } else {
        varName = extractVarName(resolved) ?? void 0;
      }
      if (varName) inheritedOut.set(prop, varName);
    }
    const styles = {};
    for (const [prop, varName] of inheritedOut) {
      const jsKey = KEBAB_TO_CAMEL.get(prop);
      if (jsKey) styles[jsKey] = varName;
    }
    for (const group of SHORTHAND_GROUPS) {
      if (styles[group.js]) continue;
      const values = group.longhands.map((longhand) => {
        const jsKey = KEBAB_TO_CAMEL.get(longhand);
        return jsKey ? styles[jsKey] : void 0;
      });
      const first = values[0];
      if (first && values.every((v) => v === first)) styles[group.js] = first;
    }
    return {
      variableStyles: Object.keys(styles).length > 0 ? styles : null,
      inheritedVariables: inheritedOut
    };
  }
  var CssVarEngine = class {
    byRoot = /* @__PURE__ */ new Map();
    rootInherited = EMPTY_INHERITED_VARIABLES;
    enabled;
    analyticsTimer;
    constructor(options) {
      this.enabled = options.enabled;
      this.analyticsTimer = options.analyticsTimer ?? ((fn) => fn());
    }
    /** `seed` (L4809-4816) */
    seed(el) {
      if (!this.enabled) return;
      this.analyticsTimer(() => {
        const root = el.getRootNode();
        this.byRoot.set(root, buildRootIndex(root, el));
        this.rootInherited = this.computeIncomingInheritance(el);
      });
    }
    /** `forRoot` (L4817-4825) */
    forRoot(root) {
      let index = this.byRoot.get(root);
      if (!index) {
        index = buildRootIndex(root, root instanceof Document ? root.documentElement : root);
        this.byRoot.set(root, index);
      }
      return index;
    }
    /** `forElement` (L4826-4830) */
    forElement(el, inherited = this.rootInherited) {
      if (!this.enabled) return DISABLED_RESULT;
      return this.analyticsTimer(() => this.resolveForElement(el, inherited));
    }
    /** `resolveForElement` (L4831-4858) */
    resolveForElement(el, inherited) {
      const root = this.forRoot(el.getRootNode());
      const shadowRoot2 = el.shadowRoot ? this.forRoot(el.shadowRoot) : null;
      if (root.cssVariableProperties.size === 0 && (shadowRoot2?.cssVariableProperties.size ?? 0) === 0 && inherited.size === 0) {
        return DISABLED_RESULT;
      }
      const lightMatches = root.selectorRulesByElement.get(el) ?? [];
      const inline = inlineStyleRule(el, root.cssVariableProperties);
      const lightRules = inline ? [inline, ...lightMatches] : lightMatches;
      const shadowMatches = shadowRoot2 ? shadowRoot2.selectorRulesByElement.get(el) ?? null : null;
      const trackedProps = shadowRoot2 ? /* @__PURE__ */ new Set([...root.cssVariableProperties, ...shadowRoot2.cssVariableProperties]) : root.cssVariableProperties;
      const win = el.ownerDocument.defaultView;
      const computedStyle = win?.getComputedStyle(el);
      const parent = this.parentElementOrRootHost(el);
      const parentComputedStyle = parent ? win?.getComputedStyle(parent) : void 0;
      return resolveVariableScope(lightRules, shadowMatches, trackedProps, inherited, computedStyle, parentComputedStyle);
    }
    /** `parentElementOrRootHost` (L4859-4863) */
    parentElementOrRootHost(el) {
      if (el.parentElement) return el.parentElement;
      const root = el.getRootNode();
      return root instanceof ShadowRoot ? root.host : null;
    }
    /** `computeIncomingInheritance` (L4864-4913) */
    computeIncomingInheritance(el) {
      if (!(el instanceof Element)) return EMPTY_INHERITED_VARIABLES;
      const ancestors = [];
      let parent = this.parentElementOrRootHost(el);
      while (parent) {
        ancestors.push(parent);
        parent = this.parentElementOrRootHost(parent);
      }
      const tracked = TRACKED_PROPERTY_SET;
      const subjectIndexCache = /* @__PURE__ */ new Map();
      const subjectIndexFor = (index) => {
        let cached = subjectIndexCache.get(index);
        if (!cached) {
          cached = indexRulesBySubject(index.selectorRules.filter((r) => r.selectorText !== ""));
          subjectIndexCache.set(index, cached);
        }
        return cached;
      };
      let inherited = EMPTY_INHERITED_VARIABLES;
      const win = el.ownerDocument.defaultView;
      let prevComputedStyle;
      for (const ancestor of ancestors.slice().reverse()) {
        const rootIndex = this.forRoot(ancestor.getRootNode());
        const shadowIndex = ancestor.shadowRoot ? this.forRoot(ancestor.shadowRoot) : null;
        const lightSubjects = subjectIndexFor(rootIndex);
        const shadowSubjects = shadowIndex ? subjectIndexFor(shadowIndex) : null;
        const lightEmpty = lightSubjects.rulesWithoutSubject.length === 0 && lightSubjects.rulesBySubject.size === 0;
        const shadowEmpty = !shadowSubjects || shadowSubjects.rulesWithoutSubject.length === 0 && shadowSubjects.rulesBySubject.size === 0;
        if (lightEmpty && shadowEmpty && inherited.size === 0) {
          prevComputedStyle = win?.getComputedStyle(ancestor);
          continue;
        }
        const candidates = [...lightSubjects.rulesWithoutSubject];
        for (const key of subjectKeysFor(ancestor)) {
          candidates.push(...lightSubjects.rulesBySubject.get(key) ?? []);
        }
        const matched = candidates.filter((rule) => safeMatches(ancestor, rule.selectorText));
        const inline = inlineStyleRule(ancestor, rootIndex.cssVariableProperties);
        const lightRules = inline ? [inline, ...matched] : matched;
        const shadowMatches = shadowIndex ? shadowIndex.selectorRulesByElement.get(ancestor) ?? null : null;
        const computedStyle = win?.getComputedStyle(ancestor);
        inherited = resolveVariableScope(
          lightRules,
          shadowMatches,
          tracked,
          inherited,
          computedStyle,
          prevComputedStyle
        ).inheritedVariables;
        prevComputedStyle = computedStyle;
      }
      return inherited;
    }
  };

  // src/cssvars/index.ts
  var CssVarScopeEngine = class {
    engine;
    constructor(opts) {
      this.engine = new CssVarEngine(opts);
    }
    seed(root) {
      this.engine.seed(root);
    }
    forElement(el, inherited) {
      return this.engine.forElement(el, inherited);
    }
  };

  // src/svg.ts
  var SVG_ATTRIBUTE_DEFAULTS = {
    alignmentBaseline: "baseline",
    clip: "auto",
    clipPath: "none",
    clipRule: "nonzero",
    color: "rgb(0, 0, 0)",
    colorInterpolation: "sRGB",
    colorRendering: "auto",
    cursor: "auto",
    direction: "ltr",
    display: "inline",
    dominantBaseline: "auto",
    fill: "rgb(0, 0, 0)",
    fillOpacity: "1",
    fillRule: "nonzero",
    filter: "none",
    floodColor: "rgb(0, 0, 0)",
    floodOpacity: "1",
    imageRendering: "auto",
    letterSpacing: "normal",
    lightingColor: "rgb(255, 255, 255)",
    lineHeight: "normal",
    markerEnd: "none",
    markerMid: "none",
    markerStart: "none",
    mask: "none",
    opacity: "1",
    overflow: "visible",
    paintOrder: "normal",
    shapeRendering: "auto",
    stopColor: "rgb(0, 0, 0)",
    stopOpacity: "1",
    stroke: "none",
    strokeDasharray: "none",
    strokeDashoffset: "0px",
    strokeLinecap: "butt",
    strokeLinejoin: "miter",
    strokeMiterlimit: "4",
    strokeOpacity: "1",
    strokeWidth: "1px",
    textAnchor: "start",
    textDecoration: "none solid rgb(0, 0, 0)",
    textRendering: "auto",
    unicodeBidi: "normal",
    vectorEffect: "none",
    visibility: "visible",
    whiteSpace: "normal",
    writingMode: "horizontal-tb"
  };
  function camelToKebab(keys) {
    return Object.fromEntries(
      keys.map((key) => [key, key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()])
    );
  }
  var SVG_ATTRIBUTE_NAMES = camelToKebab(
    Object.keys(SVG_ATTRIBUTE_DEFAULTS)
  );
  function inlineComputedStyleDiff(source, target) {
    if (!(source instanceof Element) || !(target instanceof Element)) return;
    const computed = window.getComputedStyle(source);
    for (const [camelKey, defaultValue] of Object.entries(SVG_ATTRIBUTE_DEFAULTS)) {
      const value = computed.getPropertyValue(camelKey);
      if (value && value.toLowerCase() !== defaultValue.toLowerCase()) {
        target.setAttribute(SVG_ATTRIBUTE_NAMES[camelKey], value);
      }
    }
    for (let i = 0; i < source.childNodes.length; i++) {
      inlineComputedStyleDiff(
        source.childNodes[i],
        target.childNodes[i]
      );
    }
  }
  function serializeSvg(el) {
    const clone = el.cloneNode(true);
    inlineComputedStyleDiff(el, clone);
    const { width, height } = window.getComputedStyle(el);
    if (width.endsWith("px") && height.endsWith("px")) {
      clone.setAttribute("width", width);
      clone.setAttribute("height", height);
    }
    return clone.outerHTML;
  }

  // src/sources.ts
  var FG_PREFIX = "data-fg-";
  function decodeSource(sourceId, value) {
    if (typeof value !== "string" || !sourceId) return void 0;
    const n = value.split(":");
    const fileGuid = n[0].replace(/\./g, ":");
    const fileVersion = n[1] ? "[" + n[1].replace(/\./g, ":") + "]" : "";
    const filePath = n[2];
    const line = Number(n[3]);
    const column = Number(n[4]);
    const pos = Number(n[5]);
    const len = Number(n[6]);
    const base = { sourceId, fileGuid, filePath, fileVersion, line, column, pos, len };
    switch (n[7]) {
      case "e":
        return {
          type: "element",
          ...base,
          name: n[8],
          childTypes: n[9] ? n[9] === "_" ? [] : n[9].split("") : void 0,
          isComponentDefinition: n[10] === "1" ? true : void 0,
          assetKey: n[11] ? n[11] : void 0,
          makeLibraryId: n[12] ? n[12] : void 0,
          libraryId: n[13] ? n[13] : void 0,
          componentId: n[14] ? n[14] : void 0,
          isLibraryInstance: n[15] === "1" ? true : void 0
        };
      case "t":
        return { type: "text", ...base };
      case "x":
        return { type: "expression", ...base };
      default:
        return void 0;
    }
  }
  function resolveSources(el) {
    if (!el || !el.attributes) return void 0;
    const out = [];
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      if (attr != null && attr.name.startsWith(FG_PREFIX)) {
        const sourceId = attr.name.split("-")[2];
        const decoded = decodeSource(sourceId, attr.value);
        if (decoded) out.push(decoded);
      }
    }
    return out.length > 0 ? out : void 0;
  }
  function isComponentSource(s) {
    return s["type"] === "element" && (!!s["componentId"] || !!s["isLibraryInstance"] || !!s["assetKey"] || /^[A-Z]/.test(String(s["name"] ?? "")));
  }
  function selectionSourceId(el) {
    const v = el?.getAttribute("data-fginspector-selected");
    return v != null ? v : void 0;
  }
  function parseVariantProps(value) {
    if (value) {
      try {
        return JSON.parse(value);
      } catch {
        return void 0;
      }
    }
    return void 0;
  }
  function resolveReactOwner(_el, parentOwner) {
    return parentOwner;
  }
  function resolveSourceProps(_el) {
    return void 0;
  }

  // src/element.ts
  function resolveTag(el) {
    const t2 = el.tagName;
    if (typeof t2 === "string") return t2.toUpperCase();
    return el instanceof HTMLFormElement ? "FORM" : null;
  }
  function isCapturable(el) {
    return !(el instanceof HTMLScriptElement || el.nodeType === Node.ELEMENT_NODE && el.getAttribute("data-h2d-ignore") === "true");
  }
  function buildAttributes(el) {
    const out = {};
    for (const { name, value } of Array.from(el.attributes)) {
      const lower = name.toLowerCase();
      if (KEPT_ATTRIBUTES.has(lower) || lower.startsWith("aria-")) out[name] = value;
    }
    if (el instanceof HTMLVideoElement && el.poster) out.poster = el.poster;
    if ((el instanceof HTMLImageElement || el instanceof HTMLVideoElement) && el.currentSrc) {
      out.currentSrc = el.currentSrc;
    }
    if (el instanceof HTMLInputElement && out.type == null) out.type = el.type;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      out.checked = String(el.checked);
      if (el.indeterminate) out.indeterminate = "true";
    }
    return out;
  }
  function buildElementNode(ctx, el, parent) {
    const parentInverse = parent?.inverseTransform ?? null;
    if (!isCapturable(el)) return { h2dNode: null };
    const tag = resolveTag(el);
    if (tag === null) return { h2dNode: null };
    if (SKIPPED_TAGS.has(tag)) return { h2dNode: null };
    const selection = selectionSourceId(el);
    const ownSources = resolveSources(el);
    const extracted = extractStyles(el);
    const styles = extracted?.styles ?? {};
    const computedStyles = extracted?.computedStyles ?? {};
    const first = ownSources?.[0];
    if (first?.["type"] === "text" && el.childNodes.length === 1) {
      ctx.collectedFonts.register(styles);
      const textNode = buildTextNode(ctx, el.childNodes[0], {
        inverseTransform: parent?.inverseTransform ?? null,
        styles,
        inheritedVariables: parent?.inheritedVariables,
        reactOwner: parent?.reactOwner,
        parentSource: parent?.parentSource,
        parentProps: parent?.parentProps
      });
      textNode.sources = ownSources;
      return { h2dNode: textNode };
    }
    ctx.collectedFonts.register(styles);
    const size = boxSize(el, styles, parentInverse != null);
    const matrix = localMatrix(size, styles);
    const rect = computeRect(el, size, matrix, parentInverse);
    const inverseForChildren = childInverseTransform(parentInverse, matrix, {
      x: rect.x,
      y: rect.y
    });
    const reactOwner = resolveReactOwner(el, parent?.reactOwner);
    const propInfo = !ownSources || ctx.captureSourceProps ? resolveSourceProps(el) : void 0;
    const sources = ownSources ?? propInfo?.sources ?? parent?.parentSource;
    const sourcesChanged = sources !== parent?.parentSource && !!sources?.some(isComponentSource);
    const sourceProps = ctx.captureSourceProps ? sourcesChanged ? propInfo?.props : parent?.parentProps : void 0;
    const { variableStyles, inheritedVariables } = ctx.cssVarScopes.forElement(
      el,
      parent?.inheritedVariables
    );
    const childSink = [];
    const childContext = {
      inverseTransform: inverseForChildren,
      styles,
      inheritedVariables,
      reactOwner,
      parentSource: sources,
      parentProps: sourceProps
    };
    let content;
    let placeholderUrl;
    let sourceNodes;
    if (el instanceof SVGElement) {
      content = serializeSvg(el);
    } else if (el instanceof HTMLCanvasElement) {
      placeholderUrl = ctx.collectedImages.addCanvas(el);
    } else if (el instanceof HTMLSlotElement && el.getRootNode() instanceof ShadowRoot) {
      sourceNodes = el.assignedNodes({ flatten: true });
    } else if (el.shadowRoot) {
      sourceNodes = el.shadowRoot.childNodes;
    } else {
      sourceNodes = el.childNodes;
    }
    let pseudoElementStyles;
    if ((el instanceof HTMLInputElement && PLACEHOLDER_INPUT_TYPES.has(el.type) || el instanceof HTMLTextAreaElement) && el.placeholder) {
      pseudoElementStyles = {
        placeholder: extractStyles(el, "::placeholder")?.styles ?? {}
      };
    }
    const before = ctx.collectedPseudoElements.collect(
      el,
      inverseForChildren,
      "::before"
    );
    const after = ctx.collectedPseudoElements.collect(
      el,
      inverseForChildren,
      "::after"
    );
    const pseudoElementNodes = before || after ? { before, after } : void 0;
    collectElementAssets(el, styles, ctx.collectedImages);
    const assetKey = el.getAttribute("data-figma-asset-key");
    const figmaComponentMetadata = assetKey ? {
      assetKey,
      variantProps: parseVariantProps(
        el.getAttribute("data-figma-variant-props") ?? void 0
      )
    } : void 0;
    const node = {
      nodeType: NodeKind.ELEMENT_NODE,
      id: nodeId(el),
      tag,
      attributes: buildAttributes(el),
      styles,
      rect,
      childNodes: childSink,
      content,
      placeholderUrl,
      pseudoElementNodes,
      pseudoElementStyles,
      owningReactComponent: reactOwner,
      sources,
      selectionSourceId: selection,
      figmaComponentMetadata
    };
    if (Object.keys(computedStyles).length > 0) node.computedStyles = computedStyles;
    if (variableStyles) node.variableStyles = variableStyles;
    if (sourceProps) node.sourceProps = sourceProps;
    return {
      h2dNode: node,
      pendingChildren: sourceNodes ? { sourceNodes, parentContext: childContext, sink: childSink } : void 0
    };
  }

  // src/layout.ts
  function assertLayout(assertLayoutValid) {
    if (!assertLayoutValid) return;
    const r = document.body.getBoundingClientRect();
    if (r.x === 0 && r.y === 0 && r.width === 0 && r.height === 0 && r.top === 0 && r.right === 0 && r.bottom === 0 && r.left === 0) {
      throw new Error("Document does not have valid layout");
    }
  }

  // src/walk.ts
  function* groupChildren(nodes) {
    const it = nodes[Symbol.iterator]();
    let cur = it.next();
    while (!cur.done) {
      if (cur.value.nodeType === Node.TEXT_NODE) {
        const run = [cur.value];
        cur = it.next();
        while (!cur.done && cur.value.nodeType === Node.TEXT_NODE) {
          run.push(cur.value);
          cur = it.next();
        }
        yield run;
      } else {
        yield cur.value;
        cur = it.next();
      }
    }
  }
  function walkTree(ctx, root) {
    const rootSink = [];
    const stack = [
      { source: root, parentContext: void 0, sink: rootSink }
    ];
    while (stack.length > 0) {
      const { source, parentContext, sink } = stack.pop();
      if (Array.isArray(source)) {
        sink.push(buildTextNode(ctx, source, parentContext));
      } else if (source.nodeType === Node.TEXT_NODE) {
        sink.push(buildTextNode(ctx, source, parentContext));
      } else if (source.nodeType === Node.ELEMENT_NODE) {
        const { h2dNode, pendingChildren } = buildElementNode(
          ctx,
          source,
          parentContext
        );
        if (h2dNode) {
          sink.push(h2dNode);
          if (pendingChildren) {
            const grouped = [...groupChildren(pendingChildren.sourceNodes)];
            for (let i = grouped.length - 1; i >= 0; i--) {
              stack.push({
                source: grouped[i],
                parentContext: pendingChildren.parentContext,
                sink: pendingChildren.sink
              });
            }
          }
        }
      } else if (source.nodeType !== Node.COMMENT_NODE) {
        console.warn(`Unsupported node type: ${source.nodeType}`);
      }
    }
    return rootSink[0] ?? null;
  }
  function snapshot() {
    const r = document.body?.getBoundingClientRect();
    return {
      documentHidden: document.hidden,
      visibilityState: document.visibilityState,
      readyState: document.readyState,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      bodyWidth: r?.width ?? 0,
      bodyHeight: r?.height ?? 0
    };
  }
  function describe(d, rafFired) {
    const out = [];
    if (d.documentHidden) out.push("hidden");
    else if (d.visibilityState !== "visible") out.push(d.visibilityState);
    if (d.innerWidth === 0 || d.innerHeight === 0)
      out.push(`viewport=${d.innerWidth}x${d.innerHeight}`);
    if (d.bodyWidth === 0 || d.bodyHeight === 0)
      out.push(`body=${d.bodyWidth}x${d.bodyHeight}`);
    if (d.readyState !== "complete") out.push(d.readyState);
    if (!rafFired) out.push("rAF never fired");
    return out.length > 0 ? out.join(", ") : "unknown";
  }
  function onNextFrame(cb, signal) {
    if (signal.aborted) return;
    const handle = requestAnimationFrame((t2) => {
      if (!signal.aborted) cb(t2);
    });
    signal.addEventListener("abort", () => cancelAnimationFrame(handle), {
      once: true
    });
  }
  function runWalk(ctx, container, options, timeoutSignal) {
    assertLayout(options.assertLayoutValid ?? true);
    const rootEl = container instanceof Document ? container.documentElement : container;
    return new Promise((resolve, reject) => {
      let rafFired = false;
      onNextFrame(() => {
        rafFired = true;
        try {
          ctx.scrollbarManager.hide(container);
          const root = walkTree(ctx, rootEl);
          ctx.collectedPseudoElements.measure();
          if (!root) {
            resolve(null);
            return;
          }
          const documentRect = {
            x: 0,
            y: 0,
            width: rootEl.scrollWidth,
            height: rootEl.scrollHeight
          };
          const viewportRect = container instanceof Document ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight } : {
            x: container.scrollLeft,
            y: container.scrollTop,
            width: root.rect.width,
            height: root.rect.height
          };
          resolve({ root, documentRect, viewportRect });
        } catch (err) {
          reject(err);
        } finally {
          ctx.scrollbarManager.show();
        }
      }, timeoutSignal);
      timeoutSignal.addEventListener(
        "abort",
        () => {
          const snap = snapshot();
          reject(
            new H2DError(
              `H2D requestAnimationFrame timed out: ${describe(snap, rafFired)}`,
              "PAGE_NOT_RESPONDING",
              snap
            )
          );
        },
        { once: true }
      );
    });
  }

  // src/capture.ts
  async function forceDecodeImages(imgs) {
    for (const img of imgs) {
      if (img.decoding !== "sync") img.decoding = "sync";
      if (img.loading !== "eager") img.loading = "eager";
    }
    const results = await Promise.allSettled(imgs.map((img) => img.decode()));
    results.forEach((res, i) => {
      if (res.status === "rejected") {
        console.debug("Error decoding image", res.reason, imgs[i]?.src);
      }
    });
  }
  async function captureDocument(container, options = {}) {
    if (!(container instanceof Document) && !(container instanceof Element)) {
      throw new Error("Container node must be an Element or Document");
    }
    const opts = { ...DEFAULT_OPTIONS, ...options };
    assertLayout(opts.assertLayoutValid ?? true);
    const timer = createTimer();
    resetNodeIds();
    const cssVarScopes = new CssVarScopeEngine({
      enabled: opts.extractCssVariables ?? false,
      analyticsTimer: (fn) => timer.time("cssv", fn)
    });
    cssVarScopes.seed(
      container instanceof Document ? container.documentElement : container
    );
    const collectedImages = new ImageCollector({
      skipRemoteAssetSerialization: opts.skipRemoteAssetSerialization ?? false
    });
    const collectedFonts = new FontCollector();
    const ctx = {
      collectedImages,
      collectedFonts,
      collectedPseudoElements: new PseudoElementCollector(collectedFonts),
      cssVarScopes,
      scrollbarManager: new ScrollbarManager({
        analyticsTimer: (fn) => timer.time("sb", fn)
      }),
      devtools: opts.devtools,
      captureSourceProps: opts.captureSourceProps ?? false
    };
    const isDocument = container instanceof Document;
    const imgs = isDocument ? Array.from(container.images) : Array.from(container.querySelectorAll("img"));
    await timer.time("fl", () => forceDecodeImages(imgs));
    const timeoutSignal = opts.timeoutSignal ?? AbortSignal.timeout(CAPTURE_TIMEOUT_MS);
    const walked = await timer.time(
      "sp",
      () => runWalk(ctx, container, opts, timeoutSignal)
    );
    if (!walked || walked.root.nodeType !== NodeKind.ELEMENT_NODE) {
      throw new Error(
        isDocument ? "Container node must have a body element" : "Container node could not be serialized"
      );
    }
    const { root, documentRect, viewportRect } = walked;
    const assets = await timer.time("i", () => collectedImages.getBlobMap());
    const fonts = collectedFonts.getFonts();
    const sourceDataMap = void 0;
    const doc = {
      documentTitle: document.title || void 0,
      root,
      documentRect,
      viewportRect,
      devicePixelRatio: window.devicePixelRatio,
      version: 2,
      assets,
      fonts,
      sourceDataMap
    };
    return { document: doc, analytics: timer.finalize() };
  }

  // src/serialize.ts
  function toDataUrl(bytes) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(
        new File([bytes], "", { type: "application/octet-stream" })
      );
    });
  }
  async function toBase64(text) {
    const url = await toDataUrl(new TextEncoder().encode(text));
    return url.slice(url.indexOf(",") + 1);
  }
  async function serializeBlob(blob) {
    if (blob == null) return null;
    const buf = await blob.arrayBuffer();
    const base64Blob = await toDataUrl(new Uint8Array(buf));
    return { type: blob.type, base64Blob };
  }
  async function serializeDocument(doc) {
    const assets = {};
    for (const [url, entry] of doc.assets.entries()) {
      assets[url] = { ...entry, blob: await serializeBlob(entry.blob) };
    }
    return { ...doc, assets, fonts: doc.fonts };
  }
  async function documentToJson(doc) {
    return JSON.stringify(await serializeDocument(doc));
  }
  async function buildClipboardBlob(payload, metadata) {
    const meta = metadata ? META_SPAN_OPEN + await toBase64(JSON.stringify(metadata)) + META_SPAN_CLOSE : "";
    const main = H2D_SPAN_OPEN + await toBase64(payload) + H2D_SPAN_CLOSE;
    return new Blob([meta + main], { type: "text/html" });
  }

  // src/ui/theme.ts
  var P = {
    bg: "#2c2c2c",
    text: "rgba(255, 255, 255, 0.9)",
    textSecondary: "rgba(255, 255, 255, 0.5)",
    textOnBrand: "#fff",
    brand: "#0d99ff",
    brandBg: "rgba(13, 153, 255, 0.15)",
    brandHover: "#3db8ff",
    brandPressed: "#0d99ff",
    success: "rgba(255, 255, 255, 0.9)",
    error: "#f24822",
    border: "rgba(255, 255, 255, 0.1)",
    secondaryHover: "rgba(255, 255, 255, 0.1)",
    secondaryPressed: "rgba(255, 255, 255, 0.15)",
    shadow: "0 1px 3px 0 rgba(0,0,0,.15),0 0 .5px 0 rgba(0,0,0,.3)",
    tooltipShadow: "0 2px 8px rgba(0,0,0,0.3)",
    fontFamily: '"Inter",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif',
    fontSize: "12px",
    fontWeight: "500",
    lineHeight: "16px",
    letterSpacing: "0.005em",
    toolbarHeight: "40px",
    toolbarBorderRadius: "13px",
    toolbarTop: "16px",
    buttonHeight: "24px",
    buttonBorderRadius: "5px",
    tooltipBorderRadius: "4px",
    highlightBorderRadius: "4px"
  };
  var ICONS = {
    "icon.24.spinner": {
      path: "M15.333 7.011a6 6 0 0 0-2.834-.99A.534.534 0 0 1 12 5.5c0-.276.224-.502.5-.482A7 7 0 1 1 5.017 12.5.473.473 0 0 1 5.5 12c.276 0 .498.224.52.5a6 6 0 1 0 9.313-5.489",
      fillRule: "evenodd"
    },
    "icon.24.check": {
      path: "M15.584 7.722a.5.5 0 0 1 .832.555l-5 7.5a.502.502 0 0 1-.77.076l-3-3a.5.5 0 0 1 .708-.707l2.568 2.569z"
    },
    "icon.24.warning": {
      path: "m10.257 6.059-5.04 8.96C4.467 16.352 5.43 18 6.96 18h10.08c1.53 0 2.493-1.646 1.743-2.98l-5.04-8.96c-.764-1.36-2.722-1.36-3.486 0m.871.49-5.04 8.96A1 1 0 0 0 6.96 17h10.08a1 1 0 0 0 .872-1.49l-5.04-8.96a1 1 0 0 0-1.744 0M12 8.5a.5.5 0 0 1 .5.5v3.5a.5.5 0 1 1-1 0V9a.5.5 0 0 1 .5-.5m.75 6.254a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0",
      fillRule: "evenodd"
    },
    "icon.24.close.large": {
      path: "M17.354 6.646a.5.5 0 0 1 0 .708L12.707 12l4.647 4.646a.5.5 0 0 1-.708.708L12 12.707l-4.646 4.647a.5.5 0 0 1-.708-.708L11.293 12 6.646 7.354a.5.5 0 0 1 .708-.707L12 11.293l4.646-4.647a.5.5 0 0 1 .708 0",
      fillRule: "evenodd"
    },
    "icon.24.browser": {
      path: "M17 6a2 2 0 0 1 2 2v8l-.01.204a2 2 0 0 1-1.786 1.785L17 18H7l-.204-.01a2 2 0 0 1-1.785-1.786L5 16V8a2 2 0 0 1 2-2zM6 16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5H6zm1-9a1 1 0 0 0-.995.897L6 8v2h12V8a1 1 0 0 0-1-1zm.5 1a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1m2 0a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1"
    },
    "icon.24.interaction.click": {
      path: "M9.321 5.532a.5.5 0 0 1 .653.27l.777 1.876c.102.245-.039.524-.285.626s-.537.002-.639-.244L9.05 6.186a.5.5 0 0 1 .271-.654m-1.26 4.295L6.186 9.05a.5.5 0 0 0-.383.924l1.875.777c.246.101.524-.04.626-.285.102-.246.003-.537-.243-.64m-.383 3.422-1.875.776a.5.5 0 1 0 .383.924l1.875-.777c.246-.102.345-.393.243-.639s-.38-.386-.626-.284m2.149 2.69-.777 1.874a.5.5 0 0 0 .924.383l.777-1.875c.102-.245-.04-.524-.285-.626s-.537-.002-.639.244m6.495-5.188 1.874-.777a.5.5 0 1 0-.382-.924l-1.875.777c-.246.101-.346.393-.244.639s.381.386.627.285m-2.15-2.69.777-1.875a.5.5 0 1 0-.924-.383l-.776 1.875c-.102.245.039.524.284.626.246.102.538.002.64-.244m-1.82 3.002a1 1 0 0 0-1.288 1.288l2.25 6a1 1 0 0 0 1.906-.109l.605-2.418 2.418-.604a1 1 0 0 0 .108-1.907zm3.94 3.614L15 15l-.323 1.29L14.25 18l-.618-1.65-1.166-3.108L12 12l1.243.466 3.108 1.165L18 14.25z",
      fillRule: "evenodd"
    },
    "icon.24.new.tab": {
      path: "M9.5 6a.5.5 0 0 1 0 1h-2a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 1 1 0v2a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 16.5v-9A1.5 1.5 0 0 1 7.5 6zm8 0a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0V7.707l-4.146 4.147a.5.5 0 1 1-.707-.707L16.293 7H12.5a.5.5 0 0 1 0-1z"
    }
  };
  var SVG_NS = "http://www.w3.org/2000/svg";
  function icon(name, color, spin = false) {
    const def = ICONS[name];
    if (!def) throw new Error(`Unknown icon: ${String(name)}`);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    css(svg, {
      width: "24px",
      height: "24px",
      flexShrink: "0",
      animation: spin ? "spin 1s linear infinite" : ""
    });
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", def.path);
    path.setAttribute("fill", color);
    const rule = def.fillRule;
    if (rule) {
      path.setAttribute("fill-rule", rule);
      path.setAttribute("clip-rule", rule);
    }
    svg.appendChild(path);
    return svg;
  }
  function css(el, styles) {
    Object.assign(el.style, styles);
  }

  // src/ui/i18n.ts
  var STRINGS = {
    capturing: "Sending to Figma...",
    capturingForClipboard: "Capturing page for clipboard",
    clipboardSuccess: "Copied to clipboard",
    openInFigma: "Open file",
    error: "Capture failed",
    selectElement: "Select element",
    selectElementToCapture: "Select an element to capture",
    cancel: "Cancel",
    captureSubmitted: "Sent to Figma",
    sendToFigma: "Send to Figma",
    capturePage: "Entire screen",
    openFile: "Open file",
    errorCaptureExpired: "Capture expired. Please start a new capture.",
    errorCaptureNotFound: "Capture not found. Please start a new capture.",
    errorAccessDenied: "Access denied. Please try again.",
    errorCaptureAlreadySubmitted: "Capture already submitted. Please start a new capture.",
    errorTimeout: "Request timed out. Please try again.",
    errorPageNotResponding: "Capture timed out. Try keeping this tab in the foreground.",
    copyToClipboard: "Copy to clipboard",
    copyInstead: "Copy instead",
    sendToFigmaFailed: "Couldn't send to Figma"
  };
  function normalizeLocale(raw) {
    const t2 = raw.toLowerCase().trim();
    if (!t2) return "en";
    if (t2.startsWith("zh-tw") || t2.startsWith("zh-hant")) return "zh-tw";
    if (t2.startsWith("zh")) return "zh";
    if (t2.startsWith("ko")) return "ko";
    if (t2.startsWith("es")) return "es";
    if (t2.startsWith("pt")) return "pt";
    if (t2 === "nb" || t2 === "nn" || t2.startsWith("nb-") || t2.startsWith("nn-"))
      return "no";
    const base = t2.split("-")[0];
    return base != null ? base : "en";
  }
  function currentLocale() {
    const lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
    return normalizeLocale(lang);
  }
  var TABLES = { en: STRINGS };
  function t(key) {
    const table = TABLES[currentLocale()];
    if (table && table[key]) return table[key];
    return STRINGS[key] || key;
  }

  // src/ui/prefs.ts
  var KEY = "figma.capturePreferences";
  function readPrefs() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {
    }
    return {};
  }
  function writePrefs(patch) {
    try {
      const merged = { ...readPrefs(), ...patch };
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
    }
  }
  function dockPosition() {
    const p = readPrefs().dockPosition;
    return p === "top" || p === "bottom" ? p : "top";
  }
  function saveDockPosition(pos) {
    writePrefs({ dockPosition: pos });
  }

  // src/ui/host.ts
  var HOST_ID = "__figma_capture_toolbar_host__";
  var FADE_MS = 200;
  var host = null;
  var shadowRoot = null;
  var toolbar = null;
  var wrapper = null;
  var dismissTimer = null;
  var dockPos = "top";
  var dragInstaller = null;
  var immediateCleanups = /* @__PURE__ */ new Set();
  var removeCleanups = /* @__PURE__ */ new Set();
  function setDragInstaller(fn) {
    dragInstaller = fn;
  }
  function onDismiss(fn) {
    immediateCleanups.add(fn);
  }
  function onRemove(fn) {
    removeCleanups.add(fn);
  }
  var active = {
    menuActive: false,
    onEscape: null,
    onPrimary: null
  };
  function setActiveHandlers(h) {
    active = { ...active, ...h };
  }
  function getActiveHandlers() {
    return active;
  }
  function getToolbar() {
    return toolbar;
  }
  function getWrapper() {
    return wrapper;
  }
  function getDockPos() {
    return dockPos;
  }
  function setDockPos(pos) {
    dockPos = pos;
  }
  function appendToBody(el) {
    if (document.body) {
      document.body.appendChild(el);
    } else {
      const obs = new MutationObserver(() => {
        if (document.body) {
          obs.disconnect();
          document.body.appendChild(el);
        }
      });
      obs.observe(document.documentElement, { childList: true });
    }
  }
  function positionDock(el, pos) {
    if (pos === "top") {
      el.style.top = "16px";
      el.style.bottom = "";
    } else {
      el.style.top = "";
      el.style.bottom = "16px";
    }
  }
  function ensureHost() {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    if (host && shadowRoot && toolbar) {
      toolbar.style.animation = "none";
      return { host, shadowRoot, toolbar };
    }
    dockPos = dockPosition();
    host = document.createElement("div");
    host.id = HOST_ID;
    shadowRoot = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = "@keyframes spin{to{transform:rotate(360deg)}}@keyframes pop{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}@keyframes fade{to{opacity:0;transform:scale(.8)}}";
    shadowRoot.appendChild(style);
    wrapper = document.createElement("div");
    css(wrapper, {
      position: "fixed",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "2147483647",
      cursor: "grab",
      userSelect: "none"
    });
    positionDock(wrapper, dockPos);
    toolbar = document.createElement("div");
    css(toolbar, {
      display: "flex",
      alignItems: "center",
      width: "max-content",
      minWidth: "265px",
      height: P.toolbarHeight,
      padding: "0 8px",
      borderRadius: P.toolbarBorderRadius,
      background: P.bg,
      boxShadow: P.shadow,
      boxSizing: "border-box",
      overflow: "hidden",
      position: "relative",
      animation: "pop .3s ease-out",
      fontFamily: P.fontFamily,
      fontSize: P.fontSize,
      fontWeight: P.fontWeight,
      lineHeight: P.lineHeight,
      letterSpacing: P.letterSpacing
    });
    toolbar.addEventListener("mousedown", (e) => {
      const target = e.target;
      if (target.tagName === "BUTTON" || target.closest("button"))
        e.preventDefault();
    });
    wrapper.appendChild(toolbar);
    shadowRoot.appendChild(wrapper);
    dragInstaller?.(wrapper);
    appendToBody(host);
    return { host, shadowRoot, toolbar };
  }
  function isHostNode(n) {
    if (!n || !host) return false;
    return host.contains(n) || n === host;
  }
  function removeHost() {
    if (!host) return;
    for (const fn of removeCleanups) fn();
    host.remove();
    host = null;
    shadowRoot = null;
    toolbar = null;
    wrapper = null;
  }
  function dismiss() {
    active = { menuActive: false, onEscape: null, onPrimary: null };
    for (const fn of immediateCleanups) fn();
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    if (toolbar && host) {
      css(toolbar, { animation: `fade ${FADE_MS}ms ease-out forwards` });
      dismissTimer = setTimeout(() => {
        removeHost();
        dismissTimer = null;
      }, FADE_MS);
    } else {
      removeHost();
    }
  }

  // src/ui/toolbar.ts
  function button(text, onClick2, variant = "primary", disabled = false, isLoading = false) {
    const wrap = document.createElement("div");
    css(wrap, {
      display: "flex",
      alignItems: "center",
      alignSelf: "stretch",
      marginLeft: "8px"
    });
    const btn = document.createElement("button");
    btn.textContent = text;
    const primary = variant === "primary";
    const hover = primary ? P.brandHover : P.secondaryHover;
    const pressed = primary ? P.brandPressed : P.secondaryPressed;
    const base = primary ? P.brand : "transparent";
    css(btn, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: P.buttonHeight,
      padding: "0 8px",
      border: primary ? "none" : `1px solid ${P.border}`,
      borderRadius: P.buttonBorderRadius,
      background: base,
      color: primary ? P.textOnBrand : P.text,
      fontFamily: "inherit",
      fontSize: "inherit",
      fontWeight: "inherit",
      lineHeight: "inherit",
      letterSpacing: "inherit",
      cursor: disabled || isLoading ? "default" : "pointer",
      whiteSpace: "nowrap",
      transition: "background .1s",
      opacity: disabled ? "0.5" : "1"
    });
    if (disabled || isLoading) {
      btn.disabled = true;
    } else {
      btn.onmouseenter = () => btn.style.background = hover;
      btn.onmouseleave = () => btn.style.background = base;
      btn.onmousedown = () => btn.style.background = pressed;
      btn.onmouseup = () => btn.style.background = hover;
      btn.onclick = onClick2;
    }
    wrap.appendChild(btn);
    return wrap;
  }
  function iconButton(name, text, onClick2) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-icon-button", "");
    const svg = icon(name, P.text);
    const span = document.createElement("span");
    span.textContent = text;
    span.setAttribute("data-toolbar-label", "");
    css(span, { marginLeft: "4px" });
    btn.appendChild(svg);
    btn.appendChild(span);
    css(btn, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: P.buttonHeight,
      padding: "0 8px 0 4px",
      border: "none",
      borderRadius: P.buttonBorderRadius,
      background: "transparent",
      color: P.text,
      fontFamily: "inherit",
      fontSize: "inherit",
      fontWeight: "inherit",
      lineHeight: "inherit",
      letterSpacing: "inherit",
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "background .1s"
    });
    btn.onmouseenter = () => btn.style.background = P.secondaryHover;
    btn.onmouseleave = () => btn.style.background = "transparent";
    btn.onmousedown = () => btn.style.background = P.secondaryPressed;
    btn.onmouseup = () => btn.style.background = P.secondaryHover;
    btn.onclick = onClick2;
    return btn;
  }
  function closeButton(onClose) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", t("cancel"));
    btn.appendChild(icon("icon.24.close.large", P.text));
    css(btn, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: P.buttonHeight,
      height: P.buttonHeight,
      padding: "0",
      border: "none",
      borderRadius: P.buttonBorderRadius,
      background: "transparent",
      color: P.text,
      cursor: "pointer",
      transition: "background .1s",
      marginLeft: "8px"
    });
    btn.onmouseenter = () => btn.style.background = P.secondaryHover;
    btn.onmouseleave = () => btn.style.background = "transparent";
    btn.onmousedown = () => btn.style.background = P.secondaryPressed;
    btn.onmouseup = () => btn.style.background = P.secondaryHover;
    btn.onclick = onClose;
    return btn;
  }
  function divider() {
    const d = document.createElement("div");
    css(d, {
      width: "1px",
      alignSelf: "stretch",
      background: P.border,
      flexShrink: "0"
    });
    return d;
  }
  function label(text, padLeft = false, padRight = false) {
    const span = document.createElement("span");
    span.textContent = text;
    css(span, {
      flexGrow: "1",
      textAlign: "left",
      paddingLeft: padLeft ? "8px" : "4px",
      paddingRight: padRight ? "8px" : "4px",
      color: P.text,
      whiteSpace: "nowrap"
    });
    return span;
  }
  var NARROW_BREAKPOINT = 540;
  function isNarrow() {
    return window.innerWidth < NARROW_BREAKPOINT;
  }
  function collapseLabels(el, collapsed) {
    for (const lbl of el.querySelectorAll("[data-toolbar-label]"))
      lbl.style.display = collapsed ? "none" : "";
    for (const btn of el.querySelectorAll("[data-icon-button]"))
      btn.style.padding = collapsed ? "0 4px" : "0 8px 0 4px";
  }
  function refitResponsive(menuActive) {
    const toolbar2 = getToolbar();
    if (!menuActive || !toolbar2) return;
    const narrow = isNarrow();
    collapseLabels(toolbar2, narrow);
    toolbar2.style.minWidth = narrow ? "265px" : "490px";
  }
  var MORPH_MS = 300;
  var MORPH_EASE = "cubic-bezier(0.15, 1, 0.4, 1)";
  var morphState = null;
  function cancelMorph() {
    if (!morphState) return;
    const { cleanup, timeoutId } = morphState;
    clearTimeout(timeoutId);
    cleanup();
  }
  onDismiss(cancelMorph);
  function exitTransform(role) {
    return role === "icon" ? "translateY(-12px)" : "";
  }
  function enterTransform(role) {
    return role === "icon" ? "translateY(12px)" : "";
  }
  function morph(toolbar2, _shadowRoot, children, options) {
    cancelMorph();
    if (toolbar2.childNodes.length === 0) {
      if (options?.minWidth) toolbar2.style.minWidth = options.minWidth;
      toolbar2.replaceChildren(...children);
      return;
    }
    const startWidth = toolbar2.getBoundingClientRect().width;
    const startRect = toolbar2.getBoundingClientRect();
    const outgoing = [];
    for (const child of Array.from(toolbar2.children))
      outgoing.push({
        el: child,
        rect: child.getBoundingClientRect(),
        role: child.getAttribute("data-toolbar-role")
      });
    const minW = options?.minWidth ?? "";
    toolbar2.style.minWidth = minW;
    toolbar2.style.width = "max-content";
    toolbar2.replaceChildren(...children);
    const endWidth = toolbar2.getBoundingClientRect().width;
    toolbar2.style.transition = "none";
    toolbar2.style.minWidth = "0";
    toolbar2.style.width = `${startWidth}px`;
    const ghosts = [];
    for (const { el, rect, role } of outgoing) {
      const ghost = document.createElement("div");
      css(ghost, {
        position: "absolute",
        top: `${rect.top - startRect.top}px`,
        left: `${rect.left - startRect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        pointerEvents: "none"
      });
      ghost.appendChild(el);
      if (role) ghost.setAttribute("data-exit-role", role);
      toolbar2.appendChild(ghost);
      ghosts.push(ghost);
    }
    const ghostSet = new Set(ghosts);
    const entering = [];
    for (const child of Array.from(toolbar2.children))
      if (!ghostSet.has(child)) entering.push(child);
    for (const child of entering) {
      const role = child.getAttribute("data-toolbar-role");
      const enter = enterTransform(role);
      child.style.transition = "none";
      child.style.opacity = "0";
      if (enter) child.style.transform = enter;
    }
    void toolbar2.offsetWidth;
    const itemTransition = `opacity ${MORPH_MS}ms ${MORPH_EASE}, transform ${MORPH_MS}ms ${MORPH_EASE}`;
    toolbar2.style.transition = `width ${MORPH_MS}ms ${MORPH_EASE}`;
    toolbar2.style.width = `${endWidth}px`;
    for (const ghost of ghosts) {
      const role = ghost.getAttribute("data-exit-role");
      const exit = exitTransform(role);
      ghost.style.transition = itemTransition;
      ghost.style.opacity = "0";
      if (exit) ghost.style.transform = exit;
    }
    for (const child of entering) {
      child.style.transition = itemTransition;
      child.style.opacity = "1";
      child.style.transform = "";
    }
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      for (const ghost of ghosts) ghost.remove();
      for (const child of entering) {
        child.style.transition = "";
        child.style.opacity = "";
        child.style.transform = "";
      }
      toolbar2.style.width = "max-content";
      toolbar2.style.transition = "";
      toolbar2.style.minWidth = minW;
      morphState = null;
    };
    const timeoutId = setTimeout(cleanup, MORPH_MS + 50);
    const onEnd = (e) => {
      if (e.propertyName === "width" && e.target === toolbar2) {
        toolbar2.removeEventListener("transitionend", onEnd);
        clearTimeout(timeoutId);
        cleanup();
      }
    };
    toolbar2.addEventListener("transitionend", onEnd);
    morphState = { cleanup, timeoutId };
  }
  function renderToast(opts) {
    setActiveHandlers({
      menuActive: false,
      onEscape: opts.onEscape ?? opts.onClose ?? null,
      onPrimary: null
    });
    const first = getToolbar() === null;
    const { toolbar: toolbar2, shadowRoot: shadowRoot2 } = ensureHost();
    const hasIcon = !!opts.icon;
    const buttons = opts.buttons || (opts.button ? [opts.button] : []);
    const hasButtons = buttons.length > 0;
    const hasClose = !!opts.onClose;
    const children = [];
    if (opts.icon) {
      const spec = {
        spinner: {
          name: "icon.24.spinner",
          color: P.text,
          isSpinner: true
        },
        check: {
          name: "icon.24.check",
          color: P.success,
          isSpinner: false
        },
        error: {
          name: "icon.24.warning",
          color: P.error,
          isSpinner: false
        }
      }[opts.icon];
      const svg = icon(spec.name, spec.color, spec.isSpinner);
      svg.setAttribute("data-toolbar-role", "icon");
      children.push(svg);
    }
    const message = label(opts.message, !hasIcon, !hasButtons && !hasClose);
    message.setAttribute("data-toolbar-role", "message");
    children.push(message);
    for (const b of buttons) {
      const el = button(b.text, b.onClick, b.variant, b.disabled, b.isLoading);
      el.setAttribute("data-toolbar-role", "button");
      children.push(el);
    }
    if (opts.onClose) {
      const el = closeButton(opts.onClose);
      el.setAttribute("data-toolbar-role", "button");
      children.push(el);
    }
    if (first) toolbar2.replaceChildren(...children);
    else morph(toolbar2, shadowRoot2, children);
    return toolbar2;
  }
  function renderMenuBar(opts) {
    setActiveHandlers({
      menuActive: true,
      onEscape: opts.onClose,
      onPrimary: opts.onCapturePage
    });
    const { toolbar: toolbar2, shadowRoot: shadowRoot2 } = ensureHost();
    const children = [];
    const message = document.createElement("span");
    message.textContent = t("copyToClipboard");
    message.setAttribute("data-toolbar-role", "message");
    css(message, {
      textAlign: "left",
      padding: "0 12px 0 4px",
      color: P.text,
      whiteSpace: "nowrap"
    });
    children.push(message);
    children.push(divider());
    const group = document.createElement("div");
    group.setAttribute("data-toolbar-role", "button");
    css(group, {
      display: "flex",
      alignItems: "center",
      gap: "4px",
      marginLeft: "8px",
      marginRight: "8px"
    });
    group.appendChild(
      iconButton("icon.24.browser", t("capturePage"), opts.onCapturePage)
    );
    group.appendChild(
      iconButton(
        "icon.24.interaction.click",
        t("selectElement"),
        opts.onSelectElement
      )
    );
    children.push(group);
    children.push(divider());
    const close = closeButton(opts.onClose);
    close.setAttribute("data-toolbar-role", "button");
    children.push(close);
    collapseLabels(group, isNarrow());
    morph(toolbar2, shadowRoot2, children);
  }
  function renderPickerBar(onCancel2) {
    setActiveHandlers({ menuActive: false, onEscape: null, onPrimary: null });
    const { toolbar: toolbar2, shadowRoot: shadowRoot2 } = ensureHost();
    const children = [];
    const svg = icon("icon.24.interaction.click", P.text);
    svg.setAttribute("data-toolbar-role", "icon");
    children.push(svg);
    const message = document.createElement("span");
    message.textContent = t("selectElementToCapture");
    message.setAttribute("data-toolbar-role", "message");
    css(message, {
      flexGrow: "1",
      textAlign: "left",
      padding: "0 8px",
      color: P.text,
      whiteSpace: "nowrap"
    });
    children.push(message);
    const cancel2 = button(t("cancel"), onCancel2, "secondary");
    cancel2.setAttribute("data-toolbar-role", "button");
    children.push(cancel2);
    morph(toolbar2, shadowRoot2, children, { minWidth: "265px" });
  }

  // src/ui/selector.ts
  function buildSelector(el) {
    if (el === document.body) return "body";
    if (el === document.documentElement) return "html";
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.classList.length > 0)
      for (const cls of el.classList) {
        const sel = `.${CSS.escape(cls)}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    const parts = [];
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part = `#${CSS.escape(node.id)}`;
        parts.unshift(part);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (c) => c.tagName === node.tagName
        );
        if (sameTag.length > 1) {
          const idx = sameTag.indexOf(node) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }
  function describe2(el) {
    let text = el.tagName.toLowerCase();
    if (el.id) {
      text += `#${el.id}`;
    } else if (el.classList.length > 0) {
      text += `.${Array.from(el.classList).slice(0, 2).join(".")}`;
      if (el.classList.length > 2) text += "...";
    }
    if (text.length > 40) text = text.slice(0, 37) + "...";
    return text;
  }
  function placeTooltip(target, tip) {
    let top;
    const below = window.innerHeight - target.bottom - 8;
    const above = target.top - 56 - 8;
    if (below >= tip.height) {
      top = target.bottom + 8;
    } else if (above >= tip.height) {
      top = target.top - tip.height - 8;
    } else if (target.height > tip.height + 8 * 2) {
      top = target.bottom - tip.height - 8;
    } else {
      top = Math.max(
        56 + 8,
        Math.min(target.bottom + 8, window.innerHeight - tip.height - 8)
      );
    }
    let left = target.left;
    if (left + tip.width > window.innerWidth - 8)
      left = window.innerWidth - tip.width - 8;
    if (left < 8) left = 8;
    return { top, left };
  }

  // src/ui/drag.ts
  function isCmdEnter(e) {
    return e.key === "Enter" && (e.metaKey || e.ctrlKey);
  }
  var dragging = false;
  var startX = 0;
  var startY = 0;
  var baseCenterX = 0;
  var baseTop = 0;
  var curCenterX = 0;
  var curTop = 0;
  var lastY = 0;
  var lastT = 0;
  var velocity = 0;
  var springRaf = null;
  var resizeRaf = null;
  var escapeAt = 0;
  var ESCAPE_WINDOW = 500;
  function decideDock(topPx, releaseVelocity, viewportH) {
    const threshold = 500;
    if (releaseVelocity < -threshold) return "top";
    if (releaseVelocity > threshold) return "bottom";
    return topPx < viewportH / 2 ? "top" : "bottom";
  }
  function dockTop(pos) {
    return pos === "top" ? 16 : window.innerHeight - 40 - 16;
  }
  function pointerXY(e) {
    if ("touches" in e) {
      const t2 = e.touches[0];
      return { x: t2?.clientX ?? 0, y: t2?.clientY ?? 0 };
    }
    return { x: e.clientX, y: e.clientY };
  }
  function animateDock(el, targetLeft, targetTop, fromLeft, fromTop, fromVel) {
    if (springRaf) cancelAnimationFrame(springRaf);
    const stiffness = 400;
    const damping = 28;
    const mass = 1;
    let sLeft = fromLeft;
    let sTop = fromTop;
    let vLeft = 0;
    let vTop = fromVel;
    let prev = performance.now();
    const step = (now) => {
      const dt = Math.min((now - prev) / 1e3, 0.05);
      prev = now;
      const dTop = sTop - targetTop;
      const aTop = (-stiffness * dTop + -damping * vTop) / mass;
      vTop += aTop * dt;
      sTop += vTop * dt;
      const dLeft = sLeft - targetLeft;
      const aLeft = (-stiffness * dLeft + -damping * vLeft) / mass;
      vLeft += aLeft * dt;
      sLeft += vLeft * dt;
      el.style.top = `${sTop}px`;
      el.style.left = `${sLeft}px`;
      el.style.transform = "translateX(-50%)";
      el.style.bottom = "";
      const topSettled = Math.abs(dTop) < 0.5 && Math.abs(vTop) < 10;
      const leftSettled = Math.abs(dLeft) < 0.5 && Math.abs(vLeft) < 10;
      if (topSettled && leftSettled) {
        positionDock(el, getDockPos());
        el.style.left = "50%";
        el.style.transform = "translateX(-50%)";
        springRaf = null;
      } else {
        springRaf = requestAnimationFrame(step);
      }
    };
    springRaf = requestAnimationFrame(step);
  }
  function onDown(e) {
    const B = getWrapper();
    if (!B) return;
    const target = e.target;
    if (target.tagName === "BUTTON" || target.closest("button")) return;
    dragging = true;
    const { x, y } = pointerXY(e);
    const rect = B.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    startX = x;
    startY = y;
    baseCenterX = centerX;
    baseTop = rect.top;
    curCenterX = centerX;
    curTop = rect.top;
    lastY = y;
    lastT = performance.now();
    velocity = 0;
    if (springRaf) {
      cancelAnimationFrame(springRaf);
      springRaf = null;
    }
    B.style.left = `${centerX}px`;
    B.style.top = `${rect.top}px`;
    B.style.bottom = "";
    B.style.transform = "translateX(-50%)";
    B.style.cursor = "grabbing";
    B.style.transition = "none";
    e.preventDefault();
  }
  function onMove(e) {
    const B = getWrapper();
    if (!dragging || !B) return;
    const { x, y } = pointerXY(e);
    const dx = x - startX;
    const dy = y - startY;
    const centerX = baseCenterX + dx;
    const rawTop = baseTop + dy;
    const min = -20;
    const max = window.innerHeight - 20;
    let top;
    if (rawTop < 0) {
      top = rawTop * 0.3;
    } else if (rawTop > window.innerHeight - 40) {
      const overshoot = rawTop - (window.innerHeight - 40);
      top = window.innerHeight - 40 + overshoot * 0.3;
    } else {
      top = Math.max(min, Math.min(max, rawTop));
    }
    curCenterX = centerX;
    curTop = top;
    B.style.left = `${centerX}px`;
    B.style.top = `${top}px`;
    const now = performance.now();
    const elapsed = now - lastT;
    if (elapsed > 0) velocity = (y - lastY) / elapsed * 1e3;
    lastY = y;
    lastT = now;
    e.preventDefault();
  }
  function onUp() {
    const B = getWrapper();
    if (!dragging || !B) return;
    dragging = false;
    B.style.cursor = "";
    const pos = decideDock(curTop, velocity, window.innerHeight);
    setDockPos(pos);
    saveDockPosition(pos);
    animateDock(
      B,
      window.innerWidth / 2,
      dockTop(pos),
      curCenterX,
      curTop,
      velocity
    );
  }
  function onResize() {
    const B = getWrapper();
    if (dragging || !B) return;
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      const wrapper2 = getWrapper();
      if (!wrapper2) return;
      if (springRaf) {
        cancelAnimationFrame(springRaf);
        springRaf = null;
      }
      wrapper2.style.left = "50%";
      wrapper2.style.transform = "translateX(-50%)";
      positionDock(wrapper2, getDockPos());
      refitResponsive(getActiveHandlers().menuActive);
    });
  }
  function onKeydown(e) {
    const { menuActive, onEscape, onPrimary } = getActiveHandlers();
    if (e.key === "Escape" && onEscape) {
      const now = Date.now();
      if (now - escapeAt < ESCAPE_WINDOW) {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
      } else {
        escapeAt = now;
      }
    } else if (isCmdEnter(e) && menuActive && onPrimary) {
      e.preventDefault();
      e.stopPropagation();
      onPrimary();
    }
  }
  function installDrag(wrapper2) {
    wrapper2.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    wrapper2.addEventListener("touchstart", onDown, { passive: false });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKeydown, true);
  }
  function uninstallDrag() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onUp);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("keydown", onKeydown, true);
    if (resizeRaf !== null) {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = null;
    }
    if (springRaf !== null) {
      cancelAnimationFrame(springRaf);
      springRaf = null;
    }
  }
  onRemove(uninstallDrag);

  // src/ui/picker.ts
  var CURSOR_STYLE_ID = "__figma_capture_cursor_style__";
  var FLASH_EASE = "cubic-bezier(0.15, 1, 0.4, 1)";
  var FLASH_IN_MS = 300;
  var FLASH_OUT_MS = 600;
  var FADE_MS2 = 300;
  var highlightBox = null;
  var tooltip = null;
  var hovered = null;
  var onPick = null;
  var onCancel = null;
  var cursorStyle = null;
  function buildOverlays() {
    renderPickerBar(() => cancel());
    const { shadowRoot: shadowRoot2 } = ensureHost();
    cursorStyle = document.createElement("style");
    cursorStyle.id = CURSOR_STYLE_ID;
    cursorStyle.textContent = "* { cursor: crosshair !important; }";
    document.head.appendChild(cursorStyle);
    highlightBox = document.createElement("div");
    css(highlightBox, {
      position: "fixed",
      pointerEvents: "none",
      border: `2px dashed ${P.brand}`,
      background: P.brandBg,
      borderRadius: P.highlightBorderRadius,
      zIndex: "2147483645",
      display: "none",
      boxSizing: "border-box"
    });
    shadowRoot2.appendChild(highlightBox);
    tooltip = document.createElement("div");
    css(tooltip, {
      position: "fixed",
      pointerEvents: "none",
      background: P.text,
      color: P.bg,
      padding: "4px 8px",
      borderRadius: P.tooltipBorderRadius,
      fontSize: P.fontSize,
      fontFamily: P.fontFamily,
      fontWeight: "500",
      zIndex: "2147483646",
      display: "none",
      whiteSpace: "nowrap",
      boxShadow: P.tooltipShadow
    });
    shadowRoot2.appendChild(tooltip);
  }
  function highlight(el) {
    if (!highlightBox || !tooltip) return;
    if (!el) {
      highlightBox.style.display = "none";
      tooltip.style.display = "none";
      hovered = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    css(highlightBox, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
    tooltip.textContent = describe2(el);
    tooltip.style.display = "block";
    const tipRect = tooltip.getBoundingClientRect();
    const { top, left } = placeTooltip(rect, tipRect);
    css(tooltip, { top: `${top}px`, left: `${left}px` });
    hovered = el;
  }
  function onMouseMove(e) {
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !isHostNode(el)) ?? null;
    if (hit && hit !== hovered) highlight(hit);
  }
  function onClick(e) {
    if (isHostNode(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    confirm();
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (isCmdEnter(e)) {
      e.preventDefault();
      confirm();
    }
  }
  function flashSelected(el) {
    el.style.transition = `border ${FLASH_IN_MS}ms ${FLASH_EASE}, box-shadow ${FLASH_IN_MS}ms ${FLASH_EASE}`;
    el.style.border = `2px solid ${P.brand}`;
    el.style.boxShadow = `0 0 0 4px ${P.brandBg}`;
    setTimeout(() => {
      el.style.transition = `box-shadow ${FLASH_OUT_MS}ms ${FLASH_EASE}`;
      el.style.boxShadow = `0 0 0 0px ${P.brandBg}`;
    }, FLASH_IN_MS);
  }
  function removeListeners() {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    if (cursorStyle) {
      cursorStyle.remove();
      cursorStyle = null;
    }
  }
  function confirm() {
    if (hovered && onPick) {
      const selector = buildSelector(hovered);
      const cb = onPick;
      removeListeners();
      onPick = null;
      onCancel = null;
      hovered = null;
      if (highlightBox) flashSelected(highlightBox);
      if (tooltip) tooltip.style.display = "none";
      cb(selector);
    }
  }
  function cancel() {
    const cb = onCancel;
    stopPicker();
    cb?.();
  }
  function stopPicker() {
    removeListeners();
    if (highlightBox) {
      highlightBox.remove();
      highlightBox = null;
    }
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
    hovered = null;
    onPick = null;
    onCancel = null;
  }
  function startPicker(pick, cancelCb) {
    stopPicker();
    onPick = pick;
    onCancel = cancelCb;
    buildOverlays();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }
  function fadeHighlight() {
    if (highlightBox) {
      const el = highlightBox;
      highlightBox = null;
      el.style.transition = `opacity ${FADE_MS2}ms ${FLASH_EASE}, border-color ${FADE_MS2}ms ${FLASH_EASE}, box-shadow ${FADE_MS2}ms ${FLASH_EASE}`;
      el.style.opacity = "0";
      el.addEventListener("transitionend", () => el.remove(), { once: true });
      setTimeout(() => el.remove(), FADE_MS2 + 50);
    }
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  // src/ui/flow.ts
  var AUTO_ADVANCE_MS = 3e3;
  function errMessage(e) {
    return e instanceof Error ? e.message : String(e);
  }
  function showSpinner() {
    renderToast({ icon: "spinner", message: t("capturingForClipboard") });
  }
  function showError(message) {
    renderToast({ icon: "error", message, onClose: () => dismiss() });
  }
  function makeClipboardLoop(capture, copy, selector) {
    let resolve;
    const promise = new Promise((r) => resolve = r);
    let timer = null;
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const done = () => {
      clearTimer();
      dismiss();
      resolve({ success: true });
    };
    const showClipboardBar = () => {
      clearTimer();
      renderMenuBar({
        onCapturePage: () => void capturePage(),
        onSelectElement: selectElement,
        onClose: done
      });
    };
    const showSuccess = () => {
      clearTimer();
      renderToast({
        icon: "check",
        message: t("clipboardSuccess"),
        onClose: showClipboardBar
      });
      timer = setTimeout(showClipboardBar, AUTO_ADVANCE_MS);
    };
    const capturePage = async () => {
      showSpinner();
      try {
        const payload = await capture(selector);
        await copy(payload);
        showSuccess();
      } catch (e) {
        const msg = errMessage(e);
        showError(msg);
        resolve({ success: false, error: msg });
      }
    };
    const selectElement = () => {
      startPicker(
        async (sel) => {
          showSpinner();
          try {
            const payload = await capture(sel);
            await copy(payload);
            fadeHighlight();
            showSuccess();
          } catch (e) {
            const msg = errMessage(e);
            fadeHighlight();
            showError(msg);
            resolve({ success: false, error: msg });
          }
        },
        () => showClipboardBar()
      );
    };
    return { promise, showSuccess, showClipboardBar, done };
  }
  function runClipboardFlow(deps) {
    const selector = deps.selector ?? "body";
    showSpinner();
    return (async () => {
      let payload;
      try {
        payload = await deps.capture(selector);
      } catch (e) {
        const msg = errMessage(e);
        if (msg.includes("Element not found")) dismiss();
        else showError(msg);
        return { success: false, error: msg };
      }
      try {
        await deps.copy(payload);
      } catch (e) {
        const msg = `Clipboard error: ${errMessage(e)}`;
        showError(msg);
        return { success: false, error: msg };
      }
      const loop = makeClipboardLoop(deps.capture, deps.copy, selector);
      loop.showSuccess();
      return loop.promise;
    })();
  }

  // src/entry.ts
  setDragInstaller(installDrag);
  async function waitForDomReady() {
    if (document.readyState === "loading") {
      await new Promise(
        (resolve) => document.addEventListener("DOMContentLoaded", () => resolve())
      );
    }
  }
  function visibilityAwareTimeout(ms) {
    const controller = new AbortController();
    let remaining = ms;
    let startedAt = document.hidden ? null : Date.now();
    let timer = null;
    const cleanup = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const arm = () => setTimeout(() => {
      cleanup();
      controller.abort();
    }, remaining);
    const onVisibility = () => {
      if (document.hidden) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
          remaining -= Date.now() - (startedAt ?? Date.now());
          startedAt = null;
        }
      } else if (timer === null && remaining > 0) {
        startedAt = Date.now();
        timer = arm();
      }
    };
    timer = startedAt ? arm() : null;
    document.addEventListener("visibilitychange", onVisibility);
    controller.signal.addEventListener("abort", cleanup, { once: true });
    return controller.signal;
  }
  async function captureToJson(selector = "body", _extractSourceData = false) {
    await waitForDomReady();
    const node = selector === "body" || selector === "html" ? document : document.querySelector(selector);
    if (!node) throw new Error(`Element not found: ${selector}`);
    const { document: doc } = await captureDocument(node, {
      timeoutSignal: visibilityAwareTimeout(1e4),
      devtools: void 0,
      extractCssVariables: true
    });
    return documentToJson(doc);
  }
  async function waitForFocus() {
    if (!document.hasFocus()) {
      await new Promise(
        (resolve) => window.addEventListener("focus", () => resolve(), { once: true })
      );
    }
  }
  async function copyToClipboard(payload) {
    const figma = window.figma;
    if (figma?.useHtmlClipboardEncoding !== false) {
      const blob = await buildClipboardBlob(payload, {
        dataType: "h2d",
        source: "mcp",
        capturedAtIso: (/* @__PURE__ */ new Date()).toISOString()
      });
      await waitForFocus();
      await navigator.clipboard.write([new ClipboardItem({ "text/html": blob })]);
    } else {
      await waitForFocus();
      await navigator.clipboard.writeText(payload);
    }
  }
  async function captureForDesign(options = {}) {
    const { selector = "body", delayMs, extractSourceData = false } = options;
    if (delayMs && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return runClipboardFlow({
      selector,
      capture: (sel) => captureToJson(sel, extractSourceData),
      copy: (payload) => copyToClipboard(payload)
    });
  }

  // src/index.ts
  if (typeof window !== "undefined") {
    window.htmlCapture = window.htmlCapture || {};
    window.htmlCapture.capture = captureForDesign;
    window.__h2d_clone = { en: captureToJson, xs: captureDocument };
  }
})();
//# sourceMappingURL=capture.js.map