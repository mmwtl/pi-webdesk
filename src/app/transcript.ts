export type TranscriptGroup<T extends { role: string }> =
  | { role: "user"; message: T; key: number }
  | { role: "assistant"; messages: T[]; key: number };

export function groupTranscriptMessages<T extends { role: string }>(messages: T[]): TranscriptGroup<T>[] {
  const groups: TranscriptGroup<T>[] = [];

  messages.forEach((message, index) => {
    if (message.role === "user") {
      groups.push({ role: "user", message, key: index });
      return;
    }

    const previous = groups.at(-1);
    if (previous?.role === "assistant") previous.messages.push(message);
    else groups.push({ role: "assistant", messages: [message], key: index });
  });

  return groups;
}
