-- Logistics System — enums (labels align with the browser app)

create type public.app_role as enum ('admin', 'supervisor', 'leader');

create type public.leader_status as enum ('Available', 'Busy', 'Off');

create type public.leader_availability_mode as enum ('auto', 'manual');

create type public.order_status as enum (
  'Scheduled',
  'In progress',
  'Completed',
  'Cancelled'
);

create type public.vehicle_ownership as enum ('company', 'client');

create type public.attachment_owner as enum ('order', 'expense');
