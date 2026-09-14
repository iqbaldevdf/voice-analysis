import type { CSSProperties } from "react";

type SkeletonProps = {
  className?: string;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
  style?: CSSProperties;
};

export function Skeleton({ className = "", width, height, circle = false, style }: SkeletonProps) {
  const mergedStyle: CSSProperties = {
    width,
    height,
    ...style,
  };

  return (
    <span
      className={`skeleton ${circle ? "skeleton-circle" : ""} ${className}`.trim()}
      style={mergedStyle}
      aria-hidden
    />
  );
}
