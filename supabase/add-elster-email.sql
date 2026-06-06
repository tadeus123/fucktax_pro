-- Add Mein ELSTER login email below username in company section.
-- Safe to re-run.

update public.company_lines
set sort_order = sort_order + 1
where section_id = 7
  and sort_order >= 6
  and not exists (
    select 1 from public.company_lines
    where section_id = 7 and value ilike '%invite@hugeconversations.com%'
  );

insert into public.company_lines (section_id, kind, value, sort_order)
select 7, 'data', 'Mein ELSTER Login Email · invite@hugeconversations.com', 6
where not exists (
  select 1 from public.company_lines
  where section_id = 7 and value ilike '%invite@hugeconversations.com%'
);
