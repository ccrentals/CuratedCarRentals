import { ensureCsrfToken } from "@/lib/security/csrf-client";
import {
  evaluateDirectImageEligibility,
  formatBytes,
  MAX_DIRECT_IMAGES_PER_SELECTION,
  type DirectImageUploadPurpose,
} from "@/lib/uploads/directUploadPolicy";
import { validateRasterImageFile } from "@/lib/uploads/rasterImageValidation";

export type DirectUploadProgress = {
  fileName: string;
  fileIndex: number;
  fileCount: number;
  percent: number;
  phase: "authorizing" | "uploading" | "finalizing";
};

type DirectUploadOptions = {
  purpose: DirectImageUploadPurpose;
  entityId?: string;
  context?: Record<string, unknown>;
  multiple?: boolean;
  onProgress?: (progress: DirectUploadProgress) => void;
};

export type DirectUploadResult = {
  file: File;
  purpose: DirectImageUploadPurpose;
  result: Record<string, unknown>;
  inspections?: Record<string, unknown>;
};

function selectImages(multiple: boolean) {
  return new Promise<File[]>((resolve) => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = multiple;
    picker.accept = "image/jpeg,image/png,image/webp,image/heic,image/heif";
    picker.addEventListener("change", () => resolve(Array.from(picker.files ?? [])), { once: true });
    picker.addEventListener("cancel", () => resolve([]), { once: true });
    picker.click();
  });
}

async function confirmEligibleFiles(files: File[]) {
  const evaluations = await Promise.all(files.map(async (file, index) => {
    const policy = index >= MAX_DIRECT_IMAGES_PER_SELECTION
      ? { eligible: false as const, message: `Select no more than ${MAX_DIRECT_IMAGES_PER_SELECTION} images at a time.` }
      : evaluateDirectImageEligibility({ size: file.size, mimeType: file.type });
    if (!policy.eligible) return { file, eligibility: policy };
    const contentError = await validateRasterImageFile(file);
    return {
      file,
      eligibility: contentError
        ? { eligible: false as const, message: contentError }
        : policy,
    };
  }));
  const lines = evaluations.map(({ file, eligibility }) =>
    `${eligibility.eligible ? "READY" : "NOT ACCEPTED"} — ${file.name} (${formatBytes(file.size)}): ${eligibility.message}`,
  );
  const eligible = evaluations.filter((entry) => entry.eligibility.eligible).map((entry) => entry.file);
  if (eligible.length === 0) {
    window.alert(`No files can be uploaded. No image bytes were sent.\n\n${lines.join("\n")}`);
    return [];
  }
  const confirmed = window.confirm(
    `Upload check — no image bytes have been sent yet.\n\n${lines.join("\n")}\n\n` +
      `${eligible.length} of ${files.length} file${files.length === 1 ? "" : "s"} will be processed. Continue?`,
  );
  return confirmed ? eligible : [];
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function uploadRawFile(input: {
  url: string;
  token: string;
  checksum: string;
  file: File;
  onProgress: (percent: number) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", input.url);
    request.withCredentials = false;
    request.setRequestHeader("Authorization", `Bearer ${input.token}`);
    request.setRequestHeader("Content-Type", input.file.type);
    request.setRequestHeader("X-Upload-Checksum", input.checksum);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) input.onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(request.responseText || "Bunny upload gateway rejected the image."));
    });
    request.addEventListener("error", () => reject(new Error("The image upload was interrupted.")));
    request.addEventListener("abort", () => reject(new Error("The image upload was cancelled.")));
    request.send(input.file);
  });
}

async function jsonRequest(url: string, csrfToken: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ ...body, csrfToken }),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "Image upload failed.");
  return payload ?? {};
}

export async function selectAndUploadDirectImages(options: DirectUploadOptions) {
  const selected = await selectImages(options.multiple ?? true);
  if (selected.length === 0) return [];
  const files = await confirmEligibleFiles(selected);
  if (files.length === 0) return [];
  const csrfToken = await ensureCsrfToken();
  if (!csrfToken) throw new Error("Unable to secure the upload. Refresh the page and try again.");

  const results: DirectUploadResult[] = [];
  for (const [index, file] of files.entries()) {
    const progress = (phase: DirectUploadProgress["phase"], percent: number) =>
      options.onProgress?.({ fileName: file.name, fileIndex: index, fileCount: files.length, phase, percent });
    const checksum = await sha256(file);
    for (;;) {
      try {
        progress("authorizing", 0);
        const authorization = await jsonRequest("/api/admin/uploads/direct/authorize", csrfToken, {
          purpose: options.purpose,
          entityId: options.entityId,
          context: options.context ?? {},
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          checksum,
        });
        if (
          typeof authorization.uploadId !== "string" ||
          typeof authorization.uploadToken !== "string" ||
          typeof authorization.uploadUrl !== "string"
        ) {
          throw new Error("The upload authorization response was incomplete.");
        }
        await uploadRawFile({
          url: authorization.uploadUrl,
          token: authorization.uploadToken,
          checksum,
          file,
          onProgress: (percent) => progress("uploading", percent),
        });
        progress("finalizing", 100);
        const finalized = await jsonRequest("/api/admin/uploads/direct/finalize", csrfToken, {
          uploadId: authorization.uploadId,
        });
        results.push({
          file,
          purpose: options.purpose,
          result: (finalized.result as Record<string, unknown>) ?? {},
          inspections: finalized.inspections as Record<string, unknown> | undefined,
        });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image upload failed.";
        if (window.confirm(`${file.name} could not be uploaded.\n\n${message}\n\nRetry this file?`)) continue;
        throw error;
      }
    }
  }
  return results;
}
