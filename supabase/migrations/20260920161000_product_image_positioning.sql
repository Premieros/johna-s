BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_position_x smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_position_y smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_zoom numeric(4,2) NOT NULL DEFAULT 1.00;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_image_position_x_range,
  ADD CONSTRAINT products_image_position_x_range CHECK (image_position_x BETWEEN -50 AND 50),
  DROP CONSTRAINT IF EXISTS products_image_position_y_range,
  ADD CONSTRAINT products_image_position_y_range CHECK (image_position_y BETWEEN -50 AND 50),
  DROP CONSTRAINT IF EXISTS products_image_zoom_range,
  ADD CONSTRAINT products_image_zoom_range CHECK (image_zoom BETWEEN 0.50 AND 2.50);

COMMENT ON COLUMN public.products.image_position_x IS 'Horizontal image offset percentage for product-card presentation. 0 is centered.';
COMMENT ON COLUMN public.products.image_position_y IS 'Vertical image offset percentage for product-card presentation. 0 is centered.';
COMMENT ON COLUMN public.products.image_zoom IS 'Product image presentation scale. 1.00 shows the full default image.';

COMMIT;
