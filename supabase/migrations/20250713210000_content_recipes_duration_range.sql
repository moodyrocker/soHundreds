-- Allow Runway recipe durations (2–15s) beyond the original 5|10 Gen-4.5 options
ALTER TABLE content_recipes DROP CONSTRAINT IF EXISTS content_recipes_duration_seconds_check;
ALTER TABLE content_recipes ADD CONSTRAINT content_recipes_duration_seconds_check
  CHECK (duration_seconds IS NULL OR (duration_seconds >= 2 AND duration_seconds <= 15));
