import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getSupabase } from "@/integrations/supabase/lazyClient";

interface AdminAuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

export const AdminAuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkAdmin = async () => {
    const supabase = await getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsAuthenticated(false);
      setLoading(false);
      return false;
    }
    const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    setIsAuthenticated(data === true);
    setLoading(false);
    return data === true;
  };

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const initialize = async () => {
      const supabase = await getSupabase();
      if (!active) return;
      const { data: authState } = supabase.auth.onAuthStateChange(() => {
        if (!active) return;
        setLoading(true);
        setTimeout(() => {
          if (active) void checkAdmin();
        }, 0);
      });
      unsubscribe = () => authState.subscription.unsubscribe();
      await checkAdmin();
    };

    void initialize();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const login = async (email: string, password: string) => {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: data.user.id,
      _role: "admin",
    });

    if (isAdmin !== true) {
      await supabase.auth.signOut();
      setIsAuthenticated(false);
      return { error: "This account does not have admin access." };
    }

    setIsAuthenticated(true);
    setLoading(false);
    return { error: null };
  };

  const logout = async () => {
    const supabase = await getSupabase();
    await supabase.auth.signOut();
    setIsAuthenticated(false);
  };

  return (
    <AdminAuthContext.Provider value={{ isAuthenticated, loading, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
};

export const useAdminAuth = () => {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
};
