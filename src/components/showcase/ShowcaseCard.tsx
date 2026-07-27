import type { ShowcaseScreen } from "@/lib/showcase";

// Image only, and not interactive: no title/theme/model caption, and no
// click target while the live-HTML lightbox is switched off in ShowcasePage.
// The screens are the point — labelling each one turned the grid into a
// table of metadata. The title still rides along as alt text.
export function ShowcaseCard({ screen }: { screen: ShowcaseScreen }) {
  return (
    <div
      className="w-full overflow-hidden rounded-3xl bg-surface-elevated"
      style={{ aspectRatio: `${screen.width} / ${screen.height}` }}
    >
      <img
        src={screen.imageUrl}
        alt={screen.title}
        loading="lazy"
        className="size-full object-cover object-top"
      />
    </div>
  );
}
