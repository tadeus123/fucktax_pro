-- Add Mein ELSTER login username to company section (below Finanzamt line).
-- Safe to re-run.

update public.company_lines
set sort_order = sort_order + 1
where section_id = 7
  and sort_order >= 5
  and not exists (
    select 1 from public.company_lines
    where section_id = 7 and value ilike '%HUGEProduction%'
  );

insert into public.company_lines (section_id, kind, value, sort_order)
select 7, 'data', 'Mein ELSTER · HUGEProduction', 5
where not exists (
  select 1 from public.company_lines
  where section_id = 7 and value ilike '%HUGEProduction%'
);
