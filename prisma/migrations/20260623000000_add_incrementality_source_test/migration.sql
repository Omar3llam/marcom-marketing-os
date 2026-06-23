-- Phase 7C — Testing OS ↔ Incrementality bridge.
-- Provenance link: a holdout promoted from a concluded A/B test records the
-- source TestExperiment. Additive only — one nullable column + one SetNull FK.
-- Existing holdouts (designed directly) keep sourceTestId NULL.

-- AlterTable
ALTER TABLE "incrementality_tests" ADD COLUMN     "sourceTestId" UUID;

-- AddForeignKey
ALTER TABLE "incrementality_tests" ADD CONSTRAINT "incrementality_tests_sourceTestId_fkey" FOREIGN KEY ("sourceTestId") REFERENCES "test_experiments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
