"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { openChatDock } from "@/lib/social-events";

export default function MessagesPage() {
  return <Suspense><MessagesCompatibilityRoute /></Suspense>;
}

function MessagesCompatibilityRoute() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const conversationId = Number(searchParams.get("conversation") ?? 0);
    const friendshipId = Number(searchParams.get("friendshipId") ?? 0);
    openChatDock(conversationId > 0
      ? { conversationId }
      : friendshipId > 0 ? { tab: "friends" } : {});
    router.replace("/");
  }, [router, searchParams]);

  return null;
}
