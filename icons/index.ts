// Ingreso solo con correo (sin contraseña) para la app de Movimientos ICBC.
// Solo los correos activos de public.bco_usuarios pueden ingresar.
// Copia de referencia: esta función ya está desplegada en Supabase (verify_jwt = false).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const { email } = await req.json().catch(() => ({}));
    const correo = String(email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return json({ error: "Escribí un correo válido." }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: u, error: ue } = await admin
      .from("bco_usuarios").select("id, user_id, activo, nombre, apellido")
      .eq("email", correo).maybeSingle();
    if (ue) throw ue;
    if (!u || !u.activo) return json({ error: "Este correo no tiene acceso a la aplicación." }, 403);

    let userId: string | null = u.user_id;
    if (!userId) {
      const { data: creado, error: ce } = await admin.auth.admin.createUser({
        email: correo, email_confirm: true,
        user_metadata: { nombre: u.nombre, apellido: u.apellido },
      });
      if (creado?.user) userId = creado.user.id;
      else {
        // Ya existía en Auth: buscarlo
        let page = 1;
        while (!userId) {
          const { data: lista, error: le } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (le) throw le;
          userId = lista.users.find((x) => x.email?.toLowerCase() === correo)?.id ?? null;
          if (lista.users.length < 1000) break;
          page++;
        }
        if (!userId) throw ce ?? new Error("No se pudo crear el usuario");
      }
      const { error: upe } = await admin.from("bco_usuarios").update({ user_id: userId }).eq("id", u.id);
      if (upe) throw upe;
    }

    const { data: link, error: ge } = await admin.auth.admin.generateLink({ type: "magiclink", email: correo });
    if (ge) throw ge;
    const publico = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: ses, error: ve } = await publico.auth.verifyOtp({
      type: "magiclink", token_hash: link.properties.hashed_token,
    });
    if (ve || !ses.session) throw ve ?? new Error("No se pudo iniciar la sesión");

    return json({
      access_token: ses.session.access_token,
      refresh_token: ses.session.refresh_token,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "No se pudo iniciar la sesión. Probá de nuevo en unos segundos." }, 500);
  }
});
