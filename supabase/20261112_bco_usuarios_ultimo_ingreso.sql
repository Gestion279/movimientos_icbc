-- Último ingreso de cada usuario (ya aplicada en Supabase el 12/11/2026).
alter table public.bco_usuarios add column if not exists ultimo_ingreso timestamptz;

-- Valor inicial: el último inicio de sesión registrado en Auth.
update public.bco_usuarios u
   set ultimo_ingreso = a.last_sign_in_at
  from auth.users a
 where a.id = u.user_id and u.ultimo_ingreso is null;

-- La app la llama cada vez que se abre con sesión válida.
-- security definer porque solo el administrador puede modificar bco_usuarios.
create or replace function public.bco_registrar_ingreso()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update public.bco_usuarios
     set ultimo_ingreso = now()
   where user_id = auth.uid() and activo
  returning ultimo_ingreso;
$$;

revoke execute on function public.bco_registrar_ingreso() from public, anon;
grant execute on function public.bco_registrar_ingreso() to authenticated;
