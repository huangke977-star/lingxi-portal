import { redirect } from "next/navigation";

export default function LikedRedirect() {
  redirect("/articles/reading?tab=liked");
}
