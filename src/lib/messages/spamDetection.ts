const URL_PATTERN = /(https?:\/\/\S+|www\.\S+)/gi;

const HIGH_CONFIDENCE_SPAM_PHRASES = [
  "buy followers",
  "whatsapp me for investment",
  "crypto signals",
  "forex signals",
  "casino bonus",
  "adult dating",
  "seo backlink",
  "work from home guaranteed",
] as const;

const SPAM_KEYWORDS = [
  "bitcoin",
  "crypto",
  "forex",
  "backlinks",
  "viagra",
  "casino",
  "loan offer",
  "earn money fast",
  "telegram",
] as const;

export type ContactSpamAssessment = {
  blocked: boolean;
  reason: "URL_LIMIT" | "SPAM_PHRASE" | "SPAM_KEYWORDS" | null;
  urlCount: number;
  keywordHits: string[];
};

function normalized(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function assessContactMessageSpam(message: string): ContactSpamAssessment {
  const text = normalized(message);
  const urlCount = (text.match(URL_PATTERN) ?? []).length;

  if (urlCount > 3) {
    return {
      blocked: true,
      reason: "URL_LIMIT",
      urlCount,
      keywordHits: [],
    };
  }

  for (const phrase of HIGH_CONFIDENCE_SPAM_PHRASES) {
    if (text.includes(phrase)) {
      return {
        blocked: true,
        reason: "SPAM_PHRASE",
        urlCount,
        keywordHits: [phrase],
      };
    }
  }

  const keywordHits = SPAM_KEYWORDS.filter((keyword) => text.includes(keyword));

  // Keep false positives low: require multiple keyword hits, or one hit plus at least one URL.
  if (keywordHits.length >= 2 || (keywordHits.length >= 1 && urlCount >= 1)) {
    return {
      blocked: true,
      reason: "SPAM_KEYWORDS",
      urlCount,
      keywordHits,
    };
  }

  return {
    blocked: false,
    reason: null,
    urlCount,
    keywordHits,
  };
}
