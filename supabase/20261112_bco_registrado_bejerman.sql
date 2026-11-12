-- Columna "Reg. Bejerman": el comprobante ya está registrado en Bejerman (aplicada en Supabase el 12/11/2026).
alter table public.bco_movimientos
  add column if not exists registrado_bejerman boolean not null default false;

-- Los editores pueden tildarla (igual que Identificado y Conciliado).
grant update (registrado_bejerman) on public.bco_movimientos to authenticated;

-- La vista la expone al final (create or replace solo permite agregar columnas al final).
create or replace view public.bco_v_movimientos with (security_invoker = true) as
 SELECT m.id, m.fecha, m.concepto, m.datos, m.importe,
    CASE WHEN m.importe < 0::numeric THEN - m.importe ELSE NULL::numeric END AS debito,
    CASE WHEN m.importe > 0::numeric THEN m.importe ELSE NULL::numeric END AS credito,
    m.info_complementaria, m.nro_cheque, m.sucursal_origen, m.canal, m.banco, m.nombre,
    m.identificado, m.responsable_id, m.conciliado, m.conciliado_en,
    (r.nombre || ' '::text) || r.apellido AS responsable,
    (c.nombre || ' '::text) || c.apellido AS conciliado_por_nombre,
    ( SELECT count(*) AS count FROM public.bco_comentarios k WHERE k.movimiento_id = m.id) AS comentarios,
    to_char(m.fecha::timestamp with time zone, 'YYYY-MM'::text) AS mes,
    m.origen_hoja, m.origen_fila,
    m.registrado_bejerman
   FROM public.bco_movimientos m
     LEFT JOIN public.bco_usuarios r ON r.id = m.responsable_id
     LEFT JOIN public.bco_usuarios c ON c.id = m.conciliado_por;

-- Historial de cambios: se agrega "Reg. Bejerman".
create or replace function public.bco_mov_despues_update()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_yo uuid := public.bco_mi_id();
begin
  if new.responsable_id is distinct from old.responsable_id then
    insert into public.bco_movimientos_cambios(movimiento_id,campo,valor_anterior,valor_nuevo,cambiado_por)
    values (new.id, 'Responsable',
      (select nombre||' '||apellido from public.bco_usuarios where id = old.responsable_id),
      (select nombre||' '||apellido from public.bco_usuarios where id = new.responsable_id), v_yo);
  end if;
  if new.identificado is distinct from old.identificado then
    insert into public.bco_movimientos_cambios(movimiento_id,campo,valor_anterior,valor_nuevo,cambiado_por)
    values (new.id, 'Identificado', case when old.identificado then 'Sí' else 'No' end,
            case when new.identificado then 'Sí' else 'No' end, v_yo);
  end if;
  if new.registrado_bejerman is distinct from old.registrado_bejerman then
    insert into public.bco_movimientos_cambios(movimiento_id,campo,valor_anterior,valor_nuevo,cambiado_por)
    values (new.id, 'Reg. Bejerman', case when old.registrado_bejerman then 'Sí' else 'No' end,
            case when new.registrado_bejerman then 'Sí' else 'No' end, v_yo);
  end if;
  if new.conciliado is distinct from old.conciliado then
    insert into public.bco_movimientos_cambios(movimiento_id,campo,valor_anterior,valor_nuevo,cambiado_por)
    values (new.id, 'Conciliado', case when old.conciliado then 'Sí' else 'No' end,
            case when new.conciliado then 'Sí' else 'No' end, v_yo);
  end if;
  return null;
end $function$;
