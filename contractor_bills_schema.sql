-- Contractor Bills Table Schema
-- Run this in Supabase SQL Editor

create table if not exists public.contractor_bills (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  uploaded_by text not null,           -- email of uploader
  contractor_name text not null,       -- display name (e.g., "Rishabh Aditya")
  month integer not null check (month >= 1 and month <= 12),
  year integer not null,
  file_path text not null,             -- path in storage bucket
  file_url text not null               -- public URL for download
);

-- Index for quick lookups
create index idx_contractor_bills_date on public.contractor_bills(year desc, month desc);

-- RLS policies
alter table public.contractor_bills enable row level security;

create policy "Admins can view all contractor bills"
  on public.contractor_bills for select
  to authenticated
  using (true);

create policy "Contractors can insert their own bills"
  on public.contractor_bills for insert
  to authenticated
  with check (auth.email() = uploaded_by);
