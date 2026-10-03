import { Navigate, useLocation, useParams } from "react-router-dom";

/**
 * Redirects an old/alternate URL to its current page, substituting route
 * params into `to` (e.g. "/messages/:id"). Keeps the query string so links
 * like `?message=` still work. Used so stale links never land on 404.
 */
export default function ParamRedirect({ to }: { to: string }) {
  const params = useParams();
  const { search } = useLocation();
  const target = to.replace(/:([A-Za-z]+)/g, (_, key: string) =>
    encodeURIComponent(params[key] ?? ""),
  );
  return <Navigate to={`${target}${search}`} replace />;
}
