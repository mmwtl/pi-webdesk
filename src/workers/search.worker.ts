interface SearchRequest {
  id: number;
  path: string;
  text: string;
  pattern: string;
}

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const { id, path, text, pattern } = event.data;
  try {
    const regex = new RegExp(pattern, "i");
    const matches = text.split(/\r?\n/).flatMap((line, index) => regex.test(line) ? [`${path}:${index + 1}:${line}`] : []);
    self.postMessage({ id, matches });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
