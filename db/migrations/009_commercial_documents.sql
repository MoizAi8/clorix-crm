CREATE TABLE catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  sku varchar(50) NOT NULL, name varchar(120) NOT NULL, kind text NOT NULL CHECK(kind IN ('product','service')),
  category varchar(80) NOT NULL DEFAULT '', description varchar(1000) NOT NULL DEFAULT '',
  price_minor bigint NOT NULL CHECK(price_minor BETWEEN 0 AND 9999999999999),
  cost_minor bigint CHECK(cost_minor BETWEEN 0 AND 9999999999999),
  tax_bps int NOT NULL DEFAULT 0 CHECK(tax_bps BETWEEN 0 AND 10000),
  active boolean NOT NULL DEFAULT true,version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX catalog_unique_sku ON catalog_items(workspace_id,lower(sku));
CREATE INDEX catalog_by_name ON catalog_items(workspace_id,name,id);

CREATE TABLE billing_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('quotation','invoice')), serial int NOT NULL CHECK(serial>0),
  status text NOT NULL CHECK(status IN ('draft','sent','accepted','rejected','issued')),
  currency char(3) NOT NULL, company_id uuid NOT NULL, contact_id uuid, deal_id uuid, source_quote_id uuid,
  source_deal_id uuid, company_name varchar(120) NOT NULL, subject varchar(120) NOT NULL,
  due_on date NOT NULL, terms varchar(2000) NOT NULL DEFAULT '',notes varchar(2000) NOT NULL DEFAULT '',
  subtotal_minor bigint NOT NULL CHECK(subtotal_minor>=0),discount_minor bigint NOT NULL CHECK(discount_minor>=0),
  tax_minor bigint NOT NULL CHECK(tax_minor>=0),total_minor bigint NOT NULL CHECK(total_minor BETWEEN 0 AND 9999999999999999),
  version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),UNIQUE(workspace_id,kind,serial),
  FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  FOREIGN KEY(workspace_id,deal_id) REFERENCES deals(workspace_id,id),
  FOREIGN KEY(workspace_id,source_deal_id) REFERENCES deals(workspace_id,id),
  FOREIGN KEY(workspace_id,source_quote_id) REFERENCES billing_documents(workspace_id,id),
  CHECK((kind='invoice' AND status IN ('draft','issued')) OR (kind='quotation' AND status IN ('draft','sent','accepted','rejected'))),
  CHECK(source_quote_id IS NULL OR (kind='invoice' AND source_deal_id IS NULL)),
  CHECK(source_deal_id IS NULL OR kind='invoice'),
  CHECK(total_minor=subtotal_minor-discount_minor+tax_minor AND discount_minor<=subtotal_minor)
);
CREATE UNIQUE INDEX billing_invoice_from_quote ON billing_documents(workspace_id,source_quote_id)
  WHERE source_quote_id IS NOT NULL;
CREATE UNIQUE INDEX billing_invoice_from_deal ON billing_documents(workspace_id,source_deal_id)
  WHERE source_deal_id IS NOT NULL;
CREATE INDEX billing_company ON billing_documents(workspace_id,company_id,created_at DESC);
CREATE INDEX billing_status_due ON billing_documents(workspace_id,kind,status,due_on);

CREATE TABLE billing_lines (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,document_id uuid NOT NULL,
  position smallint NOT NULL CHECK(position BETWEEN 1 AND 25),
  catalog_id uuid, label varchar(120) NOT NULL, sku varchar(50),
  qty_milli int NOT NULL CHECK(qty_milli BETWEEN 1 AND 1000000),
  unit_minor bigint NOT NULL CHECK(unit_minor BETWEEN 0 AND 9999999999999),
  discount_bps int NOT NULL CHECK(discount_bps BETWEEN 0 AND 10000),
  tax_bps int NOT NULL CHECK(tax_bps BETWEEN 0 AND 10000),
  subtotal_minor bigint NOT NULL, discount_minor bigint NOT NULL, tax_minor bigint NOT NULL, total_minor bigint NOT NULL,
  PRIMARY KEY(workspace_id,document_id,position),
  FOREIGN KEY(workspace_id,document_id) REFERENCES billing_documents(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,catalog_id) REFERENCES catalog_items(workspace_id,id),
  CHECK(subtotal_minor>=0 AND discount_minor BETWEEN 0 AND subtotal_minor AND tax_minor>=0),
  CHECK(total_minor=subtotal_minor-discount_minor+tax_minor)
);
CREATE TABLE billing_revisions (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,document_id uuid NOT NULL,version int NOT NULL,
  action varchar(25) NOT NULL,actor_member_id uuid NOT NULL,snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,document_id,version,action),
  FOREIGN KEY(workspace_id,document_id) REFERENCES billing_documents(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,actor_member_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE recorded_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  invoice_id uuid NOT NULL, actor_member_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  received_on date NOT NULL,method varchar(25) NOT NULL CHECK(method IN ('bank_transfer','cash','card','other')),
  reference varchar(100) NOT NULL DEFAULT '',notes varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,invoice_id) REFERENCES billing_documents(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,actor_member_id) REFERENCES memberships(workspace_id,id)
);
CREATE INDEX recorded_payment_invoice ON recorded_payments(workspace_id,invoice_id,received_on);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['catalog_items','billing_documents','billing_lines','billing_revisions','recorded_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY migrator ON %I TO %I USING(true) WITH CHECK(true)',t,current_user);
    EXECUTE format('CREATE POLICY tenant ON %I USING(workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member())) WITH CHECK(workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member()))',t);
  END LOOP;
END $$;

CREATE FUNCTION clorix_access.guard_commercial_currency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.currency<>OLD.currency AND (
    EXISTS (SELECT 1 FROM public.catalog_items WHERE workspace_id=OLD.id)
    OR EXISTS (SELECT 1 FROM public.billing_documents WHERE workspace_id=OLD.id)
    OR EXISTS (SELECT 1 FROM public.sales_targets WHERE workspace_id=OLD.id)
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='commercial_currency'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION clorix_access.guard_commercial_currency() FROM PUBLIC;
CREATE TRIGGER guard_commercial_currency BEFORE UPDATE OF currency ON workspaces
FOR EACH ROW EXECUTE FUNCTION clorix_access.guard_commercial_currency();
