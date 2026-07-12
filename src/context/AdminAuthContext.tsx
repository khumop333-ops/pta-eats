import { createContext, useContext, useState, ReactNode } from "react";

interface AdminAuthContextType {
  isAuthenticated: boolean;
  adminSecret: string | null;
  login: (username: string, password: string, adminSecret: string) => boolean;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

const ADMIN_USERNAME = "restaurant";
const ADMIN_PASSWORD = "pretoria123";

export const AdminAuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => sessionStorage.getItem("admin_auth") === "true"
  );
  const [adminSecret, setAdminSecret] = useState<string | null>(
    () => sessionStorage.getItem("admin_secret")
  );

  const login = (username: string, password: string, secret: string): boolean => {
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD && secret.length > 0) {
      setIsAuthenticated(true);
      setAdminSecret(secret);
      sessionStorage.setItem("admin_auth", "true");
      sessionStorage.setItem("admin_secret", secret);
      return true;
    }
    return false;
  };

  const logout = () => {
    setIsAuthenticated(false);
    setAdminSecret(null);
    sessionStorage.removeItem("admin_auth");
    sessionStorage.removeItem("admin_secret");
  };

  return (
    <AdminAuthContext.Provider value={{ isAuthenticated, adminSecret, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
};

export const useAdminAuth = () => {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
};
