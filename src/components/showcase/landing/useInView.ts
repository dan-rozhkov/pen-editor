import { useEffect, useRef, useState, type RefObject } from "react";

/** True once the element has entered the viewport (or at once where there is no IntersectionObserver). */
export function useInView<T extends Element>(immediate = false): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => immediate || typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setSeen(true);
        observer.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);

  return [ref, seen];
}
