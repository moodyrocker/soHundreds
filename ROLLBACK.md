# Rollback guide — Instagram brand assist preview

Baseline tag (known-good state before this feature): **`v0-baseline-pre-instagram-brand`**

Remote: **https://github.com/moodyrocker/soHundreds.git**

## Fastest disable (no git)

Set in `.env` and restart the API:

```
INSTAGRAM_IMAGE_PREVIEW=false
```

Instagram actions return to caption-only assist (same as before this feature).

## Local git rollback

```bash
# Abandon feature branch, return to baseline on main
git checkout main
git reset --hard v0-baseline-pre-instagram-brand

# Or stay on branch but undo feature commits
git revert HEAD   # repeat if multiple commits
```

## Restore from GitHub on a new machine

```bash
git clone https://github.com/moodyrocker/soHundreds.git
cd soHundreds
git checkout v0-baseline-pre-instagram-brand
```

## Enable the feature (after testing)

```
INSTAGRAM_IMAGE_PREVIEW=true
```

Requires `UNSPLASH_ACCESS_KEY` for stock fallback when Shopify product images are unavailable.
