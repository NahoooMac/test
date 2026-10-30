-- Initial service area: Addis Ababa sub-cities. Mirrors SUB_CITIES in packages/shared/src/enums.ts.
INSERT INTO "service_areas" ("slug", "name_en", "name_am", "sort_order") VALUES
  ('bole', 'Bole', 'ቦሌ', 1),
  ('kirkos', 'Kirkos', 'ቂርቆስ', 2),
  ('yeka', 'Yeka', 'የካ', 3),
  ('nifas-silk-lafto', 'Nifas Silk-Lafto', 'ንፋስ ስልክ ላፍቶ', 4),
  ('arada', 'Arada', 'አራዳ', 5),
  ('addis-ketema', 'Addis Ketema', 'አዲስ ከተማ', 6),
  ('lideta', 'Lideta', 'ልደታ', 7),
  ('kolfe-keranio', 'Kolfe Keranio', 'ኮልፌ ቀራኒዮ', 8),
  ('gullele', 'Gullele', 'ጉለሌ', 9),
  ('akaki-kality', 'Akaki Kality', 'አቃቂ ቃሊቲ', 10),
  ('lemi-kura', 'Lemi Kura', 'ለሚ ኩራ', 11)
ON CONFLICT ("slug") DO NOTHING;
