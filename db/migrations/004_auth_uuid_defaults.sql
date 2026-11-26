ALTER TABLE "user" ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE session ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE account ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE verification ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER FUNCTION clorix_access.init_workspace(uuid,text,text,timestamptz) SET timezone='UTC';
