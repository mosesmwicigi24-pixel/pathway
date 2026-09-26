// The server's RBAC catalog (GET /admin/permissions/catalog) as a grid model
// for the Roles and Users permission editors. While it loads — or if it fails —
// `model` is null and the editors refuse to save (a partial grid would strip
// the grants it can't show).
import { useMemo } from "react";
import { permissionsCatalog } from "../../../api/finance";
import { matrixModel, type MatrixModel } from "./permissionMatrix";
import { useAsync } from "./hooks";

export function usePermissionCatalog(): { model: MatrixModel | null; loading: boolean; error: string | null; retry: () => void } {
  const s = useAsync(() => permissionsCatalog(), "permissions-catalog", { errorFallback: "Could not load the list of permissions from the server." });
  const model = useMemo(() => (s.data ? matrixModel(s.data) : null), [s.data]);
  return { model, loading: s.loading, error: s.error, retry: s.reload };
}
