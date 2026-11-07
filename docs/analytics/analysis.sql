-- Usage analysis for whereiskara.com.
--
-- Run each query in the Supabase SQL editor against the events table
-- (supabase/008_events.sql). To rehearse on fake data first, find and replace
-- "from events" with "from events_synthetic" (see scripts/analytics/).
--
-- How to read the results:
--  * Traffic is small (tens of visitors a month). Every rate below is shown
--    next to its n, and a rate on a handful of sessions is noise, not a result.
--  * Identity is a random per-tab id (no persistent id), so one person can be
--    several sessions and "returning visitors" cannot be measured.
--  * Every query filters on properties->>'env' = 'production' so local and
--    preview traffic never counts. The server sets that field, not the client.
--  * session_end can fire more than once per session (tab hidden, then
--    closed), so take max() per session.

-- ---------------------------------------------------------------------------
-- 1. Sessions per day and per week
-- ---------------------------------------------------------------------------
-- A session is a distinct session_id. New vs returning is not possible with
-- a per-tab id; it would need a persistent id and consent (see README).
with e as (
  select * from events where properties->>'env' = 'production'
),
sessions as (
  select session_id, min(created_at) as first_seen
  from e
  group by session_id
)
select day, sessions, sum(sessions) over (order by day) as running_total
from (
  select date_trunc('day', first_seen)::date as day, count(*) as sessions
  from sessions
  group by 1
) d
order by day;

with e as (
  select * from events where properties->>'env' = 'production'
),
sessions as (
  select session_id, min(created_at) as first_seen
  from e
  group by session_id
)
select date_trunc('week', first_seen)::date as week, count(*) as sessions
from sessions
group by 1
order by 1;

-- ---------------------------------------------------------------------------
-- 2. Pin-select rate
-- ---------------------------------------------------------------------------
-- Sessions with at least one pin_select / sessions that viewed the homepage.
-- This is the primary conversion metric. n is shown alongside the rate.
with e as (
  select * from events where properties->>'env' = 'production'
),
home as (
  select distinct session_id from e where event_name = 'page_view' and path = '/'
),
selected as (
  select distinct session_id from e where event_name = 'pin_select'
)
select
  count(*)                                              as home_sessions,
  count(s.session_id)                                   as sessions_with_pin_select,
  round(100.0 * count(s.session_id) / nullif(count(*), 0), 1) as pin_select_rate_pct
from home h
left join selected s using (session_id);

-- ---------------------------------------------------------------------------
-- 3. Pins selected per session, and time to first pin click
-- ---------------------------------------------------------------------------
with e as (
  select * from events where properties->>'env' = 'production'
),
home as (
  select distinct session_id from e where event_name = 'page_view' and path = '/'
),
per_session as (
  select
    h.session_id,
    count(p.id)                                   as pins_selected,
    min((p.properties->>'ms_since_load')::numeric) as ms_to_first_pin
  from home h
  left join e p on p.session_id = h.session_id and p.event_name = 'pin_select'
  group by h.session_id
)
select
  pins_selected,
  count(*)                                                    as sessions,
  round(100.0 * count(*) / sum(count(*)) over (), 1)          as pct_of_sessions
from per_session
group by pins_selected
order by pins_selected;

with e as (
  select * from events where properties->>'env' = 'production'
),
first_click as (
  select session_id, min((properties->>'ms_since_load')::numeric) as ms_to_first_pin
  from e
  where event_name = 'pin_select'
  group by session_id
)
select
  count(*)                                                       as sessions_with_click,
  round((percentile_cont(0.5) within group (order by ms_to_first_pin) / 1000)::numeric, 1) as median_seconds_to_first_pin,
  round((percentile_cont(0.9) within group (order by ms_to_first_pin) / 1000)::numeric, 1) as p90_seconds_to_first_pin
from first_click;

-- ---------------------------------------------------------------------------
-- 4. Most and least clicked cities; latest pin vs older pins
-- ---------------------------------------------------------------------------
-- Counts, not rates: there is no impression event, so "clicks per view" is not
-- available. Cities never clicked do not appear here at all.
with e as (
  select * from events where properties->>'env' = 'production'
)
select
  properties->>'city'          as city,
  count(*)                     as selects,
  count(distinct session_id)   as sessions,
  rank() over (order by count(*) desc) as rank_by_selects
