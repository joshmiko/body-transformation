## Outcome

Describe the user-visible result and why this change is needed.

## Data impact

- [ ] No persisted-data change
- [ ] Migration added and legacy fixture tested
- [ ] Historical workout/program snapshots remain unchanged
- [ ] Rollback does not delete or downgrade user data

## Verification

- [ ] `npm run ci` passes locally
- [ ] App boots with no console errors
- [ ] Tested at 390 × 844
- [ ] Bottom navigation and safe-area clearance checked
- [ ] Start → log → review → save workout flow checked when affected
- [ ] Coach Sync export/import checked when affected
- [ ] Dashboard and Nutrition checked when affected
- [ ] Existing production data remains readable

## Release

- [ ] Change is bounded and reversible
- [ ] Changelog updated when user-visible
- [ ] Rollback commit/release identified
- [ ] No privileged secret added to client code
