declare module "refractor" {
  interface Refractor {
    highlight(value: string, language: string): unknown;
    register(syntax: unknown): void;
    alias(name: string | Record<string, string | string[]>, alias?: string | string[]): void;
    registered(language: string): boolean;
    listLanguages(): string[];
  }
  export const refractor: Refractor;
}
