-- PLACEHOLDER TEST RATES (plan Q1 not yet decided). Commission and cancellation fees follow the
-- approved business rules; base/per-km/minimum are placeholders to be replaced from the admin
-- pricing screen. Inserted only if no current rule exists for the vehicle type.
INSERT INTO "pricing_rules"
  ("vehicle_type", "base_fare", "per_km", "minimum_fare", "max_distance_km", "commission_rate", "cancellation_fee_after_arrival")
SELECT v.vehicle_type::vehicle_type, v.base_fare, v.per_km, v.minimum_fare, v.max_distance_km, v.commission_rate, v.cancel_fee
FROM (VALUES
  ('motorcycle', 60.00, 18.00, 80.00, NULL::numeric, 0.1500, 40.00),
  ('bicycle',    40.00, 12.00, 50.00, 8.00,          0.1000, 25.00)
) AS v(vehicle_type, base_fare, per_km, minimum_fare, max_distance_km, commission_rate, cancel_fee)
WHERE NOT EXISTS (
  SELECT 1 FROM "pricing_rules" p WHERE p."vehicle_type" = v.vehicle_type::vehicle_type AND p."effective_to" IS NULL
);
