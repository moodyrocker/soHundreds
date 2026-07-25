-- Instagram inspiration links in brand visual library
ALTER TABLE brand_visual_assets
  ADD COLUMN IF NOT EXISTS asset_kind TEXT NOT NULL DEFAULT 'image';

ALTER TABLE brand_visual_assets DROP CONSTRAINT IF EXISTS brand_visual_assets_asset_kind_check;
ALTER TABLE brand_visual_assets
  ADD CONSTRAINT brand_visual_assets_asset_kind_check
  CHECK (asset_kind IN ('image', 'instagram_link'));
