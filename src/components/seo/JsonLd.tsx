import { headers } from "next/headers";

type JsonLdValue = Record<string, unknown> | Array<Record<string, unknown>>;

export async function JsonLd({ data }: { data: JsonLdValue }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
