import {
  extractBunnyPublicStorageKey,
  getBunnyPublicCdnUrl,
} from "@/lib/uploads/bunny";
import {
  extractUploadcareFileId,
  type UploadcareFilePolicy,
  UploadcareFileValidationError,
  validateUploadcareFiles,
} from "@/lib/uploads/uploadcare";

/**
 * Accepts only provider URLs the application created: legacy Uploadcare files or
 * objects in the configured Bunny public CDN's public/ namespace.
 */
export async function validateVehicleGalleryFiles(
  references: readonly string[],
  policy: UploadcareFilePolicy,
  options: Parameters<typeof validateUploadcareFiles>[2] = {},
) {
  if (references.length > policy.maxCount) {
    throw new UploadcareFileValidationError(
      `${policy.label} allows a maximum of ${policy.maxCount} file${policy.maxCount === 1 ? "" : "s"}.`,
    );
  }
  if (new Set(references).size !== references.length) {
    throw new UploadcareFileValidationError(`Duplicate ${policy.label} uploads are not allowed.`);
  }

  let bunnyPublicCdnUrl: string | null | undefined;
  const uploadcareReferences: string[] = [];
  for (const reference of references) {
    if (extractUploadcareFileId(reference)) {
      uploadcareReferences.push(reference);
      continue;
    }
    bunnyPublicCdnUrl ??= getBunnyPublicCdnUrl();
    if (bunnyPublicCdnUrl && extractBunnyPublicStorageKey(reference, bunnyPublicCdnUrl)) continue;
    throw new UploadcareFileValidationError(`Invalid ${policy.label} upload reference.`);
  }

  return validateUploadcareFiles(uploadcareReferences, policy, options);
}
