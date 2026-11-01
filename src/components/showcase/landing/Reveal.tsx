import { Fragment, type CSSProperties, type ElementType } from "react";

import { useInView } from "@/components/showcase/landing/useInView";
import { cn } from "@/lib/utils";

/** One span per word; CSS staggers fade + rise by the `--i` index. */
export function Words({ text, start = 0 }: { text: string; start?: number }) {
  return (
    <>
      {text.split(" ").map((word, index) => (
        <Fragment key={index}>
          <span className="sf-word" style={{ "--i": start + index } as CSSProperties}>
            {word}
          </span>{" "}
        </Fragment>
      ))}
    </>
  );
}

interface RevealTextProps {
  as?: ElementType;
  text: string;
  id?: string;
  className?: string;
  immediate?: boolean;
}

/** A heading or paragraph whose words fade in and rise as it enters the viewport. */
export function RevealText({ as: Tag = "p", text, id, className, immediate }: RevealTextProps) {
  const [ref, seen] = useInView<HTMLElement>(immediate);
  return (
    <Tag ref={ref} id={id} className={cn("sf-reveal", seen && "is-in", className)}>
      <Words text={text} />
    </Tag>
  );
}
