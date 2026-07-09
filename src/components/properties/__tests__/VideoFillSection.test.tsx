import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VideoFillEditor } from "../VideoFillSection";
import type { VideoFill } from "@/types/scene";

afterEach(() => cleanup());

function playback(overrides: Partial<VideoFill["playback"]> = {}): VideoFill["playback"] {
  return { autoplay: true, loop: true, muted: true, ...overrides };
}

describe("<VideoFillEditor /> — empty state", () => {
  it("renders an Upload button and a URL input with a YouTube hint when there is no video fill", () => {
    render(<VideoFillEditor video={undefined} onChange={vi.fn()} />);
    expect(screen.getByText("Upload Video")).toBeTruthy();
    expect(screen.getByPlaceholderText("Or paste a video / YouTube URL")).toBeTruthy();
    expect(screen.getByText(/Supports YouTube links/)).toBeTruthy();
  });

  it("applies a pasted YouTube URL as the fill src via the Add button", () => {
    const onChange = vi.fn();
    render(<VideoFillEditor video={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("Or paste a video / YouTube URL"), {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByText("Add"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", mode: "fill" }),
    );
  });

  it("does not call onChange for a blank/whitespace-only URL", () => {
    const onChange = vi.fn();
    render(<VideoFillEditor video={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("Or paste a video / YouTube URL"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText("Add"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("<VideoFillEditor /> — uploaded-file video (non-YouTube) source", () => {
  it("still renders a real <video> preview element (unchanged path)", () => {
    render(
      <VideoFillEditor
        video={{ src: "data:video/mp4;base64,AAAA", mode: "fill", playback: playback() }}
        onChange={vi.fn()}
      />,
    );
    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("data:video/mp4;base64,AAAA");
    expect(document.querySelector('img[alt="YouTube video thumbnail"]')).toBeNull();
  });

  it("renders the file-based src unmodified regardless of playback flags", () => {
    render(
      <VideoFillEditor
        video={{
          src: "https://cdn.example.com/clip.mp4",
          mode: "fit",
          playback: playback({ autoplay: false, loop: false, muted: false }),
        }}
        onChange={vi.fn()}
      />,
    );
    const video = document.querySelector("video");
    expect(video?.getAttribute("src")).toBe("https://cdn.example.com/clip.mp4");
  });
});

describe("<VideoFillEditor /> — YouTube source", () => {
  it("renders the static thumbnail <img> instead of a <video> element", () => {
    render(
      <VideoFillEditor
        video={{
          src: "https://youtu.be/dQw4w9WgXcQ",
          mode: "fill",
          playback: playback(),
        }}
        onChange={vi.fn()}
      />,
    );
    expect(document.querySelector("video")).toBeNull();
    const thumb = screen.getByAltText("YouTube video thumbnail") as HTMLImageElement;
    expect(thumb.src).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });

  it("still shows the mode/crop/playback controls for a YouTube fill", () => {
    render(
      <VideoFillEditor
        video={{ src: "https://youtu.be/dQw4w9WgXcQ", mode: "fill", playback: playback() }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Fill (Cover)")).toBeTruthy();
    expect(screen.getByText("Autoplay")).toBeTruthy();
    expect(screen.getByText("Loop")).toBeTruthy();
    expect(screen.getByText("Muted")).toBeTruthy();
  });
});
