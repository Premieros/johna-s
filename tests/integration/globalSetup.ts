import pg from 'pg';

const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

export default async function globalSetup() {
  if (!dbUrl) return;

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // Integration fixtures created before the strict Category -> Station contract
    // often omit category_id. Production remains fail-closed; only the disposable
    // CI/local integration database gets this compatibility trigger.
    await client.query(`
      CREATE OR REPLACE FUNCTION public.ci_attach_default_kitchen_category()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public, pg_temp
      AS $function$
      DECLARE
        v_station_id uuid;
        v_category_id uuid;
      BEGIN
        IF NEW.branch_id IS NULL OR NEW.category_id IS NOT NULL THEN
          RETURN NEW;
        END IF;

        SELECT s.id INTO v_station_id
        FROM public.kitchen_stations s
        WHERE s.branch_id = NEW.branch_id
          AND lower(btrim(s.code)) = 'main'
          AND s.is_active = true
        LIMIT 1;

        IF v_station_id IS NULL THEN
          RETURN NEW;
        END IF;

        SELECT c.id INTO v_category_id
        FROM public.categories c
        WHERE c.branch_id = NEW.branch_id
          AND c.name = '__CI Kitchen Main__'
        LIMIT 1;

        IF v_category_id IS NULL THEN
          INSERT INTO public.categories(name, branch_id, kitchen_station_id)
          VALUES ('__CI Kitchen Main__', NEW.branch_id, v_station_id)
          RETURNING id INTO v_category_id;
        END IF;

        NEW.category_id := v_category_id;
        RETURN NEW;
      END
      $function$;

      DROP TRIGGER IF EXISTS trg_ci_attach_default_kitchen_category ON public.products;
      CREATE TRIGGER trg_ci_attach_default_kitchen_category
      BEFORE INSERT OR UPDATE OF branch_id, category_id
      ON public.products
      FOR EACH ROW EXECUTE FUNCTION public.ci_attach_default_kitchen_category();
    `);
  } finally {
    await client.end();
  }
}