from e
where event_name = 'pin_select'
group by 1
order by selects desc, city;

with e as (
  select * from events where properties->>'env' = 'production'
)
select
  (properties->>'is_latest')::boolean as is_latest_pin,
  count(*)                            as selects,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct_of_selects
from e
where event_name = 'pin_select'
group by 1
order by 1 desc;

-- ---------------------------------------------------------------------------
-- 5. Funnel: homepage view, first pin, second pin, visited Timeline or About
-- ---------------------------------------------------------------------------
with e as (
  select * from events where properties->>'env' = 'production'
),
flags as (
  select
    session_id,
    bool_or(event_name = 'page_view' and path = '/')                        as saw_home,
    count(*) filter (where event_name = 'pin_select') >= 1                  as pin_1,
    count(*) filter (where event_name = 'pin_select') >= 2                  as pin_2,
    bool_or(event_name = 'page_view' and path in ('/timeline', '/about'))   as saw_timeline_or_about
  from e
  group by session_id
),
home_sessions as (
  select * from flags where saw_home
)
select step, sessions, round(100.0 * sessions / nullif(first_value(sessions) over (order by ord), 0), 1) as pct_of_home
from (
  select 1 as ord, '1 homepage view'            as step, count(*)                                   as sessions from home_sessions
  union all
  select 2, '2 first pin select',               count(*) filter (where pin_1)                       from home_sessions
  union all
  select 3, '3 second pin select',              count(*) filter (where pin_2)                       from home_sessions
  union all
  select 4, '4 visited Timeline or About',      count(*) filter (where saw_timeline_or_about)       from home_sessions
) steps
order by ord;

-- ---------------------------------------------------------------------------
-- 6. Where do sessions with no pin select go next?
-- ---------------------------------------------------------------------------
-- The next page_view after the first homepage view, or 'left' if there is none.
with e as (
  select * from events where properties->>'env' = 'production'
),
no_pin as (
  select distinct session_id
  from e
  where event_name = 'page_view' and path = '/'
    and session_id not in (select session_id from e where event_name = 'pin_select')
),
views as (
  select
    session_id,
    path,
    created_at,
    row_number() over (partition by session_id order by created_at) as n
  from e
  where event_name = 'page_view' and session_id in (select session_id from no_pin)
),
second as (
  select session_id, path from views where n = 2
)
select
  coalesce(s.path, 'left (no second page view)') as next_page,
  count(*)                                       as sessions,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from no_pin n
left join second s using (session_id)
group by 1
order by sessions desc;

-- ---------------------------------------------------------------------------
-- 7. Device split and pin-select rate by device
-- ---------------------------------------------------------------------------
with e as (
  select * from events where properties->>'env' = 'production'
),
home as (
  select session_id, min(properties->>'device_type') as device_type
  from e
  where event_name = 'page_view' and path = '/'
  group by session_id
),
selected as (
  select distinct session_id from e where event_name = 'pin_select'
)
select
  h.device_type,
  count(*)                                           as home_sessions,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct_of_sessions,
  count(s.session_id)                                as with_pin_select,
  round(100.0 * count(s.session_id) / nullif(count(*), 0), 1) as pin_select_rate_pct
from home h
left join selected s using (session_id)
group by h.device_type
order by home_sessions desc;

-- ---------------------------------------------------------------------------
-- 8. Does check-in freshness affect which pins get clicked?
-- ---------------------------------------------------------------------------
-- Limitation: with no impression event this shows where clicks land by the
-- pin's days_since_checkin, not a true click likelihood. To turn it into a
-- rate, divide each bucket by how many pins sat in that bucket at the time.
with e as (
  select * from events where properties->>'env' = 'production'
),
clicks as (
  select
    (properties->>'days_since_checkin')::int as days_since_checkin
  from e
  where event_name = 'pin_select'
)
select
  case
    when days_since_checkin is null then 'no check-in yet'
    when days_since_checkin <= 1    then '0-1 days'
    when days_since_checkin <= 7    then '2-7 days'
    when days_since_checkin <= 30   then '8-30 days'
    else '31+ days'
  end                                                as freshness,
  count(*)                                           as selects,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct_of_selects
from clicks
group by 1
order by min(coalesce(days_since_checkin, 1000));
