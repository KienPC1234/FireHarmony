import { useMemo } from "react";
import katex from "katex";

interface LatexProps {
  children?: string;
  math?: string;
  block?: boolean;
  className?: string;
}

export function Latex({ children, math, block = false, className }: LatexProps) {
  const formula = math ?? children ?? "";

  const html = useMemo(() => {
    if (!formula.trim()) return "";
    try {
      return katex.renderToString(formula, {
        displayMode: block,
        throwOnError: false,
      });
    } catch {
      return formula;
    }
  }, [formula, block]);

  if (!html) return null;

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
