ALTER TABLE strategies DROP CONSTRAINT IF EXISTS strategies_data_source_check;

ALTER TABLE strategies
  ADD CONSTRAINT strategies_data_source_check
  CHECK (
    data_source IN (
      'analytics',
      'google_ads',
      'meta_ads',
      'shopify',
      'multi',
      'generic'
    )
  );
