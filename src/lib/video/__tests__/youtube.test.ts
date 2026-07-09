import { describe, it, expect } from "vitest";
import { parseYouTubeId, youTubeThumbnailUrl, youTubeEmbedUrl } from "../youtube";
import { createDefaultVideoPlayback } from "@/utils/fillUtils";

describe("parseYouTubeId", () => {
  it("parses a watch URL", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses a watch URL with extra query params", () => {
    expect(
      parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&feature=share"),
    ).toBe("dQw4w9WgXcQ");
  });

  it("parses a bare youtube.com host (no www)", () => {
    expect(parseYouTubeId("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses an m.youtube.com host", () => {
    expect(parseYouTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses a youtu.be short link", () => {
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses a youtu.be short link with query params", () => {
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ?t=10")).toBe("dQw4w9WgXcQ");
  });

  it("parses an embed URL", () => {
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses an embed URL with query params", () => {
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("parses a shorts URL", () => {
    expect(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses the youtube-nocookie.com privacy host", () => {
    expect(parseYouTubeId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("returns null for a non-YouTube https URL", () => {
    expect(parseYouTubeId("https://example.com/video.mp4")).toBeNull();
  });

  it("returns null for a data: URL (uploaded video)", () => {
    expect(parseYouTubeId("data:video/mp4;base64,AAAA")).toBeNull();
  });

  it("returns null for a blob: URL (uploaded video)", () => {
    expect(parseYouTubeId("blob:https://app.example.com/1234-5678")).toBeNull();
  });

  it("returns null for an S3/CDN https URL", () => {
    expect(parseYouTubeId("https://bucket.s3.amazonaws.com/video.mp4")).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    expect(parseYouTubeId("not a url")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseYouTubeId("")).toBeNull();
  });

  it("returns null for a youtube.com URL with no recognizable video path", () => {
    expect(parseYouTubeId("https://www.youtube.com/channel/UC123")).toBeNull();
  });

  it("returns null for a watch URL missing the v param", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?list=PL123")).toBeNull();
  });
});

describe("youTubeThumbnailUrl", () => {
  it("builds the hqdefault thumbnail URL", () => {
    expect(youTubeThumbnailUrl("dQw4w9WgXcQ")).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });
});

describe("youTubeEmbedUrl", () => {
  it("maps autoplay to autoplay=1&mute=1", () => {
    const playback = { ...createDefaultVideoPlayback(), autoplay: true, loop: false, muted: true };
    const url = new URL(youTubeEmbedUrl("dQw4w9WgXcQ", playback));
    expect(url.origin + url.pathname).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(url.searchParams.get("autoplay")).toBe("1");
    expect(url.searchParams.get("mute")).toBe("1");
  });

  it("maps loop to loop=1&playlist=<id>", () => {
    const playback = { autoplay: false, loop: true, muted: false };
    const url = new URL(youTubeEmbedUrl("dQw4w9WgXcQ", playback));
    expect(url.searchParams.get("loop")).toBe("1");
    expect(url.searchParams.get("playlist")).toBe("dQw4w9WgXcQ");
  });

  it("does not force mute when neither autoplay nor muted is set", () => {
    const playback = { autoplay: false, loop: false, muted: false };
    const url = new URL(youTubeEmbedUrl("dQw4w9WgXcQ", playback));
    expect(url.searchParams.has("mute")).toBe(false);
  });

  it("forces mute when muted is explicitly set even without autoplay", () => {
    const playback = { autoplay: false, loop: false, muted: true };
    const url = new URL(youTubeEmbedUrl("dQw4w9WgXcQ", playback));
    expect(url.searchParams.get("mute")).toBe("1");
  });

  it("always includes controls=1", () => {
    const playback = { autoplay: false, loop: false, muted: false };
    const url = new URL(youTubeEmbedUrl("dQw4w9WgXcQ", playback));
    expect(url.searchParams.get("controls")).toBe("1");
  });
});
