-- Banners can be text-only (the owner has no image hosting): the image and the
-- English title become optional, and a subtitle and a colour tone are added.
ALTER TABLE "banners" ALTER COLUMN "imageUrl" DROP NOT NULL;
ALTER TABLE "banners" ALTER COLUMN "titleEn" DROP NOT NULL;
ALTER TABLE "banners" ADD COLUMN "subtitleAr" TEXT;
ALTER TABLE "banners" ADD COLUMN "tone" TEXT NOT NULL DEFAULT 'teal';
