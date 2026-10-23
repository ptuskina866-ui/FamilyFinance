import { createPriorAutoHandler } from './handler.ts';
Deno.serve(createPriorAutoHandler({url:Deno.env.get('SUPABASE_URL')??'',serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??''}));
