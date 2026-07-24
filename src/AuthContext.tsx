import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Session, User } from '@supabase/supabase-js';

interface Profile {
  id: string;
  name: string;
  avatar: string;
  color: string;
  household_id: string | null;
  updated_at: string;
}

interface Household {
  id: string;
  name: string;
  created_at: string;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  household: Household | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    name: string,
    avatar: string,
    color: string,
    householdAction: 'create' | 'join',
    householdNameOrId: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfileAndHousehold = async (userId: string) => {
    try {
      // 1. Fetch Profile
      let { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // Retry once after 600ms if profile row was just created by trigger
      if (profileError && profileError.code === 'PGRST116') {
        await new Promise(r => setTimeout(r, 600));
        const retry = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();
        profileData = retry.data;
        profileError = retry.error;
      }

      if (profileError) {
        if (profileError.code === 'PGRST116') {
          // Profile not found
          setProfile(null);
          setHousehold(null);
        } else {
          console.error('Ошибка загрузки профиля:', profileError);
        }
        return;
      }

      setProfile(profileData);

      // 2. Fetch Household if profile has one
      if (profileData && profileData.household_id) {
        const { data: householdData, error: householdError } = await supabase
          .from('households')
          .select('*')
          .eq('id', profileData.household_id)
          .single();

        if (householdError) {
          console.error('Ошибка загрузки семьи:', householdError);
          setHousehold(null);
        } else {
          setHousehold(householdData);
        }
      } else {
        setHousehold(null);
      }
    } catch (err) {
      console.error('Ошибка получения профиля и семьи:', err);
    }
  };

  useEffect(() => {
    let active = true;

    // Safety timeout: Never hang on loading screen for more than 5 seconds
    const safetyTimer = setTimeout(() => {
      if (active) {
        setLoading(false);
      }
    }, 5000);

    const handleSession = async (currentSession: Session | null) => {
      try {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          await fetchProfileAndHousehold(currentSession.user.id);
        } else {
          setProfile(null);
          setHousehold(null);
        }
      } catch (err) {
        console.error('Ошибка при обработке сессии:', err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    // 1. Initial auth check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active) {
        handleSession(session);
      }
    }).catch(err => {
      console.error('Ошибка getSession:', err);
      if (active) setLoading(false);
    });

    // 2. Auth state changes listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;
      if (event === 'INITIAL_SESSION') return;

      await handleSession(session);
    });

    return () => {
      active = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (
    email: string,
    password: string,
    name: string,
    avatar: string,
    color: string,
    householdAction: 'create' | 'join',
    householdNameOrId: string
  ) => {
    let householdId = null;

    // 1. Сначала создаем/находим семейную группу (чтобы передать ее ID в метаданных)
    if (householdAction === 'create') {
      const { data: newHousehold, error: createError } = await supabase
        .from('households')
        .insert({ name: householdNameOrId })
        .select()
        .single();

      if (createError) throw createError;
      householdId = newHousehold.id;
    } else {
      // Проверка существования семьи по ID
      const { data: existingHousehold, error: checkError } = await supabase
        .from('households')
        .select('id')
        .eq('id', householdNameOrId)
        .single();

      if (checkError || !existingHousehold) {
        throw new Error('Семейная группа с таким ID не найдена. Проверьте правильность UUID.');
      }
      householdId = existingHousehold.id;
    }

    // 2. Register user with profile metadata for trigger
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          avatar,
          color,
          household_id: householdId
        }
      }
    });

    if (signUpError) throw signUpError;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfileAndHousehold(user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        household,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
export type { Profile, Household };
