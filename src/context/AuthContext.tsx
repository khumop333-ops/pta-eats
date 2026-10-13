import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { backendEnabled, getMe, clearToken, BackendUser } from "@/lib/backend";

interface Profile {
  full_name: string | null;
  phone_number: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: (User | BackendUser | any) | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  isBackend: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfileSupabase = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, phone_number")
      .eq("id", userId)
      .single();
    setProfile(data);
  };

  const refreshProfile = async () => {
    if (backendEnabled) {
      try {
        const me = await getMe();
        setProfile({ full_name: me.full_name, phone_number: me.phone_number || null });
      } catch {
        setProfile(null);
      }
    } else {
      if (session?.user?.id) await fetchProfileSupabase(session.user.id);
    }
  };

  useEffect(() => {
    if (backendEnabled) {
      // Backend auth flow
      const init = async () => {
        const token = localStorage.getItem('pta-eats-token');
        if (!token) {
          setLoading(false);
          return;
        }
        try {
          const me = await getMe();
          // Map backend user to compatible shape
          const mappedUser = {
            id: me.id,
            email: me.email,
            role: me.role,
            full_name: me.full_name,
          };
          setUser(mappedUser as any);
          setProfile({ full_name: me.full_name, phone_number: me.phone_number || null });
          setSession(null); // no supabase session
        } catch (e) {
          console.warn('Backend auth check failed', e);
          clearToken();
          setUser(null);
          setProfile(null);
        } finally {
          setLoading(false);
        }
      };
      init();

      // Listen for storage changes (logout in other tab)
      const onStorage = (e: StorageEvent) => {
        if (e.key === 'pta-eats-token' && !e.newValue) {
          setUser(null);
          setProfile(null);
        }
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    } else {
      // Supabase flow
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
          if (session?.user) {
            setTimeout(() => { fetchProfileSupabase(session.user.id); }, 0);
          } else {
            setProfile(null);
          }
        }
      );

      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        if (session?.user) {
          setTimeout(() => { fetchProfileSupabase(session.user.id); }, 0);
        }
      });

      return () => subscription.unsubscribe();
    }
  }, []);

  const signOut = async () => {
    if (backendEnabled) {
      clearToken();
      setUser(null);
      setProfile(null);
      setSession(null);
    } else {
      await supabase.auth.signOut();
      setSession(null);
      setUser(null);
      setProfile(null);
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile, isBackend: backendEnabled }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
