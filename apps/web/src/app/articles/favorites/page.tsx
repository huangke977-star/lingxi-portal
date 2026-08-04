import { redirect } from "next/navigation";

export default function FavoritesRedirect() {
  redirect("/articles/reading?tab=favorites");
}
