const MAX_SESSION_NAME_LENGTH = 48;

export function deriveSessionName(prompt: string): string {
  const plain = prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) return "New session";
  const firstSentence = plain.split(/(?<=[.!?])\s+/u)[0].replace(/[.!?]+$/u, "").trim();
  if (firstSentence.length <= MAX_SESSION_NAME_LENGTH) return firstSentence;
  const shortened = firstSentence.slice(0, MAX_SESSION_NAME_LENGTH - 1);
  const wordBoundary = shortened.lastIndexOf(" ");
  return `${(wordBoundary >= 28 ? shortened.slice(0, wordBoundary) : shortened).trimEnd()}…`;
}
