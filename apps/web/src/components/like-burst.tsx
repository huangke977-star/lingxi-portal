"use client";

import { Bookmark, Heart, Rss, ThumbsUp } from "lucide-react";

export function LikeBurst({
  burst,
  variant,
}: {
  burst: number;
  variant: "heart" | "thumb" | "bookmark" | "rss";
}) {
  if (!burst) return null;

  const Icon = variant === "heart"
    ? Heart
    : variant === "thumb"
      ? ThumbsUp
      : variant === "bookmark"
        ? Bookmark
        : Rss;
  const fill = variant === "rss" ? "none" : "currentColor";

  return (
    <span aria-hidden="true" className={`like-burst ${variant}`} key={burst}>
      <Icon className="like-burst-icon one" fill={fill} />
      <Icon className="like-burst-icon two" fill={fill} />
      <Icon className="like-burst-icon three" fill={fill} />
    </span>
  );
}
