import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

interface AdminPageHeaderProps {
  actions?: ReactNode;
  className?: string;
  description?: string;
  title: string;
}

interface AdminPageLoadingProps extends AdminPageHeaderProps {
  loadingLabel: string;
}

export function AdminPageHeader({
  actions,
  className = "",
  description,
  title,
}: AdminPageHeaderProps) {
  return (
    <header className={`admin-page-header ${className}`.trim()}>
      <div className="admin-page-header-copy">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? (
        <div className="admin-page-header-actions">{actions}</div>
      ) : null}
    </header>
  );
}

export function AdminPageLoading({
  className,
  description,
  loadingLabel,
  title,
}: AdminPageLoadingProps) {
  return (
    <section
      className={`page-shell admin-shell admin-page-loading ${className ?? ""}`.trim()}
    >
      <AdminPageHeader description={description} title={title} />
      <div aria-live="polite" className="admin-page-loading-body">
        <span className="admin-page-loading-status">
          <LoaderCircle aria-hidden="true" className="spin" size={16} />
          {loadingLabel}
        </span>
        <span className="admin-page-loading-line short" />
        <span className="admin-page-loading-line" />
        <span className="admin-page-loading-line" />
      </div>
    </section>
  );
}
