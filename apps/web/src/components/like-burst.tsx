"use client";

import { Heart, ThumbsUp } from "lucide-react";

export function LikeBurst({
  burst,
  variant,
}: {
  burst: number;
  variant: "heart" | "thumb";
}) {
  if (!burst) return null;

  const Icon = variant === "heart" ? Heart : ThumbsUp;

  return (
    <span aria-hidden="true" className={`like-burst ${variant}`} key={burst}>
      <Icon className="like-burst-icon one" fill="currentColor" />
      <Icon className="like-burst-icon two" fill="currentColor" />
      <Icon className="like-burst-icon three" fill="currentColor" />
    </span>
  );
}
