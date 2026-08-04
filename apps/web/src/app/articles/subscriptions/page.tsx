import { redirect } from "next/navigation";

export default function SubscriptionsRedirect() {
  redirect("/articles?feed=subscriptions");
}
