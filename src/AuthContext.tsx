import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Session, User } from '@supabase/supabase-js';
import { AuthLoadTicket, createAuthLoadGuard } from './lib/authLoadGuard';

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

export interface AuthContextType {
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
  createHouseholdInvite: () => Promise<string>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);
  const loadGuard = useRef(createAuthLoadGuard());
  const profileRequestedFor = useRef<string | null>(null);

  const fetchProfileAndHousehold = async (userId: string, ticket: AuthLoadTicket) => {
    const isCurrent = () => loadGuard.current.isCurrent(ticket) && ticket.userId === userId;
    if (!isCurrent()) return;
    try {
      // 1. Fetch Profile
      let { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
        .retry(false);
      if (!isCurrent()) return;

      // Retry once after 600ms if profile row was just created by trigger
      if (profileError && profileError.code === 'PGRST116') {
        await new Promise(r => setTimeout(r, 600));
        if (!isCurrent()) return;
        const retry = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()
          .retry(false);
        if (!isCurrent()) return;
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

      if (!profileData || profileData.id !== userId) {
        setProfile(null);
        setHousehold(null);
        return;
      }
      setProfile(profileData);
      setHousehold(previous => previous?.id === profileData.household_id ? previous : null);
      setLoading(false);

      // 2. Fetch Household if profile has one
      if (profileData && profileData.household_id) {
        const { data: householdData, error: householdError } = await supabase
          .from('households')
          .select('*')
          .eq('id', profileData.household_id)
          .single()
          .retry(false);
        if (!isCurrent()) return;

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
      if (isCurrent()) console.error('Ошибка получения профиля и семьи:', err);
    }
  };

  useEffect(() => {
    let active = true;
    loadGuard.current.activate();
    profileRequestedFor.current = null;
    let deferred: ReturnType<typeof setTimeout> | undefined;
    const initialTicket = loadGuard.current.snapshot();

    // Safety timeout: Never hang on loading screen for more than 5 seconds
    const safetyTimer = setTimeout(() => {
      if (active && loadGuard.current.isCurrent(initialTicket)) {
        setLoading(false);
      }
    }, 5000);

    const handleSession = (currentSession: Session | null) => {
      if (!active) return;
      const nextUserId = currentSession?.user.id ?? null;
      const identityChanged = loadGuard.current.userId !== nextUserId;
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (!identityChanged && nextUserId && profileRequestedFor.current === nextUserId) return;

      clearTimeout(deferred);
      const ticket = loadGuard.current.begin(nextUserId);
      const isCurrent = () => active && loadGuard.current.isCurrent(ticket);
      if (identityChanged) {
        setProfile(null);
        setHousehold(null);
        setLoading(nextUserId !== null);
      }
      profileRequestedFor.current = nextUserId;
      if (!nextUserId) {
        setProfile(null);
        setHousehold(null);
        setLoading(false);
        return;
      }
      // Release the Auth client's notification before issuing any Supabase request.
      deferred = setTimeout(() => {
        void fetchProfileAndHousehold(nextUserId, ticket).finally(() => {
          if (isCurrent()) setLoading(false);
        });
      }, 0);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' && !loadGuard.current.isCurrent(initialTicket)) return;
      handleSession(session);
    });

    return () => {
      active = false;
      loadGuard.current.invalidate();
      clearTimeout(safetyTimer);
      clearTimeout(deferred);
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
    const { data: schemaVersion, error: schemaError } = await supabase.rpc('finance_schema_version');
    if (schemaError || !Number.isInteger(schemaVersion) || schemaVersion < 1) throw new Error('Для регистрации требуется обновление базы приложения.');
    // The registration trigger creates a household or redeems a one-use invitation.
    // Clients never grant themselves membership using an arbitrary household UUID.
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          avatar,
          color,
          household_action: householdAction,
          household_name: householdAction === 'create' ? householdNameOrId.trim() : null,
          invite_token: householdAction === 'join' ? householdNameOrId.trim() : null
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
    if (!user || loadGuard.current.userId !== user.id) return;
    const ticket = loadGuard.current.begin(user.id);
    if (!profile) setLoading(true);
    try { await fetchProfileAndHousehold(user.id, ticket); }
    finally {
      if (loadGuard.current.isCurrent(ticket)) setLoading(false);
    }
  };
  const createHouseholdInvite = async () => {
    const { data, error } = await supabase.rpc('create_household_invite');
    if (error) throw new Error(error.message);
    if (typeof data !== 'string') throw new Error('Не удалось создать приглашение.');
    return data;
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
        refreshProfile,
        createHouseholdInvite
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
