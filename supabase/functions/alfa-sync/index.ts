// Real bank access is not configured. Never return fabricated accounts or operations.
// JWT verification stays enabled at the Supabase gateway.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const post = req.method === "POST";
  return new Response(JSON.stringify({
    success: false,
    code: post ? "ALFA_CONNECTION_NOT_CONFIGURED" : "METHOD_NOT_ALLOWED",
    error: post
      ? "Автоматическое подключение Альфа-Банка пока недоступно. Используйте импорт выписки."
      : "Метод не поддерживается.",
  }), {
    status: post ? 503 : 405,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", ...(post ? {} : { Allow: "POST, OPTIONS" }) },
  });
});
