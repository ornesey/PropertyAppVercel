-- Migration v10: organization-scoped additional-income types.
-- Converts existing additional-income receipt text values to reference IDs.

BEGIN;

CREATE TABLE IF NOT EXISTS rental.ref_additional_income_types (
    additional_income_type_id SERIAL PRIMARY KEY,
    name                      TEXT NOT NULL,
    org_id                    INT NOT NULL REFERENCES rental.organisations(org_id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ref_additional_income_types_org_name
    ON rental.ref_additional_income_types(org_id, name);
CREATE INDEX IF NOT EXISTS idx_ref_additional_income_types_org
    ON rental.ref_additional_income_types(org_id);

INSERT INTO rental.ref_additional_income_types (name, org_id)
SELECT seed.name, o.org_id
FROM rental.organisations o
CROSS JOIN (VALUES ('Internet'), ('Utilities'), ('Parking')) AS seed(name)
ON CONFLICT (org_id, name) DO NOTHING;

ALTER TABLE rental.additional_income_payments
    ADD COLUMN IF NOT EXISTS income_type_id INT;

ALTER TABLE rental.additional_income_payments
    DROP CONSTRAINT IF EXISTS fk_additional_income_lease_member;
ALTER TABLE rental.additional_income_payments
    ADD CONSTRAINT fk_additional_income_lease_member
    FOREIGN KEY (lease_id, tenant_id)
    REFERENCES rental.lease_members(lease_id, tenant_id)
    ON DELETE RESTRICT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'rental'
          AND table_name = 'additional_income_payments'
          AND column_name = 'income_type'
    ) THEN
        INSERT INTO rental.ref_additional_income_types (name, org_id)
        SELECT DISTINCT COALESCE(NULLIF(BTRIM(aip.income_type), ''), 'Other'), aip.org_id
        FROM rental.additional_income_payments aip
        ON CONFLICT (org_id, name) DO NOTHING;

        UPDATE rental.additional_income_payments aip
        SET income_type_id = ait.additional_income_type_id
        FROM rental.ref_additional_income_types ait
        WHERE ait.org_id = aip.org_id
          AND ait.name = COALESCE(NULLIF(BTRIM(aip.income_type), ''), 'Other')
          AND aip.income_type_id IS NULL;
    END IF;
END;
$$;

UPDATE rental.additional_income_payments aip
SET income_type_id = ait.additional_income_type_id
FROM rental.ref_additional_income_types ait
WHERE ait.org_id = aip.org_id
  AND ait.name = 'Internet'
  AND aip.income_type_id IS NULL;

ALTER TABLE rental.additional_income_payments
    ALTER COLUMN income_type_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'rental.additional_income_payments'::regclass
          AND conname = 'fk_additional_income_type'
    ) THEN
        ALTER TABLE rental.additional_income_payments
            ADD CONSTRAINT fk_additional_income_type
            FOREIGN KEY (income_type_id)
            REFERENCES rental.ref_additional_income_types(additional_income_type_id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

ALTER TABLE rental.additional_income_payments
    DROP COLUMN IF EXISTS income_type;

ALTER TABLE rental.ref_additional_income_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON rental.ref_additional_income_types;
CREATE POLICY org_isolation ON rental.ref_additional_income_types
    USING (org_id = rental.current_org_id())
    WITH CHECK (org_id = rental.current_org_id());

CREATE INDEX IF NOT EXISTS idx_additional_income_type_org_date
    ON rental.additional_income_payments(org_id, income_type_id, paid_date);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'tiered-web-app-run-sa@project-4a4cbdf0-7c5c-427b-98d.iam'
    ) THEN
        GRANT SELECT ON rental.ref_additional_income_types
            TO "tiered-web-app-run-sa@project-4a4cbdf0-7c5c-427b-98d.iam";
        REVOKE UPDATE, DELETE ON rental.additional_income_payments
            FROM "tiered-web-app-run-sa@project-4a4cbdf0-7c5c-427b-98d.iam";
        GRANT SELECT, INSERT ON rental.additional_income_payments
            TO "tiered-web-app-run-sa@project-4a4cbdf0-7c5c-427b-98d.iam";
    END IF;
END;
$$;

COMMIT;