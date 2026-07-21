import { redirect } from "next/navigation";

export default function LegacyMyArticlesPage() {
  redirect("/articles/mine");
}
