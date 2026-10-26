import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { setApiRole } from "@/api/client";
import type { Role } from "@/api/types";

const STORAGE_KEY = "readiness.role";

export const ROLE_LABELS: Record<Role, string> = {
  planning: "Program / planning",
  purchasing: "Purchasing",
  warehouse: "Receiving / warehouse",
  qa: "QA",
};

export const ROLE_HOME: Record<Role, string> = {
  planning: "/work-orders",
  purchasing: "/purchasing/source",
  warehouse: "/warehouse",
  qa: "/qa",
};

function readRole(): Role {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v in ROLE_LABELS) return v as Role;
  } catch {
    /* storage unavailable: fall back to default */
  }
  return "planning";
}

const RoleContext = createContext<{ role: Role; setRole: (r: Role) => void }>({ role: "planning", setRole: () => {} });

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(readRole);
  setApiRole(role);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, role);
    } catch {
      /* ignore */
    }
  }, [role]);
  return <RoleContext.Provider value={{ role, setRole: setRoleState }}>{children}</RoleContext.Provider>;
}

export const useRole = () => useContext(RoleContext);
