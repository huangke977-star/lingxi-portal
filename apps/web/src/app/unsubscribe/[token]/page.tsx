"use client";

import { CheckCircle2, MailX } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { unsubscribeSubscriptionEmail } from "@/lib/distribution-api";

export default function UnsubscribeEmailPage() {
  const params = useParams<{ token: string }>();
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let active = true;
    unsubscribeSubscriptionEmail(params.token)
      .then(() => { if (active) setState("done"); })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [params.token]);

  return <section className="page-shell unsubscribe-page">
    <div className="unsubscribe-panel">
      {state === "loading" ? <><MailX aria-hidden="true" size={22} /><strong>正在处理邮件日报退订</strong><span>Processing your email digest unsubscribe request.</span></> : null}
      {state === "done" ? <><CheckCircle2 aria-hidden="true" size={22} /><strong>邮件日报已退订</strong><span>Email digest delivery has been disabled. Your site subscriptions are unchanged.</span></> : null}
      {state === "error" ? <><MailX aria-hidden="true" size={22} /><strong>退订链接不可用</strong><span>This unsubscribe link is invalid or has expired.</span></> : null}
    </div>
  </section>;
}
