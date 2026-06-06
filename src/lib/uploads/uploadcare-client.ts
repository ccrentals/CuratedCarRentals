export type UploadcareSignedOptions = {
  publicKey: string;
  secureSignature: string;
  secureExpire: string;
};

export async function getUploadcareSignedOptions(): Promise<UploadcareSignedOptions> {
  const response = await fetch("/api/admin/uploads/uploadcare/signature", {
    method: "GET",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | (Partial<UploadcareSignedOptions> & { error?: string })
    | null;

  if (
    !response.ok ||
    !payload?.publicKey ||
    !payload.secureSignature ||
    !payload.secureExpire
  ) {
    throw new Error(payload?.error ?? "Unable to authorize the upload.");
  }

  return {
    publicKey: payload.publicKey,
    secureSignature: payload.secureSignature,
    secureExpire: payload.secureExpire,
  };
}
