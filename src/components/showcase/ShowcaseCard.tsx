import type { ShowcaseScreen } from "@/lib/showcase";

// Image only, and not interactive: no title/theme/model caption, and no
// click target while the live-HTML lightbox is switched off in ShowcasePage.
// Every card uses the baseline phone-screen ratio. `object-cover object-top`
// keeps the top of a longer screen visible and clips its overflow at the
// bottom, so carousels and grid rows retain a consistent size.
export function ShowcaseCard({ screen }: { screen: ShowcaseScreen }) {
  return (
    <div
      className="aspect-[390/844] w-full overflow-hidden rounded-3xl border border-gray-200 bg-surface-elevated"
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
