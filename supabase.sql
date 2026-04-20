-- Posts table
create table posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  notes text,
  messages jsonb,  -- full chat history for AI refine
  created_at timestamptz default now(),
  updated_at timestamptz
);

-- Documents table (case studies, brand assets, reference material)
create table documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  created_at timestamptz default now(),
  updated_at timestamptz
);

-- Guidelines table
create table guidelines (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  created_at timestamptz default now()
);
