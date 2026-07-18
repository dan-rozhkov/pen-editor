import { useState } from "react";
import type { ImageCropRect, ImageFillMode, VideoFill } from "@/types/scene";
import { CheckboxInput, TextInput } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { useFileUpload } from "@/components/properties/useFileUpload";
import { FileUploadControl } from "@/components/properties/FileUploadControl";
import { FULL_CROP_RECT, clampCropRect, isFullCropRect } from "@/lib/imageCrop/cropRect";
import { fillModeToObjectFit } from "@/lib/cssBackground";
import { createDefaultVideoPlayback } from "@/utils/fillUtils";
import { parseYouTubeId, youTubeThumbnailUrl } from "@/lib/video/youtube";
import { CropRectGrid, MediaModeRow, MediaPreviewReplace } from "@/components/properties/mediaFillControls";

/**
 * Editor for a single video fill — the moving-image sibling of
 * `ImageFillEditor`. Shares the mode+crop-toggle row and the crop grid with
 * `ImageFillEditor` via `mediaFillControls.tsx` (the crop math itself is
 * shared via `@/lib/imageCrop/cropRect`), and adds playback controls
 * (autoplay / loop / mute). Video has no color adjustments (image-only), so
 * that section is intentionally absent.
 *
 * `onChange` receives the full updated `VideoFill` so the parent (FillSection)
 * can splice it back into the paint stack.
 */
export function VideoFillEditor({
  video,
  onChange,
}: {
  video?: VideoFill | undefined;
  onChange: (video: VideoFill) => void;
}) {
  const [cropEditorOpen, setCropEditorOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const { fileInputRef, handleFileSelect } = useFileUpload((dataUrl) => {
    onChange({
      src: dataUrl,
      mode: video?.mode ?? "fill",
      playback: video?.playback ?? createDefaultVideoPlayback(),
      ...(video?.crop ? { crop: video.crop } : {}),
    });
  });

  const applyUrl = () => {
    const src = urlInput.trim();
    if (!src) return;
    onChange({
      src,
      mode: video?.mode ?? "fill",
      playback: video?.playback ?? createDefaultVideoPlayback(),
      ...(video?.crop ? { crop: video.crop } : {}),
    });
    setUrlInput("");
  };

  if (!video?.src) {
    return (
      <div className="flex flex-col gap-2">
        <FileUploadControl
          fileInputRef={fileInputRef}
          onFileSelect={handleFileSelect}
          hasValue={false}
          uploadLabel="Upload Video"
          replaceLabel="Replace Video"
          accept="video/mp4,video/webm,video/*"
        />
        <div className="flex items-center gap-1">
          <TextInput
            value={urlInput}
            onChange={setUrlInput}
            placeholder="Or paste a video / YouTube URL"
          />
          <Button type="button" size="sm" variant="secondary" onClick={applyUrl}>
            Add
          </Button>
        </div>
        <p className="text-[10px] text-text-muted">
          Supports YouTube links (youtube.com, youtu.be) — plays as a real embedded player when
          exported, and shows the video's thumbnail on the canvas.
        </p>
      </div>
    );
  }

  const handleModeChange = (mode: string) => {
    onChange({ ...video, mode: mode as ImageFillMode });
  };

  const handleCropChange = (crop: ImageCropRect) => {
    onChange({ ...video, crop: clampCropRect(crop) });
  };

  const handleResetCrop = () => {
    onChange({ ...video, crop: undefined });
  };

  const setPlayback = (key: keyof VideoFill["playback"], value: boolean) => {
    onChange({ ...video, playback: { ...video.playback, [key]: value } });
  };

  const crop = video.crop ?? FULL_CROP_RECT;
  const cropped = !isFullCropRect(video.crop);
  // Unmuted autoplay is blocked by browsers — reflect that in the preview.
  const previewMuted = video.playback.muted || video.playback.autoplay;
  // A YouTube src can't be played by a <video> element (it's a page URL, not
  // a media file) — preview its static thumbnail instead, same as the
  // canvas renderer does (see videoFillHelpers.ts's applyYouTubeThumbnail).
  const youtubeId = parseYouTubeId(video.src);
  // Shared by the thumbnail <img> and the <video> preview so their fit can't drift.
  const previewStyle: React.CSSProperties = {
    objectFit: fillModeToObjectFit(video.mode) as React.CSSProperties["objectFit"],
  };

  return (
    <div className="flex flex-col gap-2">
      <MediaPreviewReplace
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
        accept="video/mp4,video/webm,video/*"
        replaceLabel="Replace Video"
      >
        {youtubeId ? (
          <img
            src={youTubeThumbnailUrl(youtubeId)}
            alt="YouTube video thumbnail"
            className="h-20 w-full"
            style={previewStyle}
          />
        ) : (
          <video
            src={video.src}
            className="h-20 w-full"
            style={previewStyle}
            autoPlay={video.playback.autoplay}
            loop={video.playback.loop}
            muted={previewMuted}
            playsInline
          />
        )}
      </MediaPreviewReplace>

      <MediaModeRow
        mode={video.mode}
        onModeChange={handleModeChange}
        cropEditorOpen={cropEditorOpen}
        onToggleCropEditor={() => setCropEditorOpen((v) => !v)}
        cropTooltip="Crop video"
      />

      {cropped && (
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={handleResetCrop}>
            Reset Crop
          </Button>
        </div>
      )}

      {cropEditorOpen && <CropRectGrid crop={crop} onChange={handleCropChange} />}

      <div className="-mx-3 flex flex-col gap-2 border-t border-border-default px-3 pt-3">
        <CheckboxInput
          label="Autoplay"
          checked={video.playback.autoplay}
          onChange={(checked) => setPlayback("autoplay", checked)}
        />
        <CheckboxInput
          label="Loop"
          checked={video.playback.loop}
          onChange={(checked) => setPlayback("loop", checked)}
        />
        <CheckboxInput
          label="Muted"
          checked={video.playback.muted}
          onChange={(checked) => setPlayback("muted", checked)}
        />
      </div>
    </div>
  );
}
