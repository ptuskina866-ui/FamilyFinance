import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://lmikogclmfwevgjluxsh.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_9IJbdT_94Sj-C7m_6_8bIg_JPY5XQBh';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

