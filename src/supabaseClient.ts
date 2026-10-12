import { createClient } from '@supabase/supabase-js';

const demo = import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1';
const supabaseUrl = demo ? 'https://demo.invalid' : import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = demo ? 'local-demo' : import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const missingVars: string[] = [];
  if (!supabaseUrl) missingVars.push('VITE_SUPABASE_URL');
  if (!supabaseAnonKey) missingVars.push('VITE_SUPABASE_ANON_KEY');

  throw new Error(
    `Missing required Supabase environment variable${missingVars.length > 1 ? 's' : ''}: ${missingVars.join(', ')}. Please configure ${missingVars.length > 1 ? 'them' : 'it'} in your .env file.`
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, demo ? {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async () => { throw new Error('В демо нет подключения к серверу.'); } }
} : undefined);

