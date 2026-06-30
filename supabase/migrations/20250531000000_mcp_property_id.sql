ALTER TABLE mcp_connections
  ADD COLUMN IF NOT EXISTS property_id VARCHAR(255);
